import { Application, Container, Graphics, RenderTexture, Sprite, TilingSprite, type Texture } from 'pixi.js'
import { GIFEncoder, applyPalette, quantize } from 'gifenc'
import { DEFAULT_WIGGLE, type BrushId, type BrushTextures, type Stroke, type StrokePoint, type WiggleSettings } from './brush-types'
import { drawWiggleInto } from './brushes/wobble'
import { createSoftTexture, createRoughTexture, createGrainTexture } from './textures'
import { createPaperTextures, DEFAULT_PAPER, PAPER_TILE_SIZE, type PaperId } from './papers'
import { createWetTips, type WetTips } from './tips'
import { computeDabs, stampDabs } from './stamping'
import { WET_BRUSHES, isWetBrush } from './wet-brushes'
import { WashFilter } from './wash-filter'
import { hashSeed } from './random'
import { PictureLayer, type WetWiggleEntry } from './PictureLayer'

const BACKGROUND_COLOR = 0xffffff

/** During a live wet stroke, the last stretch of the path is left un-stamped and re-rendered
 * fresh each frame instead: perfect-freehand's streamline smoothing keeps shifting the most
 * recent points, so dabs stamped there too early would freeze in soon-to-be-wrong positions. */
const WET_TAIL_PX = 64

/** Edge-orbit radius (px) for wet strokes with the wiggle toggle on. */
const WET_WIGGLE_PX = 2.5

/** What the UI needs to render the layer list — top layer first. */
export interface LayerInfo {
  id: string
  name: string
  visible: boolean
  opacity: number
  active: boolean
}

/** Serializable snapshot of the whole picture — carried across an engine recreation (resize). */
export interface LayerSnapshot {
  id: string
  name: string
  visible: boolean
  opacity: number
  strokes: Stroke[]
}
export interface PictureSnapshot {
  layers: LayerSnapshot[]
  activeLayerId: string
}

export class PaintEngine {
  readonly app: Application
  readonly width: number
  readonly height: number

  private textures: BrushTextures

  /** Bottom of the stack: the sheet of paper. Every layer multiplies over it. */
  private paperSprite: TilingSprite
  private paperTextures: Record<PaperId, Texture>
  private paperId: PaperId = DEFAULT_PAPER

  /** The layer stack, bottom-to-top (index 0 is the bottom layer). */
  private layers: PictureLayer[] = []
  private activeLayerId = ''
  private layerCounter = 0

  /** Topmost layer: the hover brush preview — a ghost of the tip that follows the pointer.
   * Rebuilt lazily when brush/color/size change, hidden while drawing and excluded from exports. */
  private cursorLayer = new Container()
  private cursorDirty = true
  private sizePreviewTimer: ReturnType<typeof setTimeout> | null = null

  /** Live preview for the in-progress round/wet stroke — sits just above the active layer.
   * Rendered into a texture via an explicit renderer.render() call (same as baking): a Container
   * with blendMode + filtered children composites correctly through a render-to-texture call but
   * renders black when it's a permanent part of the auto-rendered stage tree. */
  private previewTexture: RenderTexture
  private previewSprite: Sprite

  /** Wet-brush pipeline: dabs stamped into a shared full-canvas silhouette texture, then the wash
   * filter turns that silhouette into pigment. One filter instance is reused everywhere. */
  private silhouetteTexture: RenderTexture
  private wetTips: WetTips
  private washFilter: WashFilter
  /** How many dabs of the in-progress wet stroke are already stamped into silhouetteTexture. */
  private wetStampedCount = 0

  /** Global, chronological undo history — each entry remembers which layer its stroke lives on,
   * so undo removes the most recent stroke anywhere and un-commits it from the right layer. */
  private history: { layerId: string; stroke: Stroke }[] = []
  private redoStack: { layerId: string; stroke: Stroke }[] = []
  private currentStroke: Stroke | null = null
  /** Layer the in-progress stroke will commit to — captured at pointerDown so a mid-stroke layer
   * switch (unusual, but possible via the panel) can't misfile it. */
  private currentStrokeLayerId = ''
  /** Set on pointerMove, consumed once per ticker frame — coalesces preview renders. */
  private previewDirty = false
  /** True while a GIF export owns the animated layers — input is ignored so a stray stroke
   * can't mutate the scene between frames. */
  private exporting = false

