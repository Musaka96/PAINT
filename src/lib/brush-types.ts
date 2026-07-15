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
  render(stroke: Stroke, textures: BrushTextures): Container
}
