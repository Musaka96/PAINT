import { Texture } from 'pixi.js'
import { mulberry32 } from './random'

export type PaperId = 'smooth' | 'coldpress' | 'rough'

export interface PaperInfo {
  id: PaperId
  label: string
}

export const PAPERS: PaperInfo[] = [
  { id: 'smooth', label: 'Smooth' },
  { id: 'coldpress', label: 'Cold Press' },
  { id: 'rough', label: 'Rough' },
]

export const DEFAULT_PAPER: PaperId = 'coldpress'

/** Tile size in px — the paper repeats at this period, and the wash shader samples it in canvas
 * coordinates with the same period so a stroke's granulation lines up with the visible paper. */
export const PAPER_TILE_SIZE = 512

/** Mean sheet luminance every paper is normalized to (0-255). Kept a little below white so
 * texture highlights have headroom before clipping. The wash shader's granulation recentering
 * (0.972 ≈ 248/255) sits just above this, biasing granulation slightly toward "settle". */
const SHEET_MEAN = 245

/** Smoothly interpolated lattice noise that wraps at the tile edge in both directions. Separate
 * x/y lattice frequencies allow directional structure (felt marks) without breaking the tiling. */
function tileableNoise(seed: number, gridX: number, gridY: number) {
  const rand = mulberry32(seed)
  const cells: number[] = []
  for (let i = 0; i < gridX * gridY; i++) cells.push(rand())
  const at = (cx: number, cy: number) =>
    cells[(((cy % gridY) + gridY) % gridY) * gridX + (((cx % gridX) + gridX) % gridX)]
  return (u: number, v: number) => {
    const x = u * gridX
    const y = v * gridY
    const x0 = Math.floor(x)
    const y0 = Math.floor(y)
    const fx = x - x0
    const fy = y - y0
    const sx = fx * fx * (3 - 2 * fx)
    const sy = fy * fy * (3 - 2 * fy)
    const a = at(x0, y0)
    const b = at(x0 + 1, y0)
    const c = at(x0, y0 + 1)
    const d = at(x0 + 1, y0 + 1)
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy
  }
}

/** Fractal (multi-octave) tileable noise, roughly in [-1, 1]. Each octave doubles the lattice
 * frequency — integer multiples of the tile period, so the sum still wraps seamlessly. */
function fbm(seed: number, gridX: number, gridY: number, octaves: number, gain = 0.55) {
  const layers = Array.from({ length: octaves }, (_, i) =>
    tileableNoise(seed + i * 7919, gridX << i, gridY << i),
  )
  let norm = 0
  for (let i = 0; i < octaves; i++) norm += gain ** i
  return (u: number, v: number) => {
    let sum = 0
    let amp = 1
    for (let i = 0; i < octaves; i++) {
      sum += (layers[i](u, v) * 2 - 1) * amp
      amp *= gain
    }
    return sum / norm
  }
}

interface PaperRecipe {
  /** Warm tint applied around the normalized mean, as per-channel offsets from gray. */
  tint: [number, number, number]
  /** Luminance field in arbitrary units, evaluated per pixel at tile UVs. */
  field: (seed: number) => (u: number, v: number) => number
  /** Per-pixel speckle amplitude (fine surface fuzz). */
  speckle: number
  /** Stray pressed-in fibers. */
  fiberCount: number
  fiberAlpha: number
  seed: number
}

