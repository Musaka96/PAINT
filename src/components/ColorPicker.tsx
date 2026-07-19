import { useEffect, useRef, useState } from 'react'

interface Hsv {
  h: number // 0-360
  s: number // 0-1
  v: number // 0-1
}

function hexToHsv(hex: string): Hsv {
  const n = parseInt(hex.replace('#', ''), 16)
  const r = ((n >> 16) & 255) / 255
  const g = ((n >> 8) & 255) / 255
  const b = (n & 255) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  if (d > 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6)
    else if (max === g) h = 60 * ((b - r) / d + 2)
    else h = 60 * ((r - g) / d + 4)
  }
  return { h: (h + 360) % 360, s: max === 0 ? 0 : d / max, v: max }
}

function hsvToHex({ h, s, v }: Hsv): string {
  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c
  let r = 0
  let g = 0
  let b = 0
  if (h < 60) [r, g, b] = [c, x, 0]
  else if (h < 120) [r, g, b] = [x, c, 0]
  else if (h < 180) [r, g, b] = [0, c, x]
  else if (h < 240) [r, g, b] = [0, x, c]
  else if (h < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  const to = (u: number) =>
    Math.round((u + m) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${to(r)}${to(g)}${to(b)}`
}

const clamp = (u: number) => Math.min(1, Math.max(0, u))

const PALETTES: { name: string; colors: string[] }[] = [
  {
    name: 'Pastel',
    colors: [
      '#ffb3ba', '#ffd1dc', '#ffdab9', '#fdfd96', '#e2f0cb', '#b5ead7',
      '#baffc9', '#aec6cf', '#bae1ff', '#c7ceea', '#e2c2ff', '#f6d5e5',
    ],
  },
  {
    name: 'Nature',
    colors: [
      '#1b4332', '#2d5a27', '#606c38', '#9caf88', '#b7b78a', '#d2b48c',
      '#b66a50', '#795548', '#5d4037', '#8d8d80', '#87b8d4', '#4a7d9c',
    ],
  },
  {
    name: 'Plastic',
    colors: [
      '#ff1744', '#f50057', '#ff3d00', '#ff9100', '#ffea00', '#76ff03',
      '#00e676', '#00e5ff', '#00b0ff', '#2979ff', '#651fff', '#d500f9',
    ],
  },
  {
    // Classic tube pigments — the palette a watercolor kit actually comes with.
    name: 'Pigments',
    colors: [
      '#f2c649', '#cb9d3f', '#c96f2f', '#a0522d', '#6e4232', '#704214',
      '#c03a2b', '#a32638', '#35469b', '#2a7fb8', '#40826d', '#475569',
    ],
  },
]

interface ColorPickerProps {
  color: string
  onChange: (color: string) => void
}

export function ColorPicker({ color, onChange }: ColorPickerProps) {
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(color))
  const lastEmitted = useRef(color.toLowerCase())
  const svRef = useRef<HTMLDivElement>(null)
  const hueRef = useRef<HTMLDivElement>(null)

  // Resync only on external changes (palette click routes through here too) — comparing against
  // the last value we emitted avoids fighting the user's drag with hex→hsv round-trip drift.
  useEffect(() => {
    if (color.toLowerCase() !== lastEmitted.current) {
      setHsv(hexToHsv(color))
      lastEmitted.current = color.toLowerCase()
    }
  }, [color])

  const commit = (next: Hsv) => {
    setHsv(next)
    const hex = hsvToHex(next)
    lastEmitted.current = hex
    onChange(hex)
  }

  const dragSv = (e: React.PointerEvent) => {
    const rect = svRef.current!.getBoundingClientRect()
    commit({
      ...hsv,
      s: clamp((e.clientX - rect.left) / rect.width),
      v: 1 - clamp((e.clientY - rect.top) / rect.height),
    })
  }

  const dragHue = (e: React.PointerEvent) => {
    const rect = hueRef.current!.getBoundingClientRect()
    commit({ ...hsv, h: clamp((e.clientX - rect.left) / rect.width) * 359.9 })
  }

  const hex = hsvToHex(hsv)

  return (
    <div className="flex w-56 flex-col gap-3">
      {/* Saturation / value pad */}
      <div
        ref={svRef}
        className="relative h-32 w-full cursor-crosshair touch-none rounded-xl ring-1 ring-black/10"
        style={{
          background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${hsv.h}, 100%, 50%))`,
        }}
        onPointerDown={(e) => {
          // Capture keeps the drag alive outside the pad; it can throw for pointers that are
          // already gone — selection must not die with it.
          try {
            e.currentTarget.setPointerCapture(e.pointerId)
          } catch {
            /* drag still works within bounds */
          }
          dragSv(e)
        }}
        onPointerMove={(e) => {
          if (e.buttons & 1) dragSv(e)
        }}
      >
        <span
          className="pointer-events-none absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-md"
          style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, backgroundColor: hex }}
        />
      </div>

      {/* Hue strip */}
      <div
        ref={hueRef}
        className="relative h-4 w-full cursor-pointer touch-none rounded-full ring-1 ring-black/10"
        style={{
          background:
            'linear-gradient(to right, #f00, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00)',
        }}
        onPointerDown={(e) => {
          try {
            e.currentTarget.setPointerCapture(e.pointerId)
          } catch {
            /* drag still works within bounds */
          }
          dragHue(e)
        }}
        onPointerMove={(e) => {
          if (e.buttons & 1) dragHue(e)
        }}
      >
        <span
          className="pointer-events-none absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-md"
          style={{ left: `${(hsv.h / 360) * 100}%`, backgroundColor: `hsl(${hsv.h}, 100%, 50%)` }}
        />
      </div>

      {/* Current color readout */}
      <div className="flex items-center gap-2">
        <span className="size-7 rounded-lg shadow-inner ring-1 ring-black/10" style={{ backgroundColor: hex }} />
        <span className="font-mono text-xs text-muted-foreground uppercase">{hex}</span>
      </div>

      {/* Palettes */}
      <div className="-mr-2 flex max-h-52 flex-col gap-3 overflow-y-auto pr-2">
        {PALETTES.map(({ name, colors }) => (
          <div key={name}>
            <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
              {name}
            </p>
            <div className="grid grid-cols-6 gap-1.5">
              {colors.map((swatch) => (
                <button
                  key={swatch}
                  type="button"
                  aria-label={`Color ${swatch}`}
                  title={swatch}
                  onClick={() => {
                    lastEmitted.current = swatch.toLowerCase()
                    setHsv(hexToHsv(swatch))
                    onChange(swatch)
                  }}
                  className={`size-5 rounded-md transition-transform hover:scale-125 hover:shadow ${
                    swatch.toLowerCase() === color.toLowerCase()
                      ? 'scale-110 ring-2 ring-violet-400 ring-offset-1'
                      : 'ring-1 ring-black/10'
                  }`}
                  style={{ backgroundColor: swatch }}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
