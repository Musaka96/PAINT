import type { Container, Texture } from 'pixi.js'

export interface StrokePoint {
  x: number
  y: number
  pressure: number
}

export type BrushId = 'round' | 'wobble' | 'wetsharp' | 'wetround' | 'crayon' | 'pastel' | 'gouache'

/** Brushes with a classic render-a-Container implementation. Everything else (round + the wet
 * and dry-media brushes) goes through the engine's dab-stamping + wash pipeline. Only the
 * wiggly line brush remains classic — it's a perpetually-animated centerline, not stamped. */
export type ClassicBrushId = 'wobble'

export type WigglePattern = 'sine' | 'zigzag' | 'square'

export interface WiggleSettings {
  /** Wave height, as a multiple of brush size. */
  amplitude: number
  /** Distance in px for one full wave cycle. */
  wavelength: number
  /** Animation rate, in radians/sec. */
  speed: number
  pattern: WigglePattern
}

export const DEFAULT_WIGGLE: WiggleSettings = {
  amplitude: 0.5,
  wavelength: 140,
  speed: 5,
  pattern: 'sine',
}

export interface Stroke {
  id: string
  brush: BrushId
  color: string
  size: number
  points: StrokePoint[]
  /** Only set for 'wobble' strokes — captured at draw time, like color/size. */
  wiggle?: WiggleSettings
  /** Wet brushes only, captured at draw time: when true the stroke's outer edge stays "wet" —
   * animated forever by the wash shader instead of being baked to static pixels. */
  wetWiggle?: boolean
}

export interface BrushTextures {
  soft: Texture
  rough: Texture
  grain: Texture
}

export interface Brush {
  id: ClassicBrushId
  label: string
  /** `time` (seconds) is only passed for the live in-progress preview, so brushes can animate;
   * it's omitted when baking the final, settled stroke into the canvas. */
  render(stroke: Stroke, textures: BrushTextures, time?: number): Container
}
