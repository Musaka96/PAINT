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

interface PaperRecipe {
  /** Base sheet color (warm near-whites — pure white reads as "no paper at all"). */
  base: string
  /** Soft tooth blobs: how many, how big, and how far luminance may deviate. */
  blobCount: number
  blobRadius: [number, number]
  blobAlpha: number
  /** Short stray fibers pressed into the sheet. */
  fiberCount: number
  fiberAlpha: number
  /** Fixed seed so the sheet looks identical on every load (and exports are reproducible). */
  seed: number
}

const RECIPES: Record<PaperId, PaperRecipe> = {
  smooth: {
    base: '#fbf9f5',
    blobCount: 140,
    blobRadius: [8, 26],
    blobAlpha: 0.025,
    fiberCount: 60,
    fiberAlpha: 0.02,
    seed: 101,
  },
  coldpress: {
    base: '#f9f6f0',
    blobCount: 320,
    blobRadius: [5, 20],
    blobAlpha: 0.055,
    fiberCount: 160,
    fiberAlpha: 0.035,
    seed: 202,
  },
  rough: {
    base: '#f7f3ea',
    blobCount: 420,
    blobRadius: [6, 30],
    blobAlpha: 0.085,
    fiberCount: 240,
    fiberAlpha: 0.05,
    seed: 303,
  },
}

/** Draws a shape at all nine wrap offsets so the tile has no visible seam. */
function wrapped(ctx: CanvasRenderingContext2D, size: number, draw: (ox: number, oy: number) => void) {
  for (const ox of [0, -size, size]) {
    for (const oy of [0, -size, size]) {
      draw(ox, oy)
    }
  }
}

function createPaperTexture(recipe: PaperRecipe, size = PAPER_TILE_SIZE): Texture {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const rand = mulberry32(recipe.seed)

  ctx.fillStyle = recipe.base
  ctx.fillRect(0, 0, size, size)

  // Tooth: soft light/dark blobs — the bumps and valleys pigment will settle into.
  for (let i = 0; i < recipe.blobCount; i++) {
    const x = rand() * size
    const y = rand() * size
    const r = recipe.blobRadius[0] + rand() * (recipe.blobRadius[1] - recipe.blobRadius[0])
    const dark = rand() < 0.55
    const shade = dark ? 0 : 255
    const alpha = recipe.blobAlpha * (0.4 + rand() * 0.6)
    wrapped(ctx, size, (ox, oy) => {
      const gradient = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r)
      gradient.addColorStop(0, `rgba(${shade},${shade},${shade},${alpha})`)
      gradient.addColorStop(1, `rgba(${shade},${shade},${shade},0)`)
      ctx.fillStyle = gradient
      ctx.beginPath()
      ctx.arc(x + ox, y + oy, r, 0, Math.PI * 2)
      ctx.fill()
    })
  }

  // Fibers: short faint strands at random angles.
  ctx.lineCap = 'round'
  for (let i = 0; i < recipe.fiberCount; i++) {
    const x = rand() * size
    const y = rand() * size
    const angle = rand() * Math.PI
    const len = 3 + rand() * 10
    const dx = Math.cos(angle) * len
    const dy = Math.sin(angle) * len
    const dark = rand() < 0.5
    const shade = dark ? 40 : 255
    ctx.strokeStyle = `rgba(${shade},${shade},${shade},${recipe.fiberAlpha * (0.4 + rand() * 0.6)})`
    ctx.lineWidth = 0.6 + rand() * 0.8
    wrapped(ctx, size, (ox, oy) => {
      ctx.beginPath()
      ctx.moveTo(x + ox - dx / 2, y + oy - dy / 2)
      ctx.lineTo(x + ox + dx / 2, y + oy + dy / 2)
      ctx.stroke()
    })
  }

  return Texture.from(canvas)
}

export function createPaperTextures(): Record<PaperId, Texture> {
  return {
    smooth: createPaperTexture(RECIPES.smooth),
    coldpress: createPaperTexture(RECIPES.coldpress),
    rough: createPaperTexture(RECIPES.rough),
  }
}
