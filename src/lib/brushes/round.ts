import { Graphics } from 'pixi.js'
import { getStroke } from 'perfect-freehand'
import type { Brush } from '../brush-types'

export const roundBrush: Brush = {
  id: 'round',
  label: 'Round',
  render(stroke) {
    const g = new Graphics()
    if (stroke.points.length === 0) return g

    if (stroke.points.length === 1) {
      const [p] = stroke.points
      g.circle(p.x, p.y, stroke.size / 2).fill({ color: stroke.color })
      return g
    }

    const input = stroke.points.map((p) => [p.x, p.y, p.pressure] as [number, number, number])
    const outline = getStroke(input, {
      size: stroke.size,
      thinning: 0.6,
      smoothing: 0.55,
      streamline: 0.45,
    })

    if (outline.length < 3) return g
    g.poly(outline.map(([x, y]) => ({ x, y }))).fill({ color: stroke.color })
    return g
  },
}
