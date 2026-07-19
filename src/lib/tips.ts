import { Texture } from 'pixi.js'
import { mulberry32 } from './random'

/** The two stamp shapes the wet brushes drag along a stroke. White with shaped alpha — color
 * comes later from the wash shader, which reads only the stamped silhouette's alpha. Both are
 * seeded so the tips (and therefore every stroke's edge character) are identical across loads. */
export interface WetTips {
  /** Hard, clean-edged disc with a whisper of falloff — the "Round Sharp" glaze tip. */
  sharp: Texture
  /** Ragged, splotchy disc with chunky edge noise and stray speckles — the "Round" wash tip. */
  splotch: Texture
  /** Craggy hard-edged chunk, like the worn end of a wax crayon. */
  crayon: Texture
  /** Soft chalky disc — dense center fading through grain to a dusty rim. */
  pastel: Texture
}

/** Smooth 2-octave value noise on a coarse random grid — gives blobby, organic edge raggedness
 * instead of the per-pixel static that plain white noise produces. */
function makeValueNoise(seed: number, grid = 12) {
  const rand = mulberry32(seed)
  const cells: number[] = []
  for (let i = 0; i < grid * grid; i++) cells.push(rand())
  const at = (cx: number, cy: number) => cells[((cy % grid) + grid) % grid * grid + (((cx % grid) + grid) % grid)]
  const sample = (u: number, v: number) => {
    const x = u * grid
    const y = v * grid
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
  return (u: number, v: number) => 0.65 * sample(u, v) + 0.35 * sample(u * 2.3 + 0.37, v * 2.3 + 0.71)
}

export function createSharpTip(size = 128): Texture {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const img = ctx.createImageData(size, size)
  const data = img.data
  const r = size / 2
  const noise = makeValueNoise(11)

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - r
      const dy = y - r
      const dist = Math.sqrt(dx * dx + dy * dy) / r
      // Slightly irregular radius so the edge isn't a mathematically perfect circle.
      const wobble = (noise(x / size, y / size) - 0.5) * 0.06
      const edge = dist + wobble
      // Hard interior, short falloff band at the rim.
      const alpha = 1 - Math.min(1, Math.max(0, (edge - 0.82) / 0.16))
      const i = (y * size + x) * 4
      data[i] = data[i + 1] = data[i + 2] = 255
      data[i + 3] = Math.round(alpha * 255)
    }
  }
  ctx.putImageData(img, 0, 0)
  return Texture.from(canvas)
}

export function createSplotchTip(size = 160): Texture {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const img = ctx.createImageData(size, size)
  const data = img.data
  const r = size / 2
  // The disc only reaches ~78% of the texture radius, leaving a margin for speckles outside it.
  const discR = 0.78
  const noise = makeValueNoise(23)
  const fine = makeValueNoise(47, 24)

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - r
      const dy = y - r
      const dist = Math.sqrt(dx * dx + dy * dy) / r
      const n = noise(x / size, y / size) - 0.5
      const f = fine(x / size, y / size) - 0.5
      // Chunky low-frequency raggedness plus a finer crumble on top.
      const edge = dist / discR + n * 0.42 + f * 0.14
      const alpha = 1 - Math.min(1, Math.max(0, (edge - 0.72) / 0.3))
      // Interior isn't perfectly solid either — faint pooling variation.
      const interior = 0.9 + n * 0.2
      const i = (y * size + x) * 4
      data[i] = data[i + 1] = data[i + 2] = 255
      data[i + 3] = Math.round(Math.min(1, alpha * interior) * 255)
    }
  }
  ctx.putImageData(img, 0, 0)

  // Stray speckles flung just outside the disc, like spatter at a wet dab's rim.
  const rand = mulberry32(31)
  ctx.fillStyle = 'rgba(255,255,255,0.85)'
  for (let i = 0; i < 26; i++) {
    const angle = rand() * Math.PI * 2
    const dist = r * discR * (0.95 + rand() * 0.3)
    const sx = r + Math.cos(angle) * dist
    const sy = r + Math.sin(angle) * dist
    const sr = 0.6 + rand() * 2.2
    if (sx < sr || sy < sr || sx > size - sr || sy > size - sr) continue
    ctx.beginPath()
    ctx.arc(sx, sy, sr, 0, Math.PI * 2)
    ctx.fill()
  }

  return Texture.from(canvas)
}

export function createCrayonTip(size = 160): Texture {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const img = ctx.createImageData(size, size)
  const data = img.data
  const r = size / 2
  const discR = 0.82
  const noise = makeValueNoise(61)
  const fine = makeValueNoise(67, 26)

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - r
      const dy = y - r
      const dist = Math.sqrt(dx * dx + dy * dy) / r
      const n = noise(x / size, y / size) - 0.5
      const f = fine(x / size, y / size) - 0.5
      // Craggy, broken rim — a worn wax nub, not a circle. The edge band is short (hard), the
      // raggedness comes from big noise on the radius.
      const edge = dist / discR + n * 0.34 + f * 0.1
      const alpha = 1 - Math.min(1, Math.max(0, (edge - 0.8) / 0.12))
      // Wax chunks: the interior isn't uniform — pressure varies across the nub.
      const interior = 0.82 + n * 0.26 + f * 0.1
      const i = (y * size + x) * 4
      data[i] = data[i + 1] = data[i + 2] = 255
      data[i + 3] = Math.round(Math.min(1, Math.max(0, alpha * interior)) * 255)
    }
  }
  ctx.putImageData(img, 0, 0)
  return Texture.from(canvas)
}

export function createPastelTip(size = 160): Texture {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const img = ctx.createImageData(size, size)
  const data = img.data
  const r = size / 2
  const noise = makeValueNoise(71)
  const fine = makeValueNoise(73, 28)

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - r
      const dy = y - r
      const dist = Math.sqrt(dx * dx + dy * dy) / r
      const n = noise(x / size, y / size) - 0.5
      const f = fine(x / size, y / size) - 0.5
      // Chalk: dense core, long dusty falloff, all of it grainy.
      const falloff = 1 - Math.min(1, Math.max(0, (dist + n * 0.18 - 0.45) / 0.5))
      const grainy = 0.72 + n * 0.3 + f * 0.26
      const i = (y * size + x) * 4
      data[i] = data[i + 1] = data[i + 2] = 255
      data[i + 3] = Math.round(Math.min(1, Math.max(0, falloff * grainy)) * 255)
    }
  }
  ctx.putImageData(img, 0, 0)
  return Texture.from(canvas)
}

export function createWetTips(): WetTips {
  return {
    sharp: createSharpTip(),
    splotch: createSplotchTip(),
    crayon: createCrayonTip(),
    pastel: createPastelTip(),
  }
}
