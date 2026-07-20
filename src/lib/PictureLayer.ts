import { Container, Graphics, RenderTexture, Sprite } from 'pixi.js'
import type { Stroke } from './brush-types'

/** A wiggle-on wet stroke that stays live: its stamped silhouette in a stroke-sized texture, a
 * same-sized display texture the animated wash re-renders each frame, and the sprite showing it. */
export interface WetWiggleEntry {
  stroke: Stroke
  origin: { x: number; y: number }
  silhouette: RenderTexture
  wash: RenderTexture
  washInput: Container
  sprite: Sprite
}

/**
 * One drawing surface in the layer stack. Owns everything that belongs to a single picture
 * layer: its stroke list, its baked (white-cleared, multiply) texture, and its live animated
 * children (wobble graphics + wet-wiggle sprites). The engine holds the shared GPU resources
 * (paper, wash filter, tips) and drives the rendering; the layer is the per-surface state.
 *
 * `root` is a plain Container (no isolation), so its multiply-blended paintedSprite composites
 * against whatever is already in the framebuffer — the paper and any lower layers. Layer opacity
 * rides on root.alpha: for the opaque-white painted texture, multiply blend leaves unpainted
 * pixels untouched at any alpha and scales the darkening of painted pixels, which is exactly
 * what a layer-opacity control should do.
 */
export class PictureLayer {
  readonly id: string
  name: string
  visible = true
  opacity = 1
  strokes: Stroke[] = []

  readonly paintedTexture: RenderTexture
  readonly paintedSprite: Sprite
  /** Wobble strokes: one reused Graphics each, redrawn in place every frame. */
  readonly wiggleLayer = new Container()
  readonly wiggleGraphics = new Map<string, Graphics>()
  /** Wiggle-on wet strokes: a live wash pass per frame into each entry's display texture. */
  readonly wetWiggleLayer = new Container()
  readonly wetWiggleStrokes = new Map<string, WetWiggleEntry>()
  /** Holds paintedSprite + the two animated layers; added to the stage in stack order. */
  readonly root = new Container()

  constructor(id: string, name: string, width: number, height: number, resolution: number) {
    this.id = id
    this.name = name
    this.paintedTexture = RenderTexture.create({ width, height, resolution })
    this.paintedSprite = new Sprite(this.paintedTexture)
    this.paintedSprite.blendMode = 'multiply'
    // Order within a layer mirrors the old single-surface stage order: baked, then wet-wiggle,
    // then wobble on top.
    this.root.addChild(this.paintedSprite)
    this.root.addChild(this.wetWiggleLayer)
    this.root.addChild(this.wiggleLayer)
  }

  applyDisplay() {
    this.root.visible = this.visible
    this.root.alpha = this.opacity
  }

  /** Frees GPU resources the layer owns. Wet-wiggle entries must be torn down by the engine
   * first (their washInput holds the shared wash filter, which must be detached, not destroyed). */
  destroy() {
    for (const [, g] of this.wiggleGraphics) g.destroy()
    this.wiggleGraphics.clear()
    this.root.destroy({ children: true })
    this.paintedTexture.destroy(true)
  }
}
