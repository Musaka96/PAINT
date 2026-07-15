import { Application, Container, Graphics, RenderTexture, Sprite } from 'pixi.js'
import type { BrushId, BrushTextures, Stroke, StrokePoint } from './brush-types'
import { brushes } from './brushes'
import { createSoftTexture, createRoughTexture } from './textures'

const BACKGROUND_COLOR = 0xffffff

export class PaintEngine {
  readonly app: Application
  readonly width: number
  readonly height: number

  private paintedTexture: RenderTexture
  private previewContainer = new Container()
  private textures: BrushTextures

  private strokes: Stroke[] = []
  private redoStack: Stroke[] = []
  private currentStroke: Stroke | null = null

  private brushId: BrushId = 'round'
  private color = '#1e1e2e'
  private size = 18

  private onHistoryChange?: (canUndo: boolean, canRedo: boolean) => void

  private constructor(app: Application, width: number, height: number) {
    this.app = app
    this.width = width
    this.height = height

    this.paintedTexture = RenderTexture.create({ width, height, resolution: app.renderer.resolution })
    this.textures = { soft: createSoftTexture(), rough: createRoughTexture() }

    const paintedSprite = new Sprite(this.paintedTexture)
    app.stage.addChild(paintedSprite)
    app.stage.addChild(this.previewContainer)

    this.clearTexture()

    // Keeps animated brushes (e.g. the wiggly tail) redrawing every frame while a stroke is in progress,
    // even if the pointer briefly holds still.
    app.ticker.add(() => {
      if (this.currentStroke) this.updatePreview()
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

  pointerDown(x: number, y: number, pressure: number) {
    this.redoStack = []
    this.currentStroke = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      brush: this.brushId,
      color: this.color,
      size: this.size,
      points: [{ x, y, pressure }],
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
    this.previewContainer.removeChildren()

    if (stroke.points.length > 0) {
      this.strokes.push(stroke)
      this.bakeStroke(stroke)
    }
    this.emitHistory()
  }

  undo() {
    if (this.strokes.length === 0) return
    const stroke = this.strokes.pop()!
    this.redoStack.push(stroke)
    this.rebuild()
    this.emitHistory()
  }

  redo() {
    if (this.redoStack.length === 0) return
    const stroke = this.redoStack.pop()!
    this.strokes.push(stroke)
    this.bakeStroke(stroke)
    this.emitHistory()
  }

  clear() {
    if (this.strokes.length === 0) return
    this.strokes = []
    this.redoStack = []
    this.clearTexture()
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

  private updatePreview() {
    this.previewContainer.removeChildren()
    if (!this.currentStroke) return
    const brush = brushes[this.currentStroke.brush]
    this.previewContainer.addChild(brush.render(this.currentStroke, this.textures, performance.now() / 1000))
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

  private rebuild() {
    this.clearTexture()
    for (const stroke of this.strokes) this.bakeStroke(stroke)
  }
}