  private brushId: BrushId = 'round'
  private color = '#1e1e2e'
  private size = 18
  private wiggle: WiggleSettings = { ...DEFAULT_WIGGLE }
  private wetWiggle = false
  /** Loop period in seconds (1-4): the wet-edge orbit completes exactly one circle per loop. */
  private loopTime = 1

  private onHistoryChange?: (canUndo: boolean, canRedo: boolean) => void
  private onLayersChange?: (layers: LayerInfo[]) => void

  private constructor(app: Application, width: number, height: number) {
    this.app = app
    this.width = width
    this.height = height

    this.previewTexture = RenderTexture.create({ width, height, resolution: app.renderer.resolution })
    this.textures = { soft: createSoftTexture(), rough: createRoughTexture(), grain: createGrainTexture() }

    this.paperTextures = createPaperTextures()
    this.paperSprite = new TilingSprite({ texture: this.paperTextures[this.paperId], width, height })

    this.silhouetteTexture = RenderTexture.create({ width, height, resolution: app.renderer.resolution })
    this.wetTips = createWetTips()
    this.washFilter = new WashFilter(this.paperTextures[this.paperId], PAPER_TILE_SIZE)

    this.previewSprite = new Sprite(this.previewTexture)
    this.cursorLayer.visible = false

    // Start with a single blank layer.
    const first = this.createLayer()
    this.layers.push(first)
    this.activeLayerId = first.id
    this.restack()

    app.ticker.add(() => {
      // A live wiggle-on wet stroke animates even while the pointer holds still.
      if (this.currentStroke && isWetBrush(this.currentStroke.brush) && this.currentStroke.wetWiggle) {
        this.previewDirty = true
      }
      if (this.previewDirty) {
        this.previewDirty = false
        if (this.currentStroke) this.updatePreview()
      }
      this.tickWiggle()
      this.tickWetWiggle()
    })
  }

  static async create(canvas: HTMLCanvasElement, width: number, height: number): Promise<PaintEngine> {
    const app = new Application()
    await app.init({
      canvas,
      width,
      height,
      backgroundAlpha: 0,
      antialias: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
    })
    return new PaintEngine(app, width, height)
  }

  // ---- listeners / settings -------------------------------------------------

  setHistoryListener(fn: (canUndo: boolean, canRedo: boolean) => void) {
    this.onHistoryChange = fn
    this.emitHistory()
  }

  setLayersListener(fn: (layers: LayerInfo[]) => void) {
    this.onLayersChange = fn
    this.emitLayers()
  }

  setBrush(id: BrushId) {
    this.brushId = id
    this.cursorDirty = true
  }

  setColor(color: string) {
    this.color = color
    this.cursorDirty = true
  }

  setSize(size: number) {
    this.size = size
    this.cursorDirty = true
  }

  setWiggle(settings: Partial<WiggleSettings>) {
    this.wiggle = { ...this.wiggle, ...settings }
  }

  setWetWiggle(on: boolean) {
    this.wetWiggle = on
  }

  setLoopTime(seconds: number) {
    this.loopTime = Math.min(4, Math.max(1, seconds))
  }

  setPaper(id: PaperId) {
    if (id === this.paperId) return
    this.paperId = id
    this.paperSprite.texture = this.paperTextures[id]
    // Wet-brush granulation samples the paper — rebake every layer so strokes settle into it.
    this.washFilter.setPaper(this.paperTextures[id])
    for (const layer of this.layers) this.rebuildBaked(layer)
  }

  // ---- layer management -----------------------------------------------------

  private get active(): PictureLayer {
    return this.layerById(this.activeLayerId) ?? this.layers[this.layers.length - 1]
  }

  private layerById(id: string): PictureLayer | undefined {
    return this.layers.find((l) => l.id === id)
  }

  private createLayer(): PictureLayer {
    this.layerCounter += 1
    const layer = new PictureLayer(
      `layer-${Date.now()}-${this.layerCounter}`,
      `Layer ${this.layerCounter}`,
      this.width,
      this.height,
      this.app.renderer.resolution,
    )
    this.clearTexture(layer)
    return layer
  }

