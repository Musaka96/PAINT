import { Application, Graphics, RenderTexture, Sprite } from 'pixi.js'
import { DEFAULT_WIGGLE, type BrushId, type BrushTextures, type Stroke, type StrokePoint, type WiggleSettings } from './brush-types'
import { brushes } from './brushes'
import { createSoftTexture, createRoughTexture } from './textures'

const BACKGROUND_COLOR = 0xffffff

export class PaintEngine {
  readonly app: Application
  readonly width: number
  readonly height: number

  private paintedTexture: RenderTexture
  private textures: BrushTextures

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
    this.textures = { soft: createSoftTexture(), rough: createRoughTexture() }

    const paintedSprite = new Sprite(this.paintedTexture)
    app.stage.addChild(paintedSprite)

    this.redraw()

    // Committed wiggly strokes keep animating forever, and the in-progress stroke needs live
    // feedback — in both cases we redraw the whole picture from `strokes` every frame. Once
    // nothing needs animating, this becomes a no-op and the canvas stays static (cheap).
    app.ticker.add(() => {
      if (this.isAnimating()) this.redraw()
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
    this.redraw()
    this.emitHistory()
  }

  pointerMove(x: number, y: number, pressure: number) {
    if (!this.currentStroke) return
    this.appendPoint(this.currentStroke.points, { x, y, pressure })
    this.redraw()
  }

  pointerUp() {
    if (!this.currentStroke) return
    const stroke = this.currentStroke
    this.currentStroke = null

    if (stroke.points.length > 0) {
      this.strokes.push(stroke)
    }
    this.redraw()
    this.emitHistory()
  }

  undo() {
    if (this.strokes.length === 0) return
    const stroke = this.strokes.pop()!
    this.redoStack.push(stroke)
    this.redraw()
    this.emitHistory()
  }

  redo() {
    if (this.redoStack.length === 0) return
    const stroke = this.redoStack.pop()!
    this.strokes.push(stroke)
    this.redraw()
    this.emitHistory()
  }

  clear() {
    if (this.strokes.length === 0) return
    this.strokes = []
    this.redoStack = []
    this.redraw()
    this.emitHistory()
  }

  exportPNG(): Promise<string> {
    return this.app.renderer.extract.base64(this.paintedTexture)
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

  private isAnimating(): boolean {
    return this.currentStroke !== null || this.strokes.some((s) => s.brush === 'wobble')
  }

  private redraw() {
    const time = performance.now() / 1000
    const bg = new Graphics().rect(0, 0, this.width, this.height).fill({ color: BACKGROUND_COLOR })
    this.app.renderer.render({ container: bg, target: this.paintedTexture, clear: true })
    bg.destroy()

    for (const stroke of this.strokes) this.paint(stroke, time)
    if (this.currentStroke) this.paint(this.currentStroke, time)
  }

  private paint(stroke: Stroke, time: number) {
    const brush = brushes[stroke.brush]
    const g = brush.render(stroke, this.textures, brush.id === 'wobble' ? time : undefined)
    this.app.renderer.render({ container: g, target: this.paintedTexture, clear: false })
    g.destroy({ children: true })
  }
}
