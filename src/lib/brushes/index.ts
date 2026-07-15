import type { Brush, BrushId } from '../brush-types'
import { roundBrush } from './round'
import { wobbleBrush } from './wobble'
import { watercolorBrush } from './watercolor'

export const brushes: Record<BrushId, Brush> = {
  round: roundBrush,
  wobble: wobbleBrush,
  watercolor: watercolorBrush,
}

export const brushList: Brush[] = [roundBrush, wobbleBrush, watercolorBrush]