  /** Detach the shared preview sprite from whichever layer root currently holds it, so a layer
   * about to be re-stacked or destroyed doesn't take the (engine-owned) preview down with it. */
  private detachPreview() {
    this.previewSprite.parent?.removeChild(this.previewSprite)
  }

  /** Rebuilds the stage's child order: paper, layers bottom-to-top, cursor ghost on top. The
   * live preview is parented INSIDE the active layer's root — just above its baked pixels but
   * below its live (wobble / wet-wiggle) sublayers — so an in-progress stroke previews at the
   * exact z-order it will bake to, with no jump when it commits. */
  private restack() {
    const stage = this.app.stage
    this.detachPreview()
    stage.removeChildren()
    stage.addChild(this.paperSprite)
    for (const layer of this.layers) stage.addChild(layer.root)
    // Index 1: root children are [paintedSprite, wetWiggleLayer, wiggleLayer]; slot the preview
    // right after the baked sprite and before the live sublayers.
    const active = this.layerById(this.activeLayerId)
    if (active) active.root.addChildAt(this.previewSprite, 1)
    stage.addChild(this.cursorLayer)
  }

  addLayer() {
    const layer = this.createLayer()
    const activeIdx = this.layers.findIndex((l) => l.id === this.activeLayerId)
    this.layers.splice(activeIdx + 1, 0, layer) // just above the active layer
    this.activeLayerId = layer.id
    this.restack()
    this.emitLayers()
  }

  deleteLayer(id: string) {
    if (this.layers.length <= 1) return // always keep one surface
    const idx = this.layers.findIndex((l) => l.id === id)
    if (idx < 0) return
    const layer = this.layers[idx]
    this.detachPreview() // the preview may live in this layer's root — don't destroy it with it
    for (const wid of [...layer.wetWiggleStrokes.keys()]) this.destroyWetWiggleStroke(layer, wid)
    layer.destroy()
    this.layers.splice(idx, 1)
    this.history = this.history.filter((h) => h.layerId !== id)
    this.redoStack = this.redoStack.filter((h) => h.layerId !== id)
    if (this.activeLayerId === id) {
      this.activeLayerId = this.layers[Math.min(idx, this.layers.length - 1)].id
    }
    this.restack()
    this.emitLayers()
    this.emitHistory()
  }

  selectLayer(id: string) {
    if (!this.layerById(id) || id === this.activeLayerId) return
    this.activeLayerId = id
    this.restack() // preview follows the active layer
    this.emitLayers()
  }

  moveLayer(id: string, direction: 'up' | 'down') {
    const idx = this.layers.findIndex((l) => l.id === id)
    if (idx < 0) return
    const target = direction === 'up' ? idx + 1 : idx - 1 // up = toward the top = higher index
    if (target < 0 || target >= this.layers.length) return
    ;[this.layers[idx], this.layers[target]] = [this.layers[target], this.layers[idx]]
    this.restack()
    this.emitLayers()
  }

  setLayerVisible(id: string, visible: boolean) {
    const layer = this.layerById(id)
    if (!layer) return
    layer.visible = visible
    layer.applyDisplay()
    this.emitLayers()
  }

  setLayerOpacity(id: string, opacity: number) {
    const layer = this.layerById(id)
    if (!layer) return
    layer.opacity = Math.min(1, Math.max(0, opacity))
    layer.applyDisplay()
    this.emitLayers()
  }

  renameLayer(id: string, name: string) {
    const layer = this.layerById(id)
    if (!layer) return
    layer.name = name
    this.emitLayers()
  }

  private emitLayers() {
    // Top layer first for the panel (the stack is stored bottom-to-top).
    const info: LayerInfo[] = this.layers
      .map((l) => ({ id: l.id, name: l.name, visible: l.visible, opacity: l.opacity, active: l.id === this.activeLayerId }))
      .reverse()
    this.onLayersChange?.(info)
  }

  // ---- pointer / stroke lifecycle -------------------------------------------

  pointerHover(x: number, y: number) {
    if (this.currentStroke || this.exporting) return
    this.cancelSizePreview()
    if (this.cursorDirty) this.rebuildCursor()
    this.cursorLayer.position.set(x, y)
    this.cursorLayer.visible = true
  }

  pointerLeave() {
    this.cursorLayer.visible = false
  }

