import { Application, Container, Graphics, RenderTexture, Sprite, TilingSprite, type Texture } from 'pixi.js'
import { DEFAULT_WIGGLE, type BrushId, type BrushTextures, type ClassicBrushId, type Stroke, type StrokePoint, type WiggleSettings } from './brush-types'
import { brushes } from './brushes'
import { drawWiggleInto } from './brushes/wobble'
import { createSoftTexture, createRoughTexture, createGrainTexture } from './textures'
import { createPaperTextures, DEFAULT_PAPER, PAPER_TILE_SIZE, type PaperId } from './papers'
import { createWetTips, type WetTips } from './tips'
import { computeDabs, stampDabs } from './stamping'
import { WET_BRUSHES, isWetBrush } from './wet-brushes'
import { WashFilter } from './wash-filter'
import { hashSeed } from './random'

const BACKGROUND_COLOR = 0xffffff

/** During a live wet stroke, the last stretch of the path is left un-stamped and re-rendered
 * fresh each frame instead: perfect-freehand's streamline smoothing keeps shifting the most
 * recent points, so dabs stamped there too early would freeze in soon-to-be-wrong positions. */
const WET_TAIL_PX = 64

/** Edge-orbit radius (px) for wet strokes with the wiggle toggle on. */
const WET_WIGGLE_PX = 2.5

export class PaintEngine {
  readonly app: Application
  readonly width: number
  readonly height: number

  /** Round/watercolor strokes are baked in once and left alone — cheap, and they never change. */
  private paintedTexture: RenderTexture
  private textures: BrushTextures

  /** Bottom layer: the sheet of paper. Paint layers multiply over it, so its texture shows
   * through everywhere there's pigment — the paper is part of the picture, not just a backdrop. */
  private paperSprite: TilingSprite
  private paperTextures: Record<PaperId, Texture>
  private paperId: PaperId = DEFAULT_PAPER

  /** Wiggly strokes keep rippling forever, so they stay as live display objects (one reused
   * Graphics per stroke, cleared + redrawn in place every frame) instead of flattened pixels. */
  private wiggleLayer = new Container()
  private wiggleGraphics = new Map<string, Graphics>()

  /** Topmost layer: the hover brush preview — a ghost of the tip that follows the pointer so
   * you can see what you're about to put down. Rebuilt lazily when brush/color/size change,
   * hidden while drawing and excluded from exports. */
  private cursorLayer = new Container()
  private cursorDirty = true
  private sizePreviewTimer: ReturnType<typeof setTimeout> | null = null

  /** Live preview for the in-progress round/watercolor stroke only — wiggly strokes preview via
   * wiggleLayer instead, since they're already drawn there whether committed or not.
   * Rendered into a texture via an explicit renderer.render() call (same as baking), rather than
   * added straight into the stage tree: a Container with blendMode + filtered children (as
   * watercolor uses) composites correctly through an explicit render-to-texture call, but
   * incorrectly (rendering black) when it's a permanent part of the auto-rendered stage tree. */
  private previewTexture: RenderTexture
  private previewSprite: Sprite

  /** Wet-brush pipeline: dabs are stamped into a shared full-canvas silhouette texture, and the
   * wash filter turns that silhouette into pigment (wet edge, granulation, flat opacity). One
   * filter instance is reused for every wet render; its uniforms are set per stroke. */
  private silhouetteTexture: RenderTexture
  private wetTips: WetTips
  private washFilter: WashFilter
  /** How many dabs of the in-progress wet stroke are already stamped into silhouetteTexture. */
  private wetStampedCount = 0

  /** Wet strokes with the wiggle toggle stay alive instead of baking: each keeps its stamped
   * silhouette in a stroke-sized texture (stamped once), and every frame one wash pass with an
   * advancing clock re-renders it into its display texture — the edge orbits, nothing restamps. */
  private wetWiggleLayer = new Container()
  private wetWiggleStrokes = new Map<
    string,
    {
      stroke: Stroke
      origin: { x: number; y: number }
      silhouette: RenderTexture
      wash: RenderTexture
      washInput: Container
      sprite: Sprite
    }
  >()

  private strokes: Stroke[] = []
  private redoStack: Stroke[] = []
  private currentStroke: Stroke | null = null
  /** Set on pointerMove, consumed once per ticker frame — coalesces preview renders. */
  private previewDirty = false

  private brushId: BrushId = 'round'
  private color = '#1e1e2e'
  private size = 18
  private wiggle: WiggleSettings = { ...DEFAULT_WIGGLE }
  private wetWiggle = false

