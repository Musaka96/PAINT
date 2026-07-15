import { Graphics } from 'pixi.js'
import { getStrokePoints } from 'perfect-freehand'
import type { Brush, Stroke } from '../brush-types'
import { hashSeed } from '../random'

const AMPLITUDE_RATIO = 0.5
const SPATIAL_FREQUENCY = 0.045
const SPEED = 5

/** A constant-width stroked line (not a filled brush shape) with a sine wave riding its whole
 * length — a traveling ripple, not just a wiggle at the tip. Each stroke gets its own phase
 * offset (from its id) so multiple wiggly lines don't ripple in lockstep. */
function wavyPath(stroke: Stroke, time?: number) {
  const strokePoints = getStrokePoints(
    stroke.points.map((p) => [p.x, p.y, p.pressure]),
    { size: stroke.size, smoothing: 0.6, streamline: 0.5 },
  )

  if (time === undefined) {
    return strokePoints.map(({ point: [x, y] }) => ({ x, y }))
  }

  const phase = ((hashSeed(stroke.id) % 1000) / 1000) * Math.PI * 2
  const amplitude = stroke.size * AMPLITUDE_RATIO

  return strokePoints.map(({ point: [x, y], vector: [vx, vy], runningLength }) => {
    const wiggle = Math.sin(time * SPEED - runningLength * SPATIAL_FREQUENCY + phase) * amplitude
    return { x: x - vy * wiggle, y: y + vx * wiggle }
  })
}

export const wobbleBrush: Brush = {
  id: 'wobble',
  label: 'Wiggly',
  render(stroke, _textures, time) {
    const g = new Graphics()
    if (stroke.points.length === 0) return g

    if (stroke.points.length === 1) {
      const [p] = stroke.points
      g.circle(p.x, p.y, stroke.size / 2).fill({ color: stroke.color })
      return g
    }

    const path = wavyPath(stroke, time)
    if (path.length < 2) return g

    g.moveTo(path[0].x, path[0].y)
    for (let i = 1; i < path.length; i++) g.lineTo(path[i].x, path[i].y)
    g.stroke({ width: stroke.size, color: stroke.color, cap: 'round', join: 'round' })

    return g
  },
}
