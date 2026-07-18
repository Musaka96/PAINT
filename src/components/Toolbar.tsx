import { useEffect, useRef, useState } from 'react'
import {
  Circle,
  Download,
  Droplet,
  Droplets,
  Layers,
  Redo2,
  Sparkles,
  SlidersHorizontal,
  Trash2,
  Undo2,
} from 'lucide-react'
import { Slider } from '@/components/ui/slider'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { BrushId, WigglePattern, WiggleSettings } from '@/lib/brush-types'
import { PAPERS, type PaperId } from '@/lib/papers'

const BRUSH_OPTIONS: { id: BrushId; label: string; icon: typeof Circle }[] = [
  { id: 'round', label: 'Round', icon: Circle },
  { id: 'wobble', label: 'Wiggly', icon: Sparkles },
  { id: 'wetsharp', label: 'Wet Sharp', icon: Droplet },
  { id: 'wetround', label: 'Wet Round', icon: Droplets },
]

const WIGGLE_PATTERNS: { id: WigglePattern; label: string }[] = [
  { id: 'sine', label: 'Sine' },
  { id: 'zigzag', label: 'Zigzag' },
  { id: 'square', label: 'Square' },
]

const SWATCHES = ['#1e1e2e', '#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#a855f7', '#8b5e3c']

const PAPER_BLURBS: Record<PaperId, string> = {
  smooth: 'silky & even',
  coldpress: 'the classic',
  rough: 'extra toothy',
}

type PanelId = 'color' | 'size' | 'paper' | 'wiggle' | null

interface ToolbarProps {
  brush: BrushId
  onBrushChange: (brush: BrushId) => void
  color: string
  onColorChange: (color: string) => void
  size: number
  onSizeChange: (size: number) => void
  wiggle: WiggleSettings
  onWiggleChange: (settings: Partial<WiggleSettings>) => void
  paper: PaperId
  onPaperChange: (paper: PaperId) => void
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  onClear: () => void
  onExport: () => void
}

/** Round icon button for the sidebar. Active tools get a lavender bubble and a playful tilt. */
function ToolButton({
  label,
  active = false,
  onClick,
  children,
  className = '',
}: {
  label: string
  active?: boolean
  onClick: () => void
  children: React.ReactNode
  className?: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={active}
          onClick={onClick}
          className={`grid size-11 place-items-center rounded-2xl transition-all duration-200 ${
            active
              ? 'scale-110 -rotate-6 bg-violet-100 text-violet-600 shadow-inner'
              : 'text-muted-foreground hover:scale-105 hover:bg-black/5 hover:text-foreground'
          } ${className}`}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="left">{label}</TooltipContent>
    </Tooltip>
  )
}

function Flyout({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="absolute top-1/2 right-full mr-3 -translate-y-1/2 rounded-3xl border border-black/5 bg-white/90 p-4 shadow-xl backdrop-blur-md animate-in fade-in slide-in-from-right-2 duration-200">
      <p className="mb-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{title}</p>
      {children}
    </div>
  )
}

