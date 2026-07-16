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

/** A tileable mottled-tone pattern — tinted and masked to a stroke's shape, this gives watercolor
 * its granulation (pigment settling unevenly on paper) instead of a flat, uniform fill. */
export function createGrainTexture(size = 320): Texture {
  const canvas = makeCanvas(size)
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, size, size)

  const blobCount = 260
  for (let i = 0; i < blobCount; i++) {
    const x = Math.random() * size
    const y = Math.random() * size
    const r = 6 + Math.random() * 22
    const dark = Math.random() < 0.55
    const shade = dark ? 0 : 255
    const alpha = 0.04 + Math.random() * 0.14
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, r)
    gradient.addColorStop(0, `rgba(${shade},${shade},${shade},${alpha})`)
    gradient.addColorStop(1, `rgba(${shade},${shade},${shade},0)`)
    ctx.fillStyle = gradient
    // Wrap blobs across all four edges so the texture tiles without a visible seam.
    for (const ox of [0, -size, size]) {
      for (const oy of [0, -size, size]) {
        ctx.beginPath()
        ctx.arc(x + ox, y + oy, r, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }

  return Texture.from(canvas)
}
