import { Graphics, FillGradient } from 'pixi.js'
import { getStroke } from 'perfect-freehand'
import type { Brush, Stroke } from '../brush-types'
import { mulberry32, hashSeed } from '../random'

const RAINBOW = [0xff5e5e, 0xffb84d, 0xffe74d, 0x7ee787, 0x5ec8ff, 0xa68bff, 0xff8ad4]

function wobblePath(stroke: Stroke) {
  const rand = mulberry32(hashSeed(stroke.id))
  const phase = rand() * Math.PI * 2
  return stroke.points.map((p, i) => {
    const wobble = Math.sin(i * 0.6 + phase) * stroke.size * 0.4
    const angle = i * 0.45 + phase
    return [p.x + Math.cos(angle) * wobble, p.y + Math.sin(angle) * wobble, p.pressure] as [
      number,
      number,
      number,
    ]
  })
}

export const wobbleBrush: Brush = {
  id: 'wobble',
  label: 'Wiggly',
  render(stroke) {
    const g = new Graphics()
    if (stroke.points.length === 0) return g

    if (stroke.points.length === 1) {
      const [p] = stroke.points
      g.circle(p.x, p.y, stroke.size / 2).fill({ color: RAINBOW[0] })
      return g
    }

    const outline = getStroke(wobblePath(stroke), {
      size: stroke.size * 1.15,
      thinning: 0.2,
      smoothing: 0.6,
      streamline: 0.35,
    })
    if (outline.length < 3) return g

    const xs = outline.map(([x]) => x)
    const ys = outline.map(([, y]) => y)
    const minX = Math.min(...xs)
    const maxX = Math.max(...xs)
    const minY = Math.min(...ys)
    const maxY = Math.max(...ys)

    const fill = new FillGradient({
      type: 'linear',
      start: { x: minX, y: minY },
      end: { x: maxX, y: maxY },
      textureSpace: 'global',
    })
    RAINBOW.forEach((color, i) => fill.addColorStop(i / (RAINBOW.length - 1), color))

    g.poly(outline.map(([x, y]) => ({ x, y }))).fill(fill)
    return g
  },
}
