import { AlphaFilter, Container, Graphics } from 'pixi.js'
import { getStrokePoints } from 'perfect-freehand'
import type { Brush, Stroke } from '../brush-types'

function centerline(stroke: Stroke) {
  const points = getStrokePoints(
    stroke.points.map((p) => [p.x, p.y, p.pressure]),
    { size: stroke.size, smoothing: 0.6, streamline: 0.5 },
  )
  return points.map(({ point: [x, y] }) => ({ x, y }))
}

function tracePath(g: Graphics, path: { x: number; y: number }[]) {
  g.moveTo(path[0].x, path[0].y)
  for (let i = 1; i < path.length; i++) g.lineTo(path[i].x, path[i].y)
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

    // Stroked (constant-width band along the centerline), not a filled outline polygon: for a
    // closed loop, getStroke()'s offset-curve outline can self-intersect and the "hole" collapses,
    // filling the inside solid — reproducible even for loops well larger than the brush width,
    // and the halo's wider pass made it worse. Graphics.stroke() just draws a band around the
    // path and can't collapse a hole this way.
    const path = centerline(stroke)
    if (path.length < 2) return container

    // Soft bleed halo: a wider, fainter pass of the same path behind the body, no per-dot
    // stamping so a single stroke never darkens itself — only separate strokes overlapping
    // will (via multiply).
    const halo = new Graphics()
    tracePath(halo, path)
    halo.stroke({ width: stroke.size * 1.8, color: stroke.color, cap: 'round', join: 'round' })
    // Fill fully opaque and apply opacity via AlphaFilter (not stroke alpha): a stroke that
    // doubles back on itself covers some pixels twice, and a plain translucent stroke blends
    // per overlapping segment, darkening at the crossing. AlphaFilter forces an isolated
    // offscreen render first, so opacity is applied once as a single composite.
    halo.filters = [new AlphaFilter({ alpha: 0.16 })]
    container.addChild(halo)

    // Solid body — one continuous stroke, full coverage like a real brush.
    const body = new Graphics()
    tracePath(body, path)
    body.stroke({ width: stroke.size, color: stroke.color, cap: 'round', join: 'round' })
    body.filters = [new AlphaFilter({ alpha: 0.65 })]
    container.addChild(body)

    // blendMode goes on the outer (unfiltered) container, not on halo/body directly: a filter
    // forces an isolated offscreen render, and applying 'multiply' to that isolated pass blends
    // the shape against a transparent black backdrop instead of the painted canvas, crushing color.
    container.blendMode = 'multiply'
    return container
  },
}