  previewSize() {
    if (this.currentStroke) return
    if (this.cursorDirty) this.rebuildCursor()
    this.cursorLayer.position.set(this.width / 2, this.height / 2)
    this.cursorLayer.visible = true
    if (this.sizePreviewTimer) clearTimeout(this.sizePreviewTimer)
    this.sizePreviewTimer = setTimeout(() => {
      this.cursorLayer.visible = false
      this.sizePreviewTimer = null
    }, 700)
  }

  private cancelSizePreview() {
    if (this.sizePreviewTimer) {
      clearTimeout(this.sizePreviewTimer)
      this.sizePreviewTimer = null
    }
  }

  private rebuildCursor() {
    this.cursorDirty = false
    for (const child of [...this.cursorLayer.children]) child.destroy({ children: true })

    const radius = this.size / 2
    if (isWetBrush(this.brushId)) {
      const def = WET_BRUSHES[this.brushId]
      const tip = new Sprite(this.wetTips[def.tip])
      tip.anchor.set(0.5)
      tip.width = this.size
      tip.height = this.size
      tip.tint = this.color
      tip.alpha = 0.45
      this.cursorLayer.addChild(tip)
    }
    const ring = new Graphics()
    ring.circle(0, 0, radius).stroke({ width: 2.5, color: 0xffffff, alpha: 0.65 })
    ring.circle(0, 0, radius).stroke({ width: 1.2, color: 0x1e1e2e, alpha: 0.65 })
    if (this.brushId === 'wobble') {
      const span = Math.max(radius * 0.7, 7)
      ring.moveTo(-span, 0)
      for (let i = -span; i <= span; i += 1) ring.lineTo(i, Math.sin((i / span) * Math.PI * 2) * span * 0.3)
      ring.stroke({ width: 1.5, color: this.color, alpha: 0.9 })
    }
    this.cursorLayer.addChild(ring)
  }