const RECIPES: Record<PaperId, PaperRecipe> = {
  /** Hot-press-like: nearly flat, just a fine eggshell grain. */
  smooth: {
    tint: [4, 1, -4],
    field: (seed) => {
      const fine = fbm(seed, 96, 96, 3)
      return (u, v) => fine(u, v) * 3.2
    },
    speckle: 1.2,
    fiberCount: 70,
    fiberAlpha: 0.02,
    seed: 101,
  },
  /** Cold press: the classic felt-textured watercolor sheet — mid-frequency bumps pressed in by
   * the felt, slightly wider than tall, with finer tooth layered on top. */
  coldpress: {
    tint: [4, 1, -5],
    field: (seed) => {
      const felt = fbm(seed, 36, 44, 4)
      const tooth = fbm(seed + 1, 120, 120, 2)
      return (u, v) => felt(u, v) * 11 + tooth(u, v) * 3.5
    },
    speckle: 2,
    fiberCount: 190,
    fiberAlpha: 0.03,
    seed: 202,
  },
  /** Rough: pronounced irregular tooth. Ridged noise (creases between bumps) carves pockets the
   * pigment will pool into, over a broad undulation so the surface reads handmade. */
  rough: {
    tint: [5, 1, -7],
    field: (seed) => {
      const bumps = fbm(seed, 26, 30, 4)
      const broad = fbm(seed + 1, 9, 8, 2)
      const fine = fbm(seed + 2, 110, 110, 2)
      return (u, v) => {
        // Ridge transform: peaks become plateaus, and sharp dark creases form between them.
        const ridged = 1 - Math.abs(bumps(u, v))
        return (ridged - 0.62) * 26 + broad(u, v) * 6 + fine(u, v) * 2.5
      }
    },
    speckle: 2.6,
    fiberCount: 260,
    fiberAlpha: 0.04,
    seed: 303,
  },
}

function createPaperTexture(recipe: PaperRecipe, size = PAPER_TILE_SIZE): Texture {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const field = recipe.field(recipe.seed)
  const rand = mulberry32(recipe.seed ^ 0x5f3759df)

  // First pass: raw luminance field + speckle, tracking the mean for normalization.
  const lum = new Float32Array(size * size)
  let sum = 0
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const value = field(x / size, y / size) + (rand() - 0.5) * 2 * recipe.speckle
      lum[y * size + x] = value
      sum += value
    }
  }
  const mean = sum / (size * size)

  // Second pass: recenter on the shared sheet mean and apply the warm tint per channel, so all
  // papers granulate consistently in the wash shader regardless of their texture depth.
  const img = ctx.createImageData(size, size)
  const data = img.data
  const [tr, tg, tb] = recipe.tint
  for (let i = 0; i < lum.length; i++) {
    const l = SHEET_MEAN + (lum[i] - mean)
    data[i * 4] = Math.max(0, Math.min(255, l + tr))
    data[i * 4 + 1] = Math.max(0, Math.min(255, l + tg))
    data[i * 4 + 2] = Math.max(0, Math.min(255, l + tb))
    data[i * 4 + 3] = 255
  }
  ctx.putImageData(img, 0, 0)

  // Stray fibers pressed into the sheet, wrapped across edges to keep the tile seamless.
  ctx.lineCap = 'round'
  for (let i = 0; i < recipe.fiberCount; i++) {
    const x = rand() * size
    const y = rand() * size
    const angle = rand() * Math.PI
    const len = 3 + rand() * 11
    const dx = Math.cos(angle) * len
    const dy = Math.sin(angle) * len
    const dark = rand() < 0.5
    const shade = dark ? 40 : 255
    ctx.strokeStyle = `rgba(${shade},${shade},${shade},${recipe.fiberAlpha * (0.4 + rand() * 0.6)})`
    ctx.lineWidth = 0.6 + rand() * 0.8
    for (const ox of [0, -size, size]) {
      for (const oy of [0, -size, size]) {
        ctx.beginPath()
        ctx.moveTo(x + ox - dx / 2, y + oy - dy / 2)
        ctx.lineTo(x + ox + dx / 2, y + oy + dy / 2)
        ctx.stroke()
      }
    }
  }

  const texture = Texture.from(canvas)
  // The wash shader samples this texture at UVs beyond 1 (canvas is larger than one tile) —
  // Pixi's default addressMode is clamp-to-edge, which would smear the last row/column into
  // streaks. Don't rely on the paper TilingSprite happening to flip this to repeat first: a
  // paper switch rebakes strokes synchronously, before the sprite ever renders the new texture.
  texture.source.style.addressMode = 'repeat'
  return texture
}

export function createPaperTextures(): Record<PaperId, Texture> {
  return {
    smooth: createPaperTexture(RECIPES.smooth),
    coldpress: createPaperTexture(RECIPES.coldpress),
    rough: createPaperTexture(RECIPES.rough),
  }
}
