import { AlphaFilter, Container, Graphics, TilingSprite } from 'pixi.js'
import { getStrokePoints } from 'perfect-freehand'
import type { Brush, BrushTextures, Stroke } from '../brush-types'
import { hashSeed } from '../random'

type PathPoint = { x: number; y: number; runningLength: number }

/** A deterministic (seeded from the stroke id, not time-based) wobble applied to the centerline
 * so the edge reads as hand-painted rather than a perfectly smooth machine line. Phased by
 * distance traveled (`runningLength`), not point index — perfect-freehand packs points closer
 * together when the input is drawn slowly, and an index-phased wobble would then oscillate more
 * per unit distance, reading as jagged noise instead of a loose, even wander. */
function organicCenterline(stroke: Stroke): PathPoint[] {
  const raw = getStrokePoints(
    stroke.points.map((p) => [p.x, p.y, p.pressure]),
    { size: stroke.size, smoothing: 0.5, streamline: 0.35 },
  )
  const seed = hashSeed(stroke.id)
  const amplitude = stroke.size * 0.14

  return raw.map(({ point: [x, y], vector: [vx, vy], runningLength }) => {
    const nx = -vy
    const ny = vx
    const t = runningLength * 0.05
    const wobble = (Math.sin(t * 1.3 + seed * 0.01) * 0.6 + Math.sin(t * 2.9 + seed * 0.023) * 0.4) * amplitude
    return { x: x + nx * wobble, y: y + ny * wobble, runningLength }
  })
}

/** A smooth width multiplier along the stroke's arc length (again phased by distance, not index,
 * for the same reason as the wobble above): tapers toward the start/end like a brush lifting off
 * the page, and wanders a little in between so the stroke isn't a perfectly even ribbon. The taper
 * distance is capped to a small multiple of the brush width — otherwise a long stroke or a closed
 * loop would taper over a huge span, and a loop's start/end taper to near-zero width at the same
 * spot, leaving a visible seam. Deterministic (seeded), so undo/redo and the live preview never
 * reshuffle a stroke's look. */
function widthProfile(path: PathPoint[], baseWidth: number, seed: number): number[] {
  const totalLength = Math.max(path[path.length - 1].runningLength, 1)
  const taperLength = Math.min(totalLength * 0.3, baseWidth * 2.2)

  return path.map(({ runningLength: len }) => {
    const t = len * 0.06
    const noise = 1 + (Math.sin(t * 1.3 + seed * 0.011) * 0.6 + Math.sin(t * 2.6 + seed * 0.027) * 0.4) * 0.2
    let taper = 1
    if (len < taperLength) taper = 0.3 + 0.7 * (len / taperLength)
    else if (len > totalLength - taperLength) taper = 0.3 + 0.7 * ((totalLength - len) / taperLength)
    return Math.max(0.12, noise * taper)
  })
}

/** Traces `path` as a sequence of short segments, each stroked at its own width — gives a stroke
 * that thickens and thins along its length instead of one uniform ribbon. Points are batched a
 * few at a time (one `stroke()` call per batch, not per point-pair): width changes smoothly
 * anyway, so batching costs negligible smoothness while cutting draw calls roughly 4x — this
 * runs on every pointerMove while actively drawing, so call count matters. */
function strokeVariableWidth(
  g: Graphics,
  path: PathPoint[],
  baseWidth: number,
  multipliers: number[],
  color: number | string,
) {
  const batchSize = 4
  let i = 0
  while (i < path.length - 1) {
    const end = Math.min(i + batchSize, path.length - 1)
    const width = baseWidth * multipliers[Math.floor((i + end) / 2)]
    g.moveTo(path[i].x, path[i].y)
    for (let j = i + 1; j <= end; j++) g.lineTo(path[j].x, path[j].y)
    g.stroke({ width, color, cap: 'round', join: 'round' })
    i = end
  }
}

function boundingBox(path: PathPoint[], padding: number) {
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

/** A tinted tiling of the grain texture, clipped to a variable-width stroked silhouette of `path`
 * — gives granulation (mottled tone, like pigment settling unevenly on paper) instead of a flat
 * fill. */
function granulatedStroke(
  path: PathPoint[],
  baseWidth: number,
  multipliers: number[],
  color: string,
  alpha: number,
  textures: BrushTextures,
) {
  const mask = new Graphics()
  strokeVariableWidth(mask, path, baseWidth, multipliers, 0xffffff)
  // Not added to the display tree: a mask object present as a child with visible/renderable set
  // to false renders fully transparent (Pixi's mask pass skips it too, not just normal drawing) —
  // it has to stay a genuinely normal, un-added object to work as a mask reference.

  const box = boundingBox(path, baseWidth)
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
 * darkened pass at the body's full (variable) width, with an inverse mask (a narrower "core" shape)
 * punching out the center so only the band near the boundary shows. */
function wetEdge(path: PathPoint[], baseWidth: number, multipliers: number[], color: string) {
  const core = new Graphics()
  strokeVariableWidth(core, path, baseWidth * 0.82, multipliers, 0xffffff)
  // Not added to the display tree — same reason as granulatedStroke's mask above.

  const edge = new Graphics()
  strokeVariableWidth(edge, path, baseWidth, multipliers, color)
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

    const profile = widthProfile(path, stroke.size, hashSeed(stroke.id))

    // Soft bleed halo: a wider, fainter, smooth pass behind the body.
    // Fill fully opaque and apply opacity via AlphaFilter (not stroke alpha): a stroke that
    // doubles back on itself covers some pixels twice, and a plain translucent stroke blends
    // per overlapping segment, darkening at the crossing. AlphaFilter forces an isolated
    // offscreen render first, so opacity is applied once as a single composite.
    const halo = new Graphics()
    strokeVariableWidth(halo, path, stroke.size * 1.8, profile, stroke.color)
    halo.filters = [new AlphaFilter({ alpha: 0.16 })]
    container.addChild(halo)

    // Granulated body: pigment-like tonal variation instead of a flat, uniform fill.
    container.addChild(granulatedStroke(path, stroke.size, profile, stroke.color, 0.7, textures))

    // Wet edge: darkened ring where pigment concentrates at the boundary.
    container.addChild(wetEdge(path, stroke.size, profile, stroke.color))

    // blendMode goes on the outer (unfiltered) container, not on halo/body directly: a filter
    // forces an isolated offscreen render, and applying 'multiply' to that isolated pass blends
    // the shape against a transparent black backdrop instead of the painted canvas, crushing color.
    container.blendMode = 'multiply'
    return container
  },
}
