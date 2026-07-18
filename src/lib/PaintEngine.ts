import { Application, Container, Graphics, RenderTexture, Sprite, TilingSprite, type Texture } from 'pixi.js'
import { DEFAULT_WIGGLE, type BrushId, type BrushTextures, type Stroke, type StrokePoint, type WiggleSettings } from './brush-types'
import { brushes } from './brushes'
import { drawWiggleInto } from './brushes/wobble'
import { createSoftTexture, createRoughTexture, createGrainTexture } from './textures'
import { createPaperTextures, DEFAULT_PAPER, type PaperId } from './papers'

const BACKGROUND_COLOR = 0xffffff

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

  /** Live preview for the in-progress round/watercolor stroke only — wiggly strokes preview via
   * wiggleLayer instead, since they're already drawn there whether committed or not.
   * Rendered into a texture via an explicit renderer.render() call (same as baking), rather than
   * added straight into the stage tree: a Container with blendMode + filtered children (as
   * watercolor uses) composites correctly through an explicit render-to-texture call, but
   * incorrectly (rendering black) when it's a permanent part of the auto-rendered stage tree. */
  private previewTexture: RenderTexture
  private previewSprite: Sprite

  private strokes: Stroke[] = []
  private redoStack: Stroke[] = []
  private currentStroke: Stroke | null = null

  private brushId: BrushId = 'round'
  private color = '#1e1e2e'
  private size = 18
  private wiggle: WiggleSettings = { ...DEFAULT_WIGGLE }

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

    const paintedSprite = new Sprite(this.paintedTexture)
    // The painted layer starts as flat white (multiply-neutral) and strokes multiply into it, so
    // multiplying the whole layer over the paper leaves bare paper untouched and lets its grain
    // show through the pigment — the same way real washes reveal the sheet's tooth.
    paintedSprite.blendMode = 'multiply'
    this.previewSprite = new Sprite(this.previewTexture)
    app.stage.addChild(this.paperSprite)
    app.stage.addChild(paintedSprite)
    app.stage.addChild(this.wiggleLayer)
    app.stage.addChild(this.previewSprite)

    this.clearTexture()

    app.ticker.add(() => this.tickWiggle())
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
  }

  setColor(color: string) {
    this.color = color
  }

  setSize(size: number) {
    this.size = size
  }

  setWiggle(settings: Partial<WiggleSettings>) {
    this.wiggle = { ...this.wiggle, ...settings }
  }

  setPaper(id: PaperId) {
    if (id === this.paperId) return
    this.paperId = id
    this.paperSprite.texture = this.paperTextures[id]
  }

  pointerDown(x: number, y: number, pressure: number) {
    this.redoStack = []
    this.currentStroke = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      brush: this.brushId,
      color: this.color,
      size: this.size,
      points: [{ x, y, pressure }],
      wiggle: this.brushId === 'wobble' ? { ...this.wiggle } : undefined,
    }
    this.updatePreview()
    this.emitHistory()
  }

  pointerMove(x: number, y: number, pressure: number) {
    if (!this.currentStroke) return
    this.appendPoint(this.currentStroke.points, { x, y, pressure })
    this.updatePreview()
  }

  pointerUp() {
    if (!this.currentStroke) return
    const stroke = this.currentStroke
    this.currentStroke = null
    this.clearPreview()

    if (stroke.points.length > 0) {
      this.strokes.push(stroke)
      // Wiggly strokes are already live in wiggleLayer (tickWiggle tracks `strokes` directly) —
      // nothing to bake. Everything else gets flattened into the static texture once.
      if (stroke.brush !== 'wobble') this.bakeStroke(stroke)
    }
    this.emitHistory()
  }

  undo() {
    if (this.strokes.length === 0) return
    const stroke = this.strokes.pop()!
    this.redoStack.push(stroke)
    if (stroke.brush === 'wobble') {
      this.removeWiggleGraphics(stroke.id)
    } else {
      this.rebuildBaked() // no way to "unbake" a single stroke from the flattened texture
    }
    this.emitHistory()
  }

  redo() {
    if (this.redoStack.length === 0) return
    const stroke = this.redoStack.pop()!
    this.strokes.push(stroke)
    if (stroke.brush !== 'wobble') this.bakeStroke(stroke)
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
    this.app.renderer.render({ container: this.app.stage, target: composite })
    try {
      return await this.app.renderer.extract.base64(composite)
    } finally {
      composite.destroy(true)
    }
  }

  destroy() {
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
    const brush = brushes[this.currentStroke.brush]
    const g = brush.render(this.currentStroke, this.textures)
    this.app.renderer.render({ container: g, target: this.previewTexture, clear: true })
    g.destroy({ children: true })
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
    const brush = brushes[stroke.brush]
    const g = brush.render(stroke, this.textures)
    this.app.renderer.render({ container: g, target: this.paintedTexture, clear: false })
    g.destroy({ children: true })
  }

  private clearTexture() {
    const bg = new Graphics().rect(0, 0, this.width, this.height).fill({ color: BACKGROUND_COLOR })
    this.app.renderer.render({ container: bg, target: this.paintedTexture, clear: true })
    bg.destroy()
  }

  private rebuildBaked() {
    this.clearTexture()
    for (const stroke of this.strokes) {
      if (stroke.brush !== 'wobble') this.bakeStroke(stroke)
    }
  }
}
