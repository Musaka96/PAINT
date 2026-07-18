import type { Brush, ClassicBrushId } from '../brush-types'
import { roundBrush } from './round'
import { wobbleBrush } from './wobble'

export const brushes: Record<ClassicBrushId, Brush> = {
  round: roundBrush,
  wobble: wobbleBrush,
}
