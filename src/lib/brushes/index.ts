import type { Brush, ClassicBrushId } from '../brush-types'
import { wobbleBrush } from './wobble'

export const brushes: Record<ClassicBrushId, Brush> = {
  wobble: wobbleBrush,
}
