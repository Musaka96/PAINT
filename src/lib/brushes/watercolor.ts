import { AlphaFilter, Container, Graphics, TilingSprite } from 'pixi.js'
import { getStrokePoints } from 'perfect-freehand'
import type { Brush, BrushTextures, Stroke } from '../brush-types'
import { hashSeed } from '../random'

/** A small, deterministic (seeded from the stroke id, not time-based) wobble applied to the
 * centerline so the edge reads as hand-painted rather than a perfectly smooth machine line. */
function organicCenterline(stroke: Stroke) {
  const raw = getStrokePoints(
    stroke.points.map((p) => [p.x, p.y, p.pressure]),
    { size: stroke.size, smoothing: 0.6, streamline: 0.5 },
  )
  const seed = hashSeed(stroke.id)
  const amplitude = stroke.size * 0.06

  return raw.map(({ point: [x, y], vector: [vx, vy] }, i) => {
    const nx = -vy
    const ny = vx
    const t = i * 0.4
    const wobble = (Math.sin(t * 1.3 + seed * 0.01) * 0.6 + Math.sin(t * 2.9 + seed * 0.023) * 0.4) * amplitude
    return { x: x + nx * wobble, y: y + ny * wobble }
  })
}

function tracePath(g: Graphics, path: { x: number; y: number }[]) {
  g.moveTo(path[0].x, path[0].y)
  for (let i = 1; i < path.length; i++) g.lineTo(path[i].x, path[i].y)
}

function boundingBox(path: { x: number; y: number }[], padding: number) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of path) {
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }
  return {
    x: minX - padding,
    y: minY - padding,
    width: maxX - minX + padding * 2,
    height: maxY - minY + padding * 2,
  }
}

/** A tinted tiling of the grain texture, clipped to a stroked silhouette of `path` — gives
 * granulation (mottled tone, like pigment settling unevenly on paper) instead of a flat fill. */
function granulatedStroke(
  path: { x: number; y: number }[],
  width: number,
  color: string,
  alpha: number,
  textures: BrushTextures,
) {
  const mask = new Graphics()
  tracePath(mask, path)
  mask.stroke({ width, color: 0xffffff, cap: 'round', join: 'round' })
  // Not added to the display tree: a mask object present as a child with visible/renderable set
  // to false renders fully transparent (Pixi's mask pass skips it too, not just normal drawing) —
  // it has to stay a genuinely normal, un-added object to work as a mask reference.

  const box = boundingBox(path, width)
  const grain = new TilingSprite({ texture: textures.grain, width: box.width, height: box.height })
  grain.position.set(box.x, box.y)
  grain.tint = color
  grain.alpha = alpha
  grain.mask = mask

  // Since `mask` isn't a child, destroying the sprite normally wouldn't clean it up — piggyback
  // its destruction onto the sprite's own so the caller's usual destroy({children:true}) still
  // reaches it.
  const destroy = grain.destroy.bind(grain)
  grain.destroy = (options?: Parameters<typeof destroy>[0]) => {
    mask.destroy()
    destroy(options)
  }

  return grain
}

/** Pigment-concentrates-at-the-boundary effect — as water evaporates, capillary action carries
 * dissolved pigment outward, depositing more of it near the edge than in the middle. This is the
 * defining visual trait of real watercolor, more so than granulation or bleed. Built as a ring: a
 * darkened pass at the body's full width, with an inverse mask (a narrower "core" shape) punching
 * out the center so only the band near the boundary shows. */
function wetEdge(path: { x: number; y: number }[], width: number, color: string) {
  const core = new Graphics()
  tracePath(core, path)
  core.stroke({ width: width * 0.82, color: 0xffffff, cap: 'round', join: 'round' })
  // Not added to the display tree — same reason as granulatedStroke's mask above.

  const edge = new Graphics()
  tracePath(edge, path)
  edge.stroke({ width, color, cap: 'round', join: 'round' })
  edge.setMask({ mask: core, inverse: true })
  edge.filters = [new AlphaFilter({ alpha: 0.85 })]

  const destroy = edge.destroy.bind(edge)
  edge.destroy = (options?: Parameters<typeof destroy>[0]) => {
    core.destroy()
    destroy(options)
  }

  return edge
}

export const watercolorBrush: Brush = {
  id: 'watercolor',
  label: 'Watercolor',
  render(stroke, textures) {
    const container = new Container()
    if (stroke.points.length === 0) return container

    if (stroke.points.length === 1) {
      const [p] = stroke.points
      const dot = new Graphics().circle(p.x, p.y, stroke.size / 2).fill({ color: stroke.color, alpha: 0.6 })
      dot.blendMode = 'multiply'
      container.addChild(dot)
      return container
    }

    const path = organicCenterline(stroke)
    if (path.length < 2) return container

    // Soft bleed halo: a wider, fainter, smooth (ungranulated) pass behind the body.
    // Fill fully opaque and apply opacity via AlphaFilter (not stroke alpha): a stroke that
    // doubles back on itself covers some pixels twice, and a plain translucent stroke blends
    // per overlapping segment, darkening at the crossing. AlphaFilter forces an isolated
    // offscreen render first, so opacity is applied once as a single composite.
    const halo = new Graphics()
    tracePath(halo, path)
    halo.stroke({ width: stroke.size * 1.8, color: stroke.color, cap: 'round', join: 'round' })
    halo.filters = [new AlphaFilter({ alpha: 0.16 })]
    container.addChild(halo)

    // Granulated body: pigment-like tonal variation instead of a flat, uniform fill.
    container.addChild(granulatedStroke(path, stroke.size, stroke.color, 0.7, textures))

    // Wet edge: darkened ring where pigment concentrates at the boundary.
    container.addChild(wetEdge(path, stroke.size, stroke.color))

    // blendMode goes on the outer (unfiltered) container, not on halo/body directly: a filter
    // forces an isolated offscreen render, and applying 'multiply' to that isolated pass blends
    // the shape against a transparent black backdrop instead of the painted canvas, crushing color.
    container.blendMode = 'multiply'
    return container
  },
}
