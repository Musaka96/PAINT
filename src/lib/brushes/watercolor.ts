import { AlphaFilter, BlurFilter, Container, Graphics } from 'pixi.js'
import { getStroke } from 'perfect-freehand'
import type { Brush, Stroke } from '../brush-types'

function outline(stroke: Stroke) {
  const input = stroke.points.map((p) => [p.x, p.y, p.pressure] as [number, number, number])
  return getStroke(input, {
    size: stroke.size,
    thinning: 0.5,
    smoothing: 0.6,
    streamline: 0.5,
  })
}

export const watercolorBrush: Brush = {
  id: 'watercolor',
  label: 'Watercolor',
  render(stroke) {
    const container = new Container()
    if (stroke.points.length === 0) return container

    if (stroke.points.length === 1) {
      const [p] = stroke.points
      const dot = new Graphics().circle(p.x, p.y, stroke.size / 2).fill({ color: stroke.color, alpha: 0.6 })
      dot.blendMode = 'multiply'
      container.addChild(dot)
      return container
    }

    const points = outline(stroke)
    if (points.length < 3) return container
    const polyPoints = points.map(([x, y]) => ({ x, y }))

    // Soft bleed halo: one blurred fill behind the body, no per-dot stamping so a single
    // stroke never darkens itself — only separate strokes overlapping will (via multiply).
    // Fill fully opaque and apply opacity via AlphaFilter (not fill alpha): a stroke that
    // doubles back on itself produces a self-intersecting polygon, and a plain translucent
    // fill blends per overlapping triangle, darkening at the crossing. AlphaFilter forces an
    // isolated offscreen render first, so opacity is applied once as a single composite.
    const halo = new Graphics().poly(polyPoints).fill({ color: stroke.color })
    halo.filters = [
      new BlurFilter({ strength: Math.max(stroke.size * 0.35, 4), quality: 3 }),
      new AlphaFilter({ alpha: 0.35 }),
    ]
    container.addChild(halo)

    // Solid body — one continuous fill, full coverage like a real brush.
    const body = new Graphics().poly(polyPoints).fill({ color: stroke.color })
    body.filters = [new AlphaFilter({ alpha: 0.65 })]
    container.addChild(body)

    // blendMode goes on the outer (unfiltered) container, not on halo/body directly: a filter
    // forces an isolated offscreen render, and applying 'multiply' to that isolated pass blends
    // the shape against a transparent black backdrop instead of the painted canvas, crushing color.
    container.blendMode = 'multiply'
    return container
  },
}