  private onHistoryChange?: (canUndo: boolean, canRedo: boolean) => void

  private constructor(app: Application, width: number, height: number) {
    this.app = app
    this.width = width
    this.height = height

    this.paintedTexture = RenderTexture.create({ width, height, resolution: app.renderer.resolution })
    this.previewTexture = RenderTexture.create({ width, height, resolution: app.renderer.resolution })
    this.textures = { soft: createSoftTexture(), rough: createRoughTexture(), grain: createGrainTexture() }

    this.paperTextures = createPaperTextures()
    this.paperSprite = new TilingSprite({ texture: this.paperTextures[this.paperId], width, height })

    this.silhouetteTexture = RenderTexture.create({ width, height, resolution: app.renderer.resolution })
    this.wetTips = createWetTips()
    this.washFilter = new WashFilter(this.paperTextures[this.paperId], PAPER_TILE_SIZE)

    const paintedSprite = new Sprite(this.paintedTexture)
    // The painted layer starts as flat white (multiply-neutral) and strokes multiply into it, so
    // multiplying the whole layer over the paper leaves bare paper untouched and lets its grain
    // show through the pigment — the same way real washes reveal the sheet's tooth.
    paintedSprite.blendMode = 'multiply'
    this.previewSprite = new Sprite(this.previewTexture)
    app.stage.addChild(this.paperSprite)
    app.stage.addChild(paintedSprite)
    app.stage.addChild(this.wetWiggleLayer)
    app.stage.addChild(this.wiggleLayer)
    app.stage.addChild(this.previewSprite)
    this.cursorLayer.visible = false
    app.stage.addChild(this.cursorLayer)

    this.clearTexture()

    app.ticker.add(() => {
      // A live wiggle-on wet stroke animates even while the pointer holds still — its edge
      // orbit advances with the clock, not with input.
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

  setHistoryListener(fn: (canUndo: boolean, canRedo: boolean) => void) {
    this.onHistoryChange = fn
    this.emitHistory()
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

  setPaper(id: PaperId) {
    if (id === this.paperId) return
    this.paperId = id
    this.paperSprite.texture = this.paperTextures[id]
    // Wet-brush granulation samples the paper — rebake so existing strokes settle into the new sheet.
    this.washFilter.setPaper(this.paperTextures[id])
    this.rebuildBaked()
  }

  /** Pointer is moving over the canvas without drawing — show the brush ghost there. */
  pointerHover(x: number, y: number) {
    if (this.currentStroke) return
    this.cancelSizePreview()
    if (this.cursorDirty) this.rebuildCursor()
    this.cursorLayer.position.set(x, y)
    this.cursorLayer.visible = true
  }

  pointerLeave() {
    this.cursorLayer.visible = false
  }

  /** Flashes the brush ghost true-to-size in the middle of the canvas — feedback while
   * dragging the size slider, where the pointer isn't over the canvas to show it in place. */
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

  /** The ghost shows the actual footprint: wet brushes stamp their real (tinted, translucent)
   * tip texture, the ink brushes show a ring — plus a two-tone outline so it reads on any
   * color underneath. */
  private rebuildCursor() {
    this.cursorDirty = false
    for (const child of [...this.cursorLayer.children]) child.destroy({ children: true })

    const radius = this.size / 2
    if (isWetBrush(this.brushId)) {
      const def = WET_BRUSHES[this.brushId as keyof typeof WET_BRUSHES]
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
      // A tiny sine squiggle inside the ring — this one draws wiggly lines, not dabs.
      const span = Math.max(radius * 0.7, 7)
      ring.moveTo(-span, 0)
      for (let i = -span; i <= span; i += 1) ring.lineTo(i, Math.sin((i / span) * Math.PI * 2) * span * 0.3)
      ring.stroke({ width: 1.5, color: this.color, alpha: 0.9 })
    } else if (this.brushId === 'round') {
      ring.circle(0, 0, Math.max(1.5, radius - 2)).fill({ color: this.color, alpha: 0.25 })
    }
    this.cursorLayer.addChild(ring)
  }

  pointerDown(x: number, y: number, pressure: number) {
    this.cursorLayer.visible = false
    this.redoStack = []
    this.currentStroke = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      brush: this.brushId,
      color: this.color,
      size: this.size,
      points: [{ x, y, pressure }],
      wiggle: this.brushId === 'wobble' ? { ...this.wiggle } : undefined,
      wetWiggle: isWetBrush(this.brushId) ? this.wetWiggle : undefined,
    }
    if (isWetBrush(this.brushId)) {
      this.wetStampedCount = 0
      this.app.renderer.render({ container: new Container(), target: this.silhouetteTexture, clear: true })
    }
    // Wet strokes bake with multiply, so the live preview must composite the same way —
    // otherwise a glaze dragged across existing paint shows as an opaque overlay while the
    // pointer is down and visibly snaps darker on release. Round strokes bake with normal
    // blending, so their preview stays normal. (Transparent preview pixels are no-ops under
    // both modes.)
    this.previewSprite.blendMode = isWetBrush(this.brushId) ? 'multiply' : 'normal'
    this.updatePreview()
    this.emitHistory()
  }

  pointerMove(x: number, y: number, pressure: number) {
    if (!this.currentStroke) return
    this.appendPoint(this.currentStroke.points, { x, y, pressure })
    // Don't render here: pointer events can outrun the display (120-240Hz pens deliver several
    // moves per vsync) and every preview render but the last per frame is discarded work. The
    // ticker picks the flag up once per frame.
    this.previewDirty = true
  }

  pointerUp() {
    if (!this.currentStroke) return
    const stroke = this.currentStroke
    this.currentStroke = null
    this.clearPreview()

    if (stroke.points.length > 0) {
      this.strokes.push(stroke)
      this.commitStroke(stroke)
    }
    this.emitHistory()
  }

  /** Routes a newly-added (or redone) stroke to its home: wobble strokes are already live in
   * wiggleLayer; wiggle-on wet strokes become a live animated entry; everything else gets
   * flattened into the static texture once. */
  private commitStroke(stroke: Stroke) {
    if (stroke.brush === 'wobble') return
    if (isWetBrush(stroke.brush) && stroke.wetWiggle) {
      this.addWetWiggleStroke(stroke)
      return
    }
    this.bakeStroke(stroke)
  }

  undo() {
    if (this.strokes.length === 0) return
    const stroke = this.strokes.pop()!
    this.redoStack.push(stroke)
    if (stroke.brush === 'wobble') {
      this.removeWiggleGraphics(stroke.id)
    } else if (isWetBrush(stroke.brush) && stroke.wetWiggle) {
      this.destroyWetWiggleStroke(stroke.id) // live entry — nothing was baked
    } else {
      this.rebuildBaked() // no way to "unbake" a single stroke from the flattened texture
    }
    this.emitHistory()
  }

  redo() {
    if (this.redoStack.length === 0) return
    const stroke = this.redoStack.pop()!
    this.strokes.push(stroke)
    this.commitStroke(stroke)
    this.emitHistory()
  }

  clear() {
    if (this.strokes.length === 0) return
    this.strokes = []
    this.redoStack = []
    this.clearTexture()
    for (const [, g] of this.wiggleGraphics) {
      this.wiggleLayer.removeChild(g)
      g.destroy()
    }
    this.wiggleGraphics.clear()
    for (const id of [...this.wetWiggleStrokes.keys()]) this.destroyWetWiggleStroke(id)
    this.emitHistory()
  }

  async exportPNG(): Promise<string> {
    // The picture is split across a baked texture and a live wiggle layer — composite the
    // whole stage into a throwaway texture so the export reflects both.
    const composite = RenderTexture.create({
      width: this.width,
      height: this.height,
      resolution: this.app.renderer.resolution,
    })
    // The hover brush ghost is UI, not artwork — keep it out of the export.
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

  destroy() {
    this.cancelSizePreview()
    for (const id of [...this.wetWiggleStrokes.keys()]) this.destroyWetWiggleStroke(id)
    // Resources app.destroy can't reach: not referenced by any stage object (or, for the
    // paper textures, only the active one is).
    this.silhouetteTexture.destroy(true)
    this.washFilter.destroy()
    this.wetTips.sharp.destroy(true)
    this.wetTips.splotch.destroy(true)
    for (const texture of Object.values(this.paperTextures)) texture.destroy(true)
    this.textures.soft.destroy(true)
    this.textures.rough.destroy(true)
    this.textures.grain.destroy(true)
    // removeView: false — React owns the <canvas> DOM node, Pixi should only clean up its internal resources.
    this.app.destroy(false, { children: true, texture: true })
  }

  private emitHistory() {
    this.onHistoryChange?.(this.strokes.length > 0, this.redoStack.length > 0)
  }

  private appendPoint(points: StrokePoint[], point: StrokePoint) {
    const last = points[points.length - 1]
    if (last && Math.hypot(point.x - last.x, point.y - last.y) < 1) return
    points.push(point)
  }

  private updatePreview() {
    if (!this.currentStroke || this.currentStroke.brush === 'wobble') {
      this.clearPreview()
      return
    }
    if (isWetBrush(this.currentStroke.brush)) {
      this.updateWetPreview(this.currentStroke)
      return
    }
    const brush = brushes[this.currentStroke.brush]
    const g = brush.render(this.currentStroke, this.textures)
    this.app.renderer.render({ container: g, target: this.previewTexture, clear: true })
    g.destroy({ children: true })
  }

  /** Incremental wet preview: dabs that are far enough behind the pointer get stamped into the
   * silhouette texture once and never touched again; only the still-settling tail is restamped
   * per frame. The wash pass then runs over silhouette + tail together. Rendered with normal
   * blending (the preview sprite composites it over the canvas); the true multiply-over-canvas
   * happens at bake time, and since paint sits on near-white paper the two are visually
   * near-identical. */
  private updateWetPreview(stroke: Stroke) {
    const def = WET_BRUSHES[stroke.brush as keyof typeof WET_BRUSHES]
    const spacing = Math.max(2, stroke.size * def.spacingFactor)
    const { dabs, totalLength } = computeDabs(stroke.points, stroke.size, spacing, def.jitter, hashSeed(stroke.id))
    // Tail at least one brush-width long: perfect-freehand also re-parameterizes roughly the
    // first `size` px of arc length while points are still arriving, so with large brushes a
    // fixed 64px tail could permanently stamp dabs the final bake would place elsewhere.
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
    })
    washInput.filters = [this.washFilter]
    this.app.renderer.render({ container: washInput, target: this.previewTexture, clear: true })
    washInput.filters = [] // detach before destroy — the filter is shared and reused
    washInput.destroy({ children: true })
  }

  private clearPreview() {
    this.app.renderer.render({ container: new Container(), target: this.previewTexture, clear: true })
  }

  private tickWiggle() {
    const hasLiveWobble = this.currentStroke?.brush === 'wobble'
    if (!hasLiveWobble && this.wiggleGraphics.size === 0 && !this.strokes.some((s) => s.brush === 'wobble')) {
      return // nothing animating — stay idle
    }

    const time = performance.now() / 1000
    const activeIds = new Set<string>()

    for (const stroke of this.strokes) {
      if (stroke.brush !== 'wobble') continue
      activeIds.add(stroke.id)
      this.updateWiggleGraphics(stroke, time)
    }
    if (hasLiveWobble) {
      activeIds.add(this.currentStroke!.id)
      this.updateWiggleGraphics(this.currentStroke!, time)
    }

    for (const [id, g] of this.wiggleGraphics) {
      if (activeIds.has(id)) continue
      this.wiggleLayer.removeChild(g)
      g.destroy()
      this.wiggleGraphics.delete(id)
    }
  }

  private tickWetWiggle() {
    if (this.wetWiggleStrokes.size === 0) return
    const time = performance.now() / 1000
    for (const entry of this.wetWiggleStrokes.values()) this.renderWetWiggleStroke(entry, time)
  }

  private updateWiggleGraphics(stroke: Stroke, time: number) {
    let g = this.wiggleGraphics.get(stroke.id)
    if (!g) {
      g = new Graphics()
      this.wiggleGraphics.set(stroke.id, g)
      this.wiggleLayer.addChild(g)
    }
    drawWiggleInto(g, stroke, time)
  }

  private removeWiggleGraphics(id: string) {
    const g = this.wiggleGraphics.get(id)
    if (!g) return
    this.wiggleLayer.removeChild(g)
    g.destroy()
    this.wiggleGraphics.delete(id)
  }

  private bakeStroke(stroke: Stroke) {
    if (isWetBrush(stroke.brush)) {
      this.bakeWetStroke(stroke)
      return
    }
    const brush = brushes[stroke.brush as ClassicBrushId]
    const g = brush.render(stroke, this.textures)
    this.app.renderer.render({ container: g, target: this.paintedTexture, clear: false })
    g.destroy({ children: true })
  }

  /** Full, from-scratch bake of a wet stroke — all dabs restamped from the stroke's final points,
   * ignoring whatever the incremental preview left in the silhouette texture. That keeps the
   * committed pixels a pure function of the stroke data, so undo-rebakes and redo reproduce the
   * stroke exactly. (The live preview can differ by a hair at the tail; that settle-on-release is
   * inherent to streamline smoothing.) */
  private bakeWetStroke(stroke: Stroke) {
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
    // Two-step composite. A container's blendMode does NOT reach its filter's output quad —
    // the quad draws with the filtered node's own (normal) blend, so wrapping a filtered
    // container in a multiply parent silently bakes with normal blending (measured directly:
    // a glaze over existing paint committed the normal-blend pixel value, not the multiply
    // one; invisible over bare paper, where the two agree). So: render the wash into a
    // scratch texture with normal blending, then stamp that into the painting with a multiply
    // Sprite — sprite-level multiply is the same proven path the painted layer itself uses.
    // previewTexture doubles as the scratch: a bake happens exactly when the preview retires,
    // and it's re-cleared right after.
    this.app.renderer.render({ container: washInput, target: this.previewTexture, clear: true })
    washInput.filters = [] // detach before destroy — the filter is shared and reused
    washInput.destroy({ children: true })

    const stamp = new Sprite(this.previewTexture)
    stamp.blendMode = 'multiply'
    // The stamp must be a CHILD of the rendered root: the root container of an explicit
    // render() doesn't get its own blend state applied (this, not filters, is why earlier
    // attempts at multiply-on-the-wrapper silently baked with normal blending).
    const root = new Container()
    root.addChild(stamp)
    this.app.renderer.render({ container: root, target: this.paintedTexture, clear: false })
    stamp.destroy() // sprite only — previewTexture is engine-owned
    root.destroy()
    this.clearPreview()
  }

  private clearTexture() {
    const bg = new Graphics().rect(0, 0, this.width, this.height).fill({ color: BACKGROUND_COLOR })
    this.app.renderer.render({ container: bg, target: this.paintedTexture, clear: true })
    bg.destroy()
  }

  private rebuildBaked() {
    this.clearTexture()
    for (const stroke of this.strokes) {
      // Wobble and wiggle-on wet strokes live in their own animated layers, never in the bake.
      if (stroke.brush === 'wobble') continue
      if (isWetBrush(stroke.brush) && stroke.wetWiggle) continue
      this.bakeStroke(stroke)
    }
  }

  /** Creates the live entry for a wiggle-on wet stroke: silhouette stamped once into a
   * stroke-sized texture, plus a same-sized display texture the animated wash renders into,
   * shown by a multiply sprite positioned at the stroke's canvas origin. */
  private addWetWiggleStroke(stroke: Stroke) {
    const def = WET_BRUSHES[stroke.brush as keyof typeof WET_BRUSHES]
    const spacing = Math.max(2, stroke.size * def.spacingFactor)
    const { dabs } = computeDabs(stroke.points, stroke.size, spacing, def.jitter, hashSeed(stroke.id))
    if (dabs.length === 0) return

    // Stroke bounds with room for the tip radius (incl. size jitter), the edge orbit, and a
    // little slack — the wash displaces its lookup, so starved padding would clip the boil.
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
    washInput.filters = [this.washFilter] // shared — detached before destroy

    const sprite = new Sprite(wash)
    sprite.position.set(origin.x, origin.y)
    sprite.blendMode = 'multiply'
    this.wetWiggleLayer.addChild(sprite)

    this.wetWiggleStrokes.set(stroke.id, { stroke, origin, silhouette, wash, washInput, sprite })
    this.renderWetWiggleStroke(this.wetWiggleStrokes.get(stroke.id)!, performance.now() / 1000)
  }

  private renderWetWiggleStroke(
    entry: NonNullable<ReturnType<typeof this.wetWiggleStrokes.get>>,
    time: number,
  ) {
    const def = WET_BRUSHES[entry.stroke.brush as keyof typeof WET_BRUSHES]
    this.washFilter.update({
      color: entry.stroke.color,
      ...def.wash,
      time,
      wiggle: WET_WIGGLE_PX,
      paperOffset: entry.origin,
    })
    this.app.renderer.render({ container: entry.washInput, target: entry.wash, clear: true })
  }

  private destroyWetWiggleStroke(id: string) {
    const entry = this.wetWiggleStrokes.get(id)
    if (!entry) return
    entry.washInput.filters = [] // the wash filter is shared — don't let destroy take it
    entry.washInput.destroy({ children: true })
    this.wetWiggleLayer.removeChild(entry.sprite)
    entry.sprite.destroy()
    entry.silhouette.destroy(true)
    entry.wash.destroy(true)
    this.wetWiggleStrokes.delete(id)
  }
}
