import type { Container, Texture } from 'pixi.js'

export interface StrokePoint {
  x: number
  y: number
  pressure: number
}

export type BrushId = 'round' | 'wobble' | 'watercolor'

export interface Stroke {
  id: string
  brush: BrushId
  color: string
  size: number
  points: StrokePoint[]
}

export interface BrushTextures {
  soft: Texture
  rough: Texture
}

export interface Brush {
  id: BrushId
  label: string
  /** `time` (seconds) is only passed for the live in-progress preview, so brushes can animate;
   * it's omitted when baking the final, settled stroke into the canvas. */
  render(stroke: Stroke, textures: BrushTextures, time?: number): Container
}
