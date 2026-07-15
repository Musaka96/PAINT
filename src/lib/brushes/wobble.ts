import { Graphics } from 'pixi.js'
import { getStroke } from 'perfect-freehand'
import type { Brush, Stroke, StrokePoint } from '../brush-types'
import { hashSeed } from '../random'

const TAIL_POINTS = 14

/** Displaces the last few points perpendicular to the local tangent, growing toward the tip,
 * so the tail ripples like a flicking tail while the rest of the line stays put. Strokes keep
 * animating even after being committed, so each gets its own phase offset (from its id) — otherwise
 * every wiggly line on the canvas would wiggle in perfect lockstep. */
function animateTail(stroke: Stroke, time: number): StrokePoint[] {
  const points = stroke.points
  if (points.length < 3) return points

  const phase = (hashSeed(stroke.id) % 1000) / 1000
  const tailLength = Math.min(points.length, TAIL_POINTS)
  const startIndex = points.length - tailLength
  const head = points.slice(0, startIndex)
  const tail = points.slice(startIndex)

  const wiggledTail = tail.map((p, i) => {
    const t = tail.length > 1 ? i / (tail.length - 1) : 1
    const prev = tail[Math.max(0, i - 1)]
    const next = tail[Math.min(tail.length - 1, i + 1)]
    const dx = next.x - prev.x
    const dy = next.y - prev.y
    const len = Math.hypot(dx, dy) || 1
    const nx = -dy / len
    const ny = dx / len
    const amplitude = stroke.size * 0.55 * t
    const wiggle = Math.sin(time * 7 + phase * Math.PI * 2 + t * 9) * amplitude
    return { x: p.x + nx * wiggle, y: p.y + ny * wiggle, pressure: p.pressure }
  })

  return [...head, ...wiggledTail]
}

function outline(stroke: Stroke, points: StrokePoint[]) {
  const input = points.map((p) => [p.x, p.y, p.pressure] as [number, number, number])
  return getStroke(input, {
    size: stroke.size,
    thinning: 0.5,
    smoothing: 0.6,
    streamline: 0.5,
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

    const points = time !== undefined ? animateTail(stroke, time) : stroke.points
    const strokeOutline = outline(stroke, points)
    if (strokeOutline.length < 3) return g

    g.poly(strokeOutline.map(([x, y]) => ({ x, y }))).fill({ color: stroke.color })
    return g
  },
}
