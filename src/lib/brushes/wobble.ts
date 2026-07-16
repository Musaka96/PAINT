import { Graphics } from 'pixi.js'
import { getStrokePoints } from 'perfect-freehand'
import { DEFAULT_WIGGLE, type Brush, type Stroke, type WigglePattern } from '../brush-types'
import { hashSeed } from '../random'

function waveValue(pattern: WigglePattern, phase: number): number {
  switch (pattern) {
    case 'square':
      return Math.sin(phase) >= 0 ? 1 : -1
    case 'zigzag': {
      const t = (((phase % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2)
      return t < 0.5 ? 4 * t - 1 : 3 - 4 * t
    }
    case 'sine':
    default:
      return Math.sin(phase)
  }
}

/** A constant-width stroked line (not a filled brush shape) with a wave riding its whole
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

  const settings = stroke.wiggle ?? DEFAULT_WIGGLE
  const phaseOffset = ((hashSeed(stroke.id) % 1000) / 1000) * Math.PI * 2
  const amplitude = stroke.size * settings.amplitude
  const frequency = (Math.PI * 2) / Math.max(settings.wavelength, 1)

  return strokePoints.map(({ point: [x, y], vector: [vx, vy], runningLength }) => {
    const phase = time * settings.speed - runningLength * frequency + phaseOffset
    const wiggle = waveValue(settings.pattern, phase) * amplitude
    return { x: x - vy * wiggle, y: y + vx * wiggle }
  })
}

/** Draws into an existing Graphics (clear + redraw) instead of allocating a new one. Wiggly
 * strokes keep animating forever once drawn, so their per-frame redraw reuses one Graphics per
 * stroke rather than creating/destroying one 60 times a second indefinitely. */
export function drawWiggleInto(g: Graphics, stroke: Stroke, time?: number) {
  g.clear()
  if (stroke.points.length === 0) return

  if (stroke.points.length === 1) {
    const [p] = stroke.points
    g.circle(p.x, p.y, stroke.size / 2).fill({ color: stroke.color })
    return
  }

  const path = wavyPath(stroke, time)
  if (path.length < 2) return

  g.moveTo(path[0].x, path[0].y)
  for (let i = 1; i < path.length; i++) g.lineTo(path[i].x, path[i].y)
  g.stroke({ width: stroke.size, color: stroke.color, cap: 'round', join: 'round' })
}

export const wobbleBrush: Brush = {
  id: 'wobble',
  label: 'Wiggly',
  render(stroke, _textures, time) {
    const g = new Graphics()
    drawWiggleInto(g, stroke, time)
    return g
  },
}
