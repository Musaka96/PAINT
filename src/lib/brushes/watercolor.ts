import { Container, Sprite } from 'pixi.js'
import type { Brush, Stroke, StrokePoint } from '../brush-types'
import { mulberry32, hashSeed } from '../random'

function resample(points: StrokePoint[], spacing: number): StrokePoint[] {
  if (points.length === 0) return []
  if (points.length === 1) return [points[0]]

  const out: StrokePoint[] = [points[0]]
  let carry = 0
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const dist = Math.hypot(dx, dy)
    if (dist === 0) continue
    let d = carry
    while (d < dist) {
      const t = d / dist
      out.push({
        x: a.x + dx * t,
        y: a.y + dy * t,
        pressure: a.pressure + (b.pressure - a.pressure) * t,
      })
      d += spacing
    }
    carry = d - dist
  }
  out.push(points[points.length - 1])
  return out
}

export const watercolorBrush: Brush = {
  id: 'watercolor',
  label: 'Watercolor',
  render(stroke: Stroke, textures) {
    const container = new Container()
    if (stroke.points.length === 0) return container

    const rand = mulberry32(hashSeed(stroke.id))
    const spacing = Math.max(stroke.size * 0.18, 2)
    const samples = resample(stroke.points, spacing)

    for (const p of samples) {
      const baseScale = (stroke.size * (0.9 + p.pressure * 0.6)) / textures.rough.width

      const halo = new Sprite(textures.rough)
      halo.anchor.set(0.5)
      halo.tint = stroke.color
      halo.blendMode = 'multiply'
      halo.alpha = 0.05 + rand() * 0.04
      halo.scale.set(baseScale * (1.6 + rand() * 0.5))
      halo.rotation = rand() * Math.PI * 2
      halo.position.set(
        p.x + (rand() - 0.5) * stroke.size * 0.3,
        p.y + (rand() - 0.5) * stroke.size * 0.3,
      )
      container.addChild(halo)

      const core = new Sprite(textures.soft)
      core.anchor.set(0.5)
      core.tint = stroke.color
      core.blendMode = 'multiply'
      core.alpha = 0.1 + rand() * 0.08
      core.scale.set(baseScale * (0.9 + rand() * 0.3))
      core.rotation = rand() * Math.PI * 2
      core.position.set(
        p.x + (rand() - 0.5) * stroke.size * 0.12,
        p.y + (rand() - 0.5) * stroke.size * 0.12,
      )
      container.addChild(core)
    }

    return container
  },
}
