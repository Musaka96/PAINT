import type { DabJitter } from './stamping'
import type { WashSettings } from './wash-filter'
import type { WetTips } from './tips'

export type WetBrushId = 'wetsharp' | 'wetround'

export interface WetBrushDef {
  id: WetBrushId
  label: string
  tip: keyof WetTips
  /** Distance between dab centers, as a fraction of brush size. */
  spacingFactor: number
  jitter: DabJitter
  /** Wash parameters minus color, which comes from the stroke. */
  wash: Omit<WashSettings, 'color'>
}

export const WET_BRUSHES: Record<WetBrushId, WetBrushDef> = {
  /** The flat glaze — clean sharp-ish edges, translucent, builds tone by layering strokes.
   * Tight spacing and minimal jitter give a smooth ribbon; the character comes from the
   * paper showing through and layered strokes multiplying. */
  wetsharp: {
    id: 'wetsharp',
    label: 'Wet Sharp',
    tip: 'sharp',
    spacingFactor: 0.12,
    jitter: { size: 0.06, rotation: 0.4, scatter: 0.02, alpha: 0 },
    wash: { opacity: 0.42, edgeGain: 0.3, granulation: 0.22 },
  },
  /** The blobby wet wash — ragged splotchy boundary, strong dark wet-edge ring, heavy
   * granulation. Wider spacing and full rotation jitter keep the ragged tip edges from
   * aligning into a repeating pattern. */
  wetround: {
    id: 'wetround',
    label: 'Wet Round',
    tip: 'splotch',
    spacingFactor: 0.26,
    jitter: { size: 0.14, rotation: Math.PI, scatter: 0.05, alpha: 0.1 },
    wash: { opacity: 0.55, edgeGain: 0.85, granulation: 0.45 },
  },
}

export function isWetBrush(id: string): id is WetBrushId {
  return id === 'wetsharp' || id === 'wetround'
}