  pointerDown(x: number, y: number, pressure: number) {
    if (this.exporting) return
    this.cursorLayer.visible = false
    this.redoStack = []
    this.currentStrokeLayerId = this.activeLayerId
    this.currentStroke = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      brush: this.brushId,
      color: this.color,
      size: this.size,
      points: [{ x, y, pressure }],
      wiggle: this.brushId === 'wobble' ? { ...this.wiggle } : undefined,
      wetWiggle:
        isWetBrush(this.brushId) && WET_BRUSHES[this.brushId].wiggleable !== false
          ? this.wetWiggle
          : undefined,
    }
    if (isWetBrush(this.brushId)) {
      this.wetStampedCount = 0
      this.app.renderer.render({ container: new Container(), target: this.silhouetteTexture, clear: true })
    }
    this.previewSprite.blendMode = isWetBrush(this.brushId) ? WET_BRUSHES[this.brushId].blend : 'normal'
    this.updatePreview()
    this.emitHistory()
  }

  pointerMove(x: number, y: number, pressure: number) {
    if (!this.currentStroke) return
    this.appendPoint(this.currentStroke.points, { x, y, pressure })
    this.previewDirty = true
  }

  pointerUp() {
    if (!this.currentStroke) return
    const stroke = this.currentStroke
    this.currentStroke = null
    this.clearPreview()

    if (stroke.points.length > 0) {
      const layer = this.layerById(this.currentStrokeLayerId) ?? this.active
      layer.strokes.push(stroke)
      this.commitStroke(layer, stroke)
      this.history.push({ layerId: layer.id, stroke })
    }
    this.emitHistory()
  }

  /** Routes a newly-added (or redone) stroke to its home within a layer. */
  private commitStroke(layer: PictureLayer, stroke: Stroke) {
    if (stroke.brush === 'wobble') return // tickWiggle draws it straight from layer.strokes
    if (isWetBrush(stroke.brush) && stroke.wetWiggle) {
      this.addWetWiggleStroke(layer, stroke)
      return
    }
    this.bakeStroke(layer, stroke)
  }

  undo() {
    if (this.history.length === 0) return
    const entry = this.history.pop()!
    const layer = this.layerById(entry.layerId)
    if (layer) {
      const i = layer.strokes.findIndex((s) => s.id === entry.stroke.id)
      if (i >= 0) layer.strokes.splice(i, 1)
      if (entry.stroke.brush === 'wobble') {
        this.removeWiggleGraphics(layer, entry.stroke.id)
      } else if (isWetBrush(entry.stroke.brush) && entry.stroke.wetWiggle) {
        this.destroyWetWiggleStroke(layer, entry.stroke.id)
      } else {
        this.rebuildBaked(layer) // no way to "unbake" a single stroke from the flattened texture
      }
    }
    this.redoStack.push(entry)
    this.emitHistory()
  }

  redo() {
    if (this.redoStack.length === 0) return
    const entry = this.redoStack.pop()!
    const layer = this.layerById(entry.layerId) ?? this.active
    layer.strokes.push(entry.stroke)
    this.commitStroke(layer, entry.stroke)
    this.history.push({ layerId: layer.id, stroke: entry.stroke })
    this.emitHistory()
  }

  /** Clears the ACTIVE layer only (a layered app's "clear" is per-layer). */
  clear() {
    const layer = this.active
    if (layer.strokes.length === 0) return
    layer.strokes = []
    this.history = this.history.filter((h) => h.layerId !== layer.id)
    this.redoStack = this.redoStack.filter((h) => h.layerId !== layer.id)
    this.clearTexture(layer)
    for (const [, g] of layer.wiggleGraphics) {
      layer.wiggleLayer.removeChild(g)
      g.destroy()
    }
    layer.wiggleGraphics.clear()
    for (const id of [...layer.wetWiggleStrokes.keys()]) this.destroyWetWiggleStroke(layer, id)
    this.emitHistory()
  }

  // ---- snapshot (survives a resize-driven engine recreation) ----------------

  getSnapshot(): PictureSnapshot {
    return {
      activeLayerId: this.activeLayerId,
      layers: this.layers.map((l) => ({
        id: l.id,
        name: l.name,
        visible: l.visible,
        opacity: l.opacity,
        strokes: l.strokes.map((s) => ({ ...s, points: [...s.points] })),
      })),
    }
  }

  loadSnapshot(snap: PictureSnapshot) {
    this.detachPreview() // don't let a destroyed layer root take the shared preview with it
    for (const layer of this.layers) {
      for (const wid of [...layer.wetWiggleStrokes.keys()]) this.destroyWetWiggleStroke(layer, wid)
      layer.destroy()
    }
    this.layers = []
    this.history = []
    this.redoStack = []

    for (const ls of snap.layers) {
      const layer = new PictureLayer(ls.id, ls.name, this.width, this.height, this.app.renderer.resolution)
      layer.visible = ls.visible
      layer.opacity = ls.opacity
      layer.strokes = ls.strokes.map((s) => ({ ...s, points: [...s.points] }))
      this.clearTexture(layer)
      this.layers.push(layer)
      this.rebuildBaked(layer)
      for (const stroke of layer.strokes) {
        if (isWetBrush(stroke.brush) && stroke.wetWiggle) this.addWetWiggleStroke(layer, stroke)
      }
      layer.applyDisplay()
    }
    if (this.layers.length === 0) this.layers.push(this.createLayer())
    this.activeLayerId = this.layerById(snap.activeLayerId)?.id ?? this.layers[this.layers.length - 1].id
    // History can't be reconstructed per-stroke across a reload; seed it so undo clears layers.
    this.restack()
    this.emitLayers()
    this.emitHistory()
  }

  // ---- export ---------------------------------------------------------------

  async exportPNG(): Promise<string> {
    const composite = RenderTexture.create({
      width: this.width,
      height: this.height,
      resolution: this.app.renderer.resolution,
    })
    const cursorWasVisible = this.cursorLayer.visible
    this.cursorLayer.visible = false
    this.app.renderer.render({ container: this.app.stage, target: composite })
    this.cursorLayer.visible = cursorWasVisible
    try {
      return await this.app.renderer.extract.base64(composite)
    } finally {
      composite.destroy(true)
    }
  }

  async exportGIF(duration = this.loopTime, fps = 20): Promise<Blob> {
    if (this.currentStroke) throw new Error('Finish the stroke before exporting')
    this.exporting = true
    const scale = Math.min(1, 1000 / Math.max(this.width, this.height))
    const composite = RenderTexture.create({ width: this.width, height: this.height, resolution: scale })
    const cursorWasVisible = this.cursorLayer.visible
    this.cursorLayer.visible = false

    // Loop-quantized stand-ins for every wobble stroke across all layers.
    const loopStep = (2 * Math.PI) / duration
    const loopedWobbles: { layer: PictureLayer; stroke: Stroke }[] = []
    for (const layer of this.layers) {
      for (const s of layer.strokes) {
        if (s.brush !== 'wobble') continue
        loopedWobbles.push({
          layer,
          stroke: {
            ...s,
            wiggle: s.wiggle && {
              ...s.wiggle,
              speed: s.wiggle.speed > 0 ? loopStep * Math.max(1, Math.round(s.wiggle.speed / loopStep)) : 0,
            },
          },
        })
      }
    }

    try {
      const gif = GIFEncoder()
      const frameCount = Math.max(1, Math.round(duration * fps))
      const delay = Math.round(1000 / fps)
      let palette: number[][] | null = null

      for (let i = 0; i < frameCount; i++) {
        const t = (i / fps) % duration
        for (const { layer, stroke } of loopedWobbles) this.updateWiggleGraphics(layer, stroke, t)
        for (const layer of this.layers) {
          for (const entry of layer.wetWiggleStrokes.values()) this.renderWetWiggleStroke(entry, t)
        }
        this.app.renderer.render({ container: this.app.stage, target: composite })
        const { pixels, width, height } = this.app.renderer.extract.pixels(composite)
        if (!palette) palette = quantize(pixels, 256, { format: 'rgb565' })
        gif.writeFrame(applyPalette(pixels, palette, 'rgb565'), width, height, {
          palette,
          delay,
          repeat: 0,
          first: i === 0,
        })
        await new Promise<void>((resolve) => {
          const channel = new MessageChannel()
          channel.port1.onmessage = () => resolve()
          channel.port2.postMessage(0)
        })
      }

      gif.finish()
      return new Blob([gif.bytes()], { type: 'image/gif' })
    } finally {
      this.exporting = false
      this.cursorLayer.visible = cursorWasVisible
      composite.destroy(true)
    }
  }

  destroy() {
    this.cancelSizePreview()
    this.detachPreview() // pull it out of the active layer root before that root is destroyed
    for (const layer of this.layers) {
      for (const id of [...layer.wetWiggleStrokes.keys()]) this.destroyWetWiggleStroke(layer, id)
      layer.destroy()
    }
    this.previewSprite.destroy()
    this.previewTexture.destroy(true)
    this.silhouetteTexture.destroy(true)
    this.washFilter.destroy()
    for (const tip of Object.values(this.wetTips)) tip.destroy(true)
    for (const texture of Object.values(this.paperTextures)) texture.destroy(true)
    this.textures.soft.destroy(true)
    this.textures.rough.destroy(true)
    this.textures.grain.destroy(true)
    this.app.destroy(false, { children: true, texture: true })
  }

  // ---- internals ------------------------------------------------------------

  private emitHistory() {
    this.onHistoryChange?.(this.history.length > 0, this.redoStack.length > 0)
  }

  private appendPoint(points: StrokePoint[], point: StrokePoint) {
    const last = points[points.length - 1]
    if (last && Math.hypot(point.x - last.x, point.y - last.y) < 1) return
    points.push(point)
  }

  private updatePreview() {
    // Wobble previews live in its own animated layer; everything else is a dab brush.
    if (!this.currentStroke || this.currentStroke.brush === 'wobble') {
      this.clearPreview()
      return
    }
    this.updateWetPreview(this.currentStroke)
  }

  private updateWetPreview(stroke: Stroke) {
    const def = WET_BRUSHES[stroke.brush as keyof typeof WET_BRUSHES]
    const spacing = Math.max(2, stroke.size * def.spacingFactor)
    const { dabs, totalLength } = computeDabs(stroke.points, stroke.size, spacing, def.jitter, hashSeed(stroke.id))
    const settledLength = totalLength - Math.max(WET_TAIL_PX, stroke.size)

    const fresh = dabs.filter((d) => d.index >= this.wetStampedCount && d.arcLength <= settledLength)
    if (fresh.length > 0) {
      const batch = new Container()
      stampDabs(batch, fresh, this.wetTips[def.tip], stroke.size)
      this.app.renderer.render({ container: batch, target: this.silhouetteTexture, clear: false })
      batch.destroy({ children: true })
      this.wetStampedCount = fresh[fresh.length - 1].index + 1
    }

    const washInput = new Container()
    washInput.addChild(new Sprite(this.silhouetteTexture))
    stampDabs(washInput, dabs.filter((d) => d.index >= this.wetStampedCount), this.wetTips[def.tip], stroke.size)
    this.washFilter.update({
      color: stroke.color,
      ...def.wash,
      time: performance.now() / 1000,
      wiggle: stroke.wetWiggle ? WET_WIGGLE_PX : 0,
      wiggleSpeed: (Math.PI * 2) / this.loopTime,
    })
    washInput.filters = [this.washFilter]
    this.app.renderer.render({ container: washInput, target: this.previewTexture, clear: true })
    washInput.filters = []
    washInput.destroy({ children: true })
  }

  private clearPreview() {
    this.app.renderer.render({ container: new Container(), target: this.previewTexture, clear: true })
  }

  private tickWiggle() {
    const liveWobbleLayerId = this.currentStroke?.brush === 'wobble' ? this.currentStrokeLayerId : null
    for (const layer of this.layers) {
      const hasWobble = liveWobbleLayerId === layer.id || layer.strokes.some((s) => s.brush === 'wobble')
      if (!hasWobble && layer.wiggleGraphics.size === 0) continue

      const time = performance.now() / 1000
      const activeIds = new Set<string>()
      for (const stroke of layer.strokes) {
        if (stroke.brush !== 'wobble') continue
        activeIds.add(stroke.id)
        this.updateWiggleGraphics(layer, stroke, time)
      }
      if (liveWobbleLayerId === layer.id && this.currentStroke) {
        activeIds.add(this.currentStroke.id)
        this.updateWiggleGraphics(layer, this.currentStroke, time)
      }
      for (const [id, g] of layer.wiggleGraphics) {
        if (activeIds.has(id)) continue
        layer.wiggleLayer.removeChild(g)
        g.destroy()
        layer.wiggleGraphics.delete(id)
      }
    }
  }

  private tickWetWiggle() {
    for (const layer of this.layers) {
      if (layer.wetWiggleStrokes.size === 0) continue
      const time = performance.now() / 1000
      for (const entry of layer.wetWiggleStrokes.values()) this.renderWetWiggleStroke(entry, time)
    }
  }

  private updateWiggleGraphics(layer: PictureLayer, stroke: Stroke, time: number) {
    let g = layer.wiggleGraphics.get(stroke.id)
    if (!g) {
      g = new Graphics()
      layer.wiggleGraphics.set(stroke.id, g)
      layer.wiggleLayer.addChild(g)
    }
    drawWiggleInto(g, stroke, time)
  }

  private removeWiggleGraphics(layer: PictureLayer, id: string) {
    const g = layer.wiggleGraphics.get(id)
    if (!g) return
    layer.wiggleLayer.removeChild(g)
    g.destroy()
    layer.wiggleGraphics.delete(id)
  }

  /** Only dab brushes ever bake — wobble lives in its animated layer, never flattened. */
  private bakeStroke(layer: PictureLayer, stroke: Stroke) {
    this.bakeWetStroke(layer, stroke)
  }

  private bakeWetStroke(layer: PictureLayer, stroke: Stroke) {
    const def = WET_BRUSHES[stroke.brush as keyof typeof WET_BRUSHES]
    const spacing = Math.max(2, stroke.size * def.spacingFactor)
    const { dabs } = computeDabs(stroke.points, stroke.size, spacing, def.jitter, hashSeed(stroke.id))

    const batch = new Container()
    stampDabs(batch, dabs, this.wetTips[def.tip], stroke.size)
    this.app.renderer.render({ container: batch, target: this.silhouetteTexture, clear: true })
    batch.destroy({ children: true })

    const washInput = new Container()
    washInput.addChild(new Sprite(this.silhouetteTexture))
    this.washFilter.update({ color: stroke.color, ...def.wash })
    washInput.filters = [this.washFilter]
    // Render the wash into a scratch texture (normal blend), then stamp it into the layer with a
    // blend-mode Sprite: a container's blendMode never reaches its filter's output quad, so the
    // multiply must happen at the sprite level. previewTexture doubles as the scratch.
    this.app.renderer.render({ container: washInput, target: this.previewTexture, clear: true })
    washInput.filters = []
    washInput.destroy({ children: true })

    const stamp = new Sprite(this.previewTexture)
    stamp.blendMode = def.blend
    // The stamp must be a CHILD of the rendered root — the root of an explicit render() doesn't
    // get its own blend state applied.
    const root = new Container()
    root.addChild(stamp)
    this.app.renderer.render({ container: root, target: layer.paintedTexture, clear: false })
    stamp.destroy()
    root.destroy()
    this.clearPreview()
  }

  private clearTexture(layer: PictureLayer) {
    const bg = new Graphics().rect(0, 0, this.width, this.height).fill({ color: BACKGROUND_COLOR })
    this.app.renderer.render({ container: bg, target: layer.paintedTexture, clear: true })
    bg.destroy()
  }

  private rebuildBaked(layer: PictureLayer) {
    this.clearTexture(layer)
    for (const stroke of layer.strokes) {
      if (stroke.brush === 'wobble') continue
      if (isWetBrush(stroke.brush) && stroke.wetWiggle) continue
      this.bakeStroke(layer, stroke)
    }
  }

  private addWetWiggleStroke(layer: PictureLayer, stroke: Stroke) {
    const def = WET_BRUSHES[stroke.brush as keyof typeof WET_BRUSHES]
    const spacing = Math.max(2, stroke.size * def.spacingFactor)
    const { dabs } = computeDabs(stroke.points, stroke.size, spacing, def.jitter, hashSeed(stroke.id))
    if (dabs.length === 0) return

    const pad = (stroke.size * (1 + def.jitter.size)) / 2 + WET_WIGGLE_PX + 6
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const dab of dabs) {
      if (dab.x < minX) minX = dab.x
      if (dab.x > maxX) maxX = dab.x
      if (dab.y < minY) minY = dab.y
      if (dab.y > maxY) maxY = dab.y
    }
    const origin = { x: Math.floor(minX - pad), y: Math.floor(minY - pad) }
    const width = Math.max(1, Math.ceil(maxX + pad) - origin.x)
    const height = Math.max(1, Math.ceil(maxY + pad) - origin.y)

    const resolution = this.app.renderer.resolution
    const silhouette = RenderTexture.create({ width, height, resolution })
    const batch = new Container()
    batch.position.set(-origin.x, -origin.y)
    stampDabs(batch, dabs, this.wetTips[def.tip], stroke.size)
    this.app.renderer.render({ container: batch, target: silhouette, clear: true })
    batch.destroy({ children: true })

    const wash = RenderTexture.create({ width, height, resolution })
    const washInput = new Container()
    washInput.addChild(new Sprite(silhouette))
    washInput.filters = [this.washFilter]

    const sprite = new Sprite(wash)
    sprite.position.set(origin.x, origin.y)
    sprite.blendMode = def.blend
    layer.wetWiggleLayer.addChild(sprite)

    const entry: WetWiggleEntry = { stroke, origin, silhouette, wash, washInput, sprite }
    layer.wetWiggleStrokes.set(stroke.id, entry)
    this.renderWetWiggleStroke(entry, performance.now() / 1000)
  }

  private renderWetWiggleStroke(entry: WetWiggleEntry, time: number) {
    const def = WET_BRUSHES[entry.stroke.brush as keyof typeof WET_BRUSHES]
    this.washFilter.update({
      color: entry.stroke.color,
      ...def.wash,
      time,
      wiggle: WET_WIGGLE_PX,
      wiggleSpeed: (Math.PI * 2) / this.loopTime,
      paperOffset: entry.origin,
    })
    this.app.renderer.render({ container: entry.washInput, target: entry.wash, clear: true })
  }

  private destroyWetWiggleStroke(layer: PictureLayer, id: string) {
    const entry = layer.wetWiggleStrokes.get(id)
    if (!entry) return
    entry.washInput.filters = [] // the wash filter is shared — don't let destroy take it
    entry.washInput.destroy({ children: true })
    layer.wetWiggleLayer.removeChild(entry.sprite)
    entry.sprite.destroy()
    entry.silhouette.destroy(true)
    entry.wash.destroy(true)
    layer.wetWiggleStrokes.delete(id)
  }
}