export function Toolbar({
  brush,
  onBrushChange,
  color,
  onColorChange,
  size,
  onSizeChange,
  wiggle,
  onWiggleChange,
  paper,
  onPaperChange,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onClear,
  onExport,
}: ToolbarProps) {
  const [panel, setPanel] = useState<PanelId>(null)
  const asideRef = useRef<HTMLElement>(null)

  const togglePanel = (id: Exclude<PanelId, null>) => setPanel((current) => (current === id ? null : id))

  // Close the open flyout when tapping anywhere else (the canvas is for drawing, not for
  // dismissing panels by surprise — but a stray panel floating over the art is worse).
  useEffect(() => {
    if (!panel) return
    const onPointerDown = (e: PointerEvent) => {
      if (asideRef.current && !asideRef.current.contains(e.target as Node)) setPanel(null)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPanel(null)
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [panel])

  // The wiggle panel only makes sense while the wiggly brush is selected.
  useEffect(() => {
    if (brush !== 'wobble') setPanel((current) => (current === 'wiggle' ? null : current))
  }, [brush])

  return (
    <aside
      ref={asideRef}
      className="fixed top-1/2 right-3 z-20 flex -translate-y-1/2 flex-col items-center gap-1 rounded-[28px] border border-black/5 bg-white/80 p-2 shadow-xl backdrop-blur-md"
    >
      {BRUSH_OPTIONS.map(({ id, label, icon: Icon }) => (
        <ToolButton key={id} label={label} active={brush === id} onClick={() => onBrushChange(id)}>
          <Icon className="size-5" />
        </ToolButton>
      ))}

      {brush === 'wobble' && (
        <ToolButton label="Wiggle settings" active={panel === 'wiggle'} onClick={() => togglePanel('wiggle')}>
          <SlidersHorizontal className="size-5" />
        </ToolButton>
      )}

      <div className="my-1 h-px w-7 bg-black/10" />

      <ToolButton label="Color" active={panel === 'color'} onClick={() => togglePanel('color')}>
        <span
          className="size-6 rounded-full border-2 border-white shadow ring-1 ring-black/10"
          style={{ backgroundColor: color }}
        />
      </ToolButton>

      <ToolButton label={`Brush size (${size})`} active={panel === 'size'} onClick={() => togglePanel('size')}>
        <span
          className="rounded-full bg-current"
          style={{ width: 6 + (size / 64) * 16, height: 6 + (size / 64) * 16 }}
        />
      </ToolButton>

      <ToolButton label="Paper" active={panel === 'paper'} onClick={() => togglePanel('paper')}>
        <Layers className="size-5" />
      </ToolButton>

      <div className="my-1 h-px w-7 bg-black/10" />

      <ToolButton label="Undo" onClick={onUndo} className={canUndo ? '' : 'pointer-events-none opacity-30'}>
        <Undo2 className="size-5" />
      </ToolButton>
      <ToolButton label="Redo" onClick={onRedo} className={canRedo ? '' : 'pointer-events-none opacity-30'}>
        <Redo2 className="size-5" />
      </ToolButton>
      <ToolButton label="Clear canvas" onClick={onClear} className="hover:bg-rose-50 hover:text-rose-500">
        <Trash2 className="size-5" />
      </ToolButton>

      <button
        type="button"
        aria-label="Save PNG"
        onClick={onExport}
        className="mt-1 grid size-11 place-items-center rounded-full bg-violet-500 text-white shadow-md transition-all duration-200 hover:scale-110 hover:-rotate-6 hover:bg-violet-600"
      >
        <Download className="size-5" />
      </button>

      {panel === 'color' && (
        <Flyout title="Color">
          <div className="grid grid-cols-3 gap-2">
            {SWATCHES.map((swatch) => (
              <button
                key={swatch}
                type="button"
                aria-label={`Color ${swatch}`}
                onClick={() => onColorChange(swatch)}
                className={`size-9 rounded-full transition-transform hover:scale-110 ${
                  swatch === color ? 'scale-110 ring-2 ring-violet-400 ring-offset-2' : 'ring-1 ring-black/10'
                }`}
                style={{ backgroundColor: swatch }}
              />
            ))}
            <label
              aria-label="Custom color"
              className="relative grid size-9 cursor-pointer place-items-center overflow-hidden rounded-full ring-1 ring-black/10 transition-transform hover:scale-110"
              style={{ background: 'conic-gradient(#f87171, #fbbf24, #4ade80, #60a5fa, #c084fc, #f87171)' }}
            >
              <input
                type="color"
                value={color}
                onChange={(e) => onColorChange(e.target.value)}
                className="absolute inset-0 cursor-pointer opacity-0"
              />
            </label>
          </div>
          <p className="mt-3 text-center text-[11px] text-muted-foreground">
            psst — wet brushes can't paint white!
          </p>
        </Flyout>
      )}

      {panel === 'size' && (
        <Flyout title="Size">
          <div className="flex flex-col items-center gap-3">
            <span
              className="rounded-full bg-foreground/80"
              style={{ width: Math.max(4, size / 2), height: Math.max(4, size / 2) }}
            />
            <Slider
              orientation="vertical"
              value={[size]}
              onValueChange={([value]) => onSizeChange(value)}
              min={2}
              max={64}
              step={1}
              className="h-40"
            />
            <span className="text-xs tabular-nums text-muted-foreground">{size}px</span>
          </div>
        </Flyout>
      )}

      {panel === 'paper' && (
        <Flyout title="Paper">
          <div className="flex w-40 flex-col gap-2">
            {PAPERS.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                aria-label={`${label} paper`}
                onClick={() => onPaperChange(id)}
                className={`rounded-2xl border px-3 py-2 text-left transition-all ${
                  paper === id
                    ? 'border-violet-300 bg-violet-50 shadow-inner'
                    : 'border-black/5 bg-white hover:border-black/15'
                }`}
              >
                <span className="block text-sm font-medium">{label}</span>
                <span className="block text-[11px] text-muted-foreground">{PAPER_BLURBS[id]}</span>
              </button>
            ))}
          </div>
        </Flyout>
      )}

      {panel === 'wiggle' && (
        <Flyout title="Wiggle">
          <div className="flex w-48 flex-col gap-4">
            <ToggleGroup
              type="single"
              value={wiggle.pattern}
              onValueChange={(value) => value && onWiggleChange({ pattern: value as WigglePattern })}
              className="gap-1"
            >
              {WIGGLE_PATTERNS.map(({ id, label }) => (
                <ToggleGroupItem key={id} value={id} className="px-2.5 text-xs">
                  {label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            {(
              [
                { label: 'Height', key: 'amplitude', min: 0, max: 1.5, step: 0.05 },
                { label: 'Length', key: 'wavelength', min: 30, max: 300, step: 10 },
                { label: 'Speed', key: 'speed', min: 0, max: 15, step: 0.5 },
              ] as const
            ).map(({ label, key, min, max, step }) => (
              <div key={key} className="flex items-center gap-2">
                <span className="w-12 text-xs text-muted-foreground">{label}</span>
                <Slider
                  value={[wiggle[key]]}
                  onValueChange={([value]) => onWiggleChange({ [key]: value })}
                  min={min}
                  max={max}
                  step={step}
                />
              </div>
            ))}
          </div>
        </Flyout>
      )}
    </aside>
  )
}
