import type { DabJitter } from './stamping'
import type { WashSettings } from './wash-filter'
import type { WetTips } from './tips'

/** Every brush that runs through the dab-stamping + wash pipeline (not just the wet ones — the
 * plain round marker lives here too, so it gets the same smooth, flat-width path treatment). */
export type WetBrushId =
  | 'round'
  | 'wetsharp'
  | 'wetround'
  | 'crayon'
  | 'pastel'
  | 'gouache'
  | 'pencil'
  | 'softpencil'

export interface WetBrushDef {
  id: WetBrushId
  label: string
  tip: keyof WetTips
  /** Distance between dab centers, as a fraction of brush size. */
  spacingFactor: number
  jitter: DabJitter
  /** Wash parameters minus color, which comes from the stroke. */
  wash: Omit<WashSettings, 'color'>
  /** How committed strokes composite onto the painting: watery pigment multiplies (glazes),
   * wax/chalk sits on top (covers — and can paint white). */
  blend: 'multiply' | 'normal'
  /** Whether the animated wet-edge wiggle toggle applies. Omitted = yes; the round marker
   * opts out (it has no wet edge to boil). */
  wiggleable?: boolean
}

export const WET_BRUSHES: Record<WetBrushId, WetBrushDef> = {
  /** The plain round marker: a soft solid tip stamped densely along a smoothed path, flat
   * width with zero jitter — nothing responds to speed or pressure. Normal blend so it covers,
   * and it can paint white. Mode 3 keeps the fill clean (no edge ring, no speckle). */
  round: {
    id: 'round',
    label: 'Round',
    tip: 'round',
    spacingFactor: 0.1,
    jitter: { size: 0, rotation: 0, scatter: 0, alpha: 0 },
    wash: { opacity: 0.95, edgeGain: 0, granulation: 0.15, mode: 3 },
    blend: 'normal',
    wiggleable: false,
  },
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
    blend: 'multiply',
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
    blend: 'multiply',
  },
  /** Waxy crayon: heavy tooth-skip (mode 1 keys coverage to the RAISED paper grain), hard
   * craggy tip, near-opaque wax that covers what's underneath. */
  crayon: {
    id: 'crayon',
    label: 'Crayon',
    tip: 'crayon',
    spacingFactor: 0.14,
    jitter: { size: 0.1, rotation: Math.PI, scatter: 0.03, alpha: 0.05 },
    wash: { opacity: 0.95, edgeGain: 0, granulation: 0.95, mode: 1 },
    blend: 'normal',
  },
  /** Flat mid-century-print paint: near-opaque velvety color with a fine ink speckle and
   * plush edges (mode 2). Covers what's underneath — build flat shapes over each other the
   * way cut-paper/riso illustrations do. */
  gouache: {
    id: 'gouache',
    label: 'Gouache',
    tip: 'gouache',
    spacingFactor: 0.11,
    jitter: { size: 0.05, rotation: Math.PI, scatter: 0.015, alpha: 0 },
    wash: { opacity: 0.96, edgeGain: 0, granulation: 0.35, mode: 2 },
    blend: 'normal',
  },
  /** HB pencil: a thin graphite line that catches the fine tooth (mode 4) and stays translucent,
   * so it multiplies — going over the same spot darkens it, and hatching builds tone the way it
   * does on real paper. Tight spacing keeps the line continuous at small sizes. */
  pencil: {
    id: 'pencil',
    label: 'Pencil',
    tip: 'pencil',
    spacingFactor: 0.08,
    jitter: { size: 0.07, rotation: Math.PI, scatter: 0.045, alpha: 0.12 },
    wash: { opacity: 0.55, edgeGain: 0, granulation: 0.9, mode: 4 },
    blend: 'multiply',
  },
  /** Soft (6B-ish) pencil: darker, blunter and dustier — the one for shading. Looser scatter and
   * size jitter give the broad, slightly smudged shoulder a worn soft lead leaves. */
  softpencil: {
    id: 'softpencil',
    label: 'Soft Pencil',
    tip: 'softpencil',
    spacingFactor: 0.1,
    jitter: { size: 0.14, rotation: Math.PI, scatter: 0.08, alpha: 0.16 },
    wash: { opacity: 0.8, edgeGain: 0, granulation: 0.62, mode: 4 },
    blend: 'multiply',
  },
  /** Soft pastel: chalkier and fuller than the crayon — gentler tooth-skip, dustier tip,
   * slightly translucent so strokes layer like chalk over chalk. */
  pastel: {
    id: 'pastel',
    label: 'Pastel',
    tip: 'pastel',
    spacingFactor: 0.12,
    jitter: { size: 0.12, rotation: Math.PI, scatter: 0.04, alpha: 0.08 },
    wash: { opacity: 0.82, edgeGain: 0, granulation: 0.5, mode: 1 },
    blend: 'normal',
  },
}

export function isWetBrush(id: string): id is WetBrushId {
  return id in WET_BRUSHES
}
