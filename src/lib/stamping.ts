import { Container, Sprite, type Texture } from 'pixi.js'
import { getStrokePoints } from 'perfect-freehand'
import { mulberry32 } from './random'
import type { StrokePoint } from './brush-types'

/** One stamp of the brush tip along a stroke. */
export interface Dab {
  /** Sequential position along the stroke — dab N is always at arc length N * spacing, so an
   * incremental preview can stamp dabs 0..k now and k+1.. later and get the identical result. */
  index: number
  x: number
  y: number
  rotation: number
  /** Diameter multiplier on the brush size. */
  scale: number
  alpha: number
  arcLength: number
}

export interface DabJitter {
  /** ± fraction of size. */
  size: number
  /** Max rotation deviation in radians (tips are round-ish, so this mostly matters for splotchy tips). */
  rotation: number
  /** Max perpendicular offset, as a fraction of brush size. */
  scatter: number
  /** How much a dab's alpha may drop below 1. */
  alpha: number
}

export interface DabPlan {
  dabs: Dab[]
  /** Total smoothed arc length of the stroke so far. */
  totalLength: number
}

/** Per-dab RNG: seeded from the stroke seed and the dab's own index, so a dab's jitter never
 * depends on when it was computed — the live incremental preview, the final bake, and an
 * undo-triggered rebake all agree pixel-for-pixel. */
function dabRandom(seed: number, index: number) {
  return mulberry32((seed ^ ((index + 1) * 0x9e3779b9)) >>> 0)
}

/**
 * Resamples the smoothed centerline at fixed `spacing` and places one jittered dab per step.
 * Deterministic for a given (points, size, spacing, seed): dab positions depend only on arc
 * length, jitter only on (seed, index).
 */
export function computeDabs(
  points: StrokePoint[],
  size: number,
  spacing: number,
  jitter: DabJitter,
  seed: number,
): DabPlan {
  if (points.length === 0) return { dabs: [], totalLength: 0 }

  const path = getStrokePoints(
    points.map((p) => [p.x, p.y, p.pressure]),
    { size, smoothing: 0.5, streamline: 0.35 },
  )

  const makeDab = (index: number, x: number, y: number, angle: number, arcLength: number): Dab => {
    const rand = dabRandom(seed, index)
    const scale = 1 + (rand() - 0.5) * 2 * jitter.size
    const rotation = angle + (rand() - 0.5) * 2 * jitter.rotation
    const scatterDist = (rand() - 0.5) * 2 * jitter.scatter * size
    const alpha = 1 - rand() * jitter.alpha
    return {
      index,
      x: x + Math.cos(angle + Math.PI / 2) * scatterDist,
      y: y + Math.sin(angle + Math.PI / 2) * scatterDist,
      rotation,
      scale,
      alpha,
      arcLength,
    }
  }

  const first = path[0]
  const totalLength = path[path.length - 1]?.runningLength ?? 0
  const dabs: Dab[] = [makeDab(0, first.point[0], first.point[1], 0, 0)]

  if (path.length < 2 || totalLength === 0) return { dabs, totalLength }

  // Walk the polyline, dropping a dab every `spacing` px of arc length.
  let segIndex = 1
  for (let index = 1; index * spacing <= totalLength; index++) {
    const target = index * spacing
    while (segIndex < path.length - 1 && path[segIndex].runningLength < target) segIndex++
    const a = path[segIndex - 1]
    const b = path[segIndex]
    const segLen = b.runningLength - a.runningLength
    const t = segLen > 0 ? (target - a.runningLength) / segLen : 0
    const x = a.point[0] + (b.point[0] - a.point[0]) * t
    const y = a.point[1] + (b.point[1] - a.point[1]) * t
    const angle = Math.atan2(b.point[1] - a.point[1], b.point[0] - a.point[0])
    dabs.push(makeDab(index, x, y, angle, target))
  }

  return { dabs, totalLength }
}

/** Builds one sprite per dab into `container`. The tip texture is square; `size` is the stamped
 * diameter in canvas px before per-dab scale jitter. */
export function stampDabs(container: Container, dabs: Dab[], tip: Texture, size: number) {
  for (const dab of dabs) {
    const sprite = new Sprite(tip)
    sprite.anchor.set(0.5)
    sprite.position.set(dab.x, dab.y)
    sprite.rotation = dab.rotation
    sprite.width = size * dab.scale
    sprite.height = size * dab.scale
    sprite.alpha = dab.alpha
    container.addChild(sprite)
  }
}
