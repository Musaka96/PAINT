import { Texture } from 'pixi.js'

function makeCanvas(size: number) {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  return canvas
}

/** A smooth, feathered round dot — the base stamp for soft/round brushes. */
export function createSoftTexture(size = 128): Texture {
  const canvas = makeCanvas(size)
  const ctx = canvas.getContext('2d')!
  const r = size / 2
  const gradient = ctx.createRadialGradient(r, r, 0, r, r, r)
  gradient.addColorStop(0, 'rgba(255,255,255,1)')
  gradient.addColorStop(0.6, 'rgba(255,255,255,0.55)')
  gradient.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, size, size)
  return Texture.from(canvas)
}

/** A round dot with a noisy, ragged edge — used for watercolor bleed. */
export function createRoughTexture(size = 160): Texture {
  const canvas = makeCanvas(size)
  const ctx = canvas.getContext('2d')!
  const r = size / 2
  const gradient = ctx.createRadialGradient(r, r, 0, r, r, r)
  gradient.addColorStop(0, 'rgba(255,255,255,0.9)')
  gradient.addColorStop(0.7, 'rgba(255,255,255,0.35)')
  gradient.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, size, size)

  const img = ctx.getImageData(0, 0, size, size)
  const data = img.data
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      const dx = x - r
      const dy = y - r
      const dist = Math.sqrt(dx * dx + dy * dy) / r
      const noise = Math.random()
      const edge = 1 - Math.min(1, Math.max(0, (dist - 0.5 + noise * 0.5) / 0.5))
      data[i + 3] = Math.round(data[i + 3] * edge)
    }
  }
  ctx.putImageData(img, 0, 0)
  return Texture.from(canvas)
}
