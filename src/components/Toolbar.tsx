import { useEffect, useRef, useState } from 'react'
import {
  Brush,
  Circle,
  Download,
  Droplet,
  Droplets,
  Film,
  Highlighter,
  Layers,
  Notebook,
  Pencil,
  Loader2,
  Redo2,
  Settings2,
  Sparkles,
  SlidersHorizontal,
  Trash2,
  Undo2,
  Volume2,
  VolumeX,
  Waves,
} from 'lucide-react'
import { ColorPicker } from '@/components/ColorPicker'
import { LayersPanel } from '@/components/LayersPanel'
import { Slider } from '@/components/ui/slider'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { BrushId, WigglePattern, WiggleSettings } from '@/lib/brush-types'
import type { LayerInfo } from '@/lib/PaintEngine'
import { PAPERS, type PaperId } from '@/lib/papers'

const INK_BRUSHES: { id: BrushId; label: string; icon: typeof Circle }[] = [
  { id: 'round', label: 'Round', icon: Circle },
  { id: 'wobble', label: 'Wiggly', icon: Sparkles },
]

const WET_BRUSH_OPTIONS: { id: BrushId; label: string; icon: typeof Circle }[] = [
  { id: 'wetsharp', label: 'Wet Sharp', icon: Droplet },
  { id: 'wetround', label: 'Wet Round', icon: Droplets },
]

const CRAYON_BRUSH_OPTIONS: { id: BrushId; label: string; icon: typeof Circle }[] = [
  { id: 'crayon', label: 'Crayon', icon: Pencil },
  { id: 'pastel', label: 'Pastel', icon: Highlighter },
  { id: 'gouache', label: 'Gouache', icon: Brush },
]

const CRAYON_GROUP: BrushId[] = ['crayon', 'pastel', 'gouache']

const WIGGLE_PATTERNS: { id: WigglePattern; label: string }[] = [
  { id: 'sine', label: 'Sine' },
  { id: 'zigzag', label: 'Zigzag' },
  { id: 'square', label: 'Square' },
]

const PAPER_BLURBS: Record<PaperId, string> = {
  smooth: 'silky & even',
  coldpress: 'the classic',
  rough: 'extra toothy',
}

type PanelId = 'color' | 'paper' | 'wiggle' | 'settings' | 'layers' | null

interface ToolbarProps {
  brush: BrushId
  onBrushChange: (brush: BrushId) => void
  color: string
  onColorChange: (color: string) => void
  size: number
  onSizeChange: (size: number) => void
  wiggle: WiggleSettings
  onWiggleChange: (settings: Partial<WiggleSettings>) => void
  wetWiggle: boolean
  onWetWiggleChange: (on: boolean) => void
  loopTime: number
  onLoopTimeChange: (seconds: number) => void
  sound: boolean
  onSoundChange: (on: boolean) => void
  paper: PaperId
  onPaperChange: (paper: PaperId) => void
  layers: LayerInfo[]
  onAddLayer: () => void
  onDeleteLayer: (id: string) => void
  onSelectLayer: (id: string) => void
  onMoveLayer: (id: string, direction: 'up' | 'down') => void
  onLayerVisible: (id: string, visible: boolean) => void
  onLayerOpacity: (id: string, opacity: number) => void
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  onClear: () => void
  onExport: () => void
  onExportGif: () => void
  exportingGif: boolean
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

function Flyout({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="absolute top-1/2 right-full mr-3 -translate-y-1/2 rounded-3xl border border-black/5 bg-white/90 p-4 shadow-xl backdrop-blur-md animate-in fade-in slide-in-from-right-2 duration-200">
      {title && <p className="mb-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{title}</p>}
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
  wetWiggle,
  onWetWiggleChange,
  loopTime,
  onLoopTimeChange,
  sound,
  onSoundChange,
  paper,
  onPaperChange,
  layers,
  onAddLayer,
  onDeleteLayer,
  onSelectLayer,
  onMoveLayer,
  onLayerVisible,
  onLayerOpacity,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onClear,
  onExport,
  onExportGif,
  exportingGif,
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
    // Outer wrapper is the flyout anchor and is capped to the viewport height; it does NOT
    // scroll, so the flyouts (which extend leftward and are vertically centred) never get
    // clipped. The inner pill holds the buttons and scrolls when the sidebar is taller than
    // the window — otherwise it just shrink-wraps its contents and stays centred.
    <aside
      ref={asideRef}
      className="fixed top-1/2 right-3 z-20 flex max-h-[calc(100dvh-1rem)] -translate-y-1/2 flex-col"
    >
      <div className="flex min-h-0 flex-col items-center gap-1 overflow-y-auto rounded-[28px] border border-black/5 bg-white/80 p-2 shadow-xl backdrop-blur-md [scrollbar-width:thin]">
      {INK_BRUSHES.map(({ id, label, icon: Icon }) => (
        <ToolButton key={id} label={label} active={brush === id} onClick={() => onBrushChange(id)}>
          <Icon className="size-5" />
        </ToolButton>
      ))}

      {brush === 'wobble' && (
        <ToolButton label="Wiggle settings" active={panel === 'wiggle'} onClick={() => togglePanel('wiggle')}>
          <SlidersHorizontal className="size-5" />
        </ToolButton>
      )}

      {/* Waterpaints live together in their own little puddle. */}
      <div className="mt-1 flex flex-col items-center gap-1 rounded-3xl bg-sky-100/60 p-1">
        {WET_BRUSH_OPTIONS.map(({ id, label, icon: Icon }) => (
          <ToolButton key={id} label={label} active={brush === id} onClick={() => onBrushChange(id)}>
            <Icon className="size-5" />
          </ToolButton>
        ))}
        {(brush === 'wetsharp' || brush === 'wetround') && (
          <ToolButton
            label={wetWiggle ? 'Wiggly edges: on' : 'Wiggly edges: off'}
            onClick={() => onWetWiggleChange(!wetWiggle)}
            className={
              wetWiggle ? 'bg-sky-200/80 text-sky-700 shadow-inner animate-pulse' : 'text-sky-600/60'
            }
          >
            <Waves className="size-5" />
          </ToolButton>
        )}
      </div>

      {/* Crayons in their own warm little box. */}
      <div className="mt-1 flex flex-col items-center gap-1 rounded-3xl bg-amber-100/60 p-1">
        {CRAYON_BRUSH_OPTIONS.map(({ id, label, icon: Icon }) => (
          <ToolButton key={id} label={label} active={brush === id} onClick={() => onBrushChange(id)}>
            <Icon className="size-5" />
          </ToolButton>
        ))}
        {CRAYON_GROUP.includes(brush) && (
          <ToolButton
            label={wetWiggle ? 'Wiggly edges: on' : 'Wiggly edges: off'}
            onClick={() => onWetWiggleChange(!wetWiggle)}
            className={
              wetWiggle ? 'bg-amber-200/80 text-amber-700 shadow-inner animate-pulse' : 'text-amber-600/60'
            }
          >
            <Waves className="size-5" />
          </ToolButton>
        )}
      </div>

      <div className="my-1 h-px w-7 bg-black/10" />

      <ToolButton label="Color" active={panel === 'color'} onClick={() => togglePanel('color')}>
        <span
          className="size-6 rounded-full border-2 border-white shadow ring-1 ring-black/10"
          style={{ backgroundColor: color }}
        />
      </ToolButton>

      {/* Size lives right in the sidebar — no panel to open for the thing you adjust most.
          True-to-size feedback comes from the engine's centered brush ghost while sliding. */}
      <div className="flex flex-col items-center gap-1.5 py-1" aria-label={`Brush size ${size}`}>
        <Slider
          orientation="vertical"
          value={[size]}
          onValueChange={([value]) => onSizeChange(value)}
          min={2}
          max={64}
          step={1}
          className="data-vertical:h-24 data-vertical:min-h-24"
        />
        <span className="text-[10px] tabular-nums text-muted-foreground">{size}</span>
      </div>

      <ToolButton label="Layers" active={panel === 'layers'} onClick={() => togglePanel('layers')}>
        <Layers className="size-5" />
      </ToolButton>

      <ToolButton label="Paper" active={panel === 'paper'} onClick={() => togglePanel('paper')}>
        <Notebook className="size-5" />
      </ToolButton>

      <ToolButton label="Settings" active={panel === 'settings'} onClick={() => togglePanel('settings')}>
        <Settings2 className="size-5" />
      </ToolButton>

      <ToolButton
        label={sound ? 'Sounds: on' : 'Sounds: off'}
        onClick={() => onSoundChange(!sound)}
        className={sound ? '' : 'opacity-50'}
      >
        {sound ? <Volume2 className="size-5" /> : <VolumeX className="size-5" />}
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

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label="Save PNG"
            onClick={onExport}
            className="mt-1 grid size-11 place-items-center rounded-full bg-violet-500 text-white shadow-md transition-all duration-200 hover:scale-110 hover:-rotate-6 hover:bg-violet-600"
          >
            <Download className="size-5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="left">Save PNG</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label="Save GIF (1s loop)"
            onClick={onExportGif}
            disabled={exportingGif}
            className="grid size-11 place-items-center rounded-full bg-pink-500 text-white shadow-md transition-all duration-200 hover:scale-110 hover:rotate-6 hover:bg-pink-600 disabled:pointer-events-none disabled:opacity-70"
          >
            {exportingGif ? <Loader2 className="size-5 animate-spin" /> : <Film className="size-5" />}
          </button>
        </TooltipTrigger>
        <TooltipContent side="left">Save GIF — a perfect 1s loop</TooltipContent>
      </Tooltip>
      </div>

      {panel === 'color' && (
        <Flyout title="Color">
          <ColorPicker color={color} onChange={onColorChange} />
          <p className="mt-3 text-center text-[11px] text-muted-foreground">
            psst — wet brushes can't paint white!
          </p>
        </Flyout>
      )}

      {panel === 'layers' && (
        <Flyout title="">
          <LayersPanel
            layers={layers}
            onAdd={onAddLayer}
            onDelete={onDeleteLayer}
            onSelect={onSelectLayer}
            onMove={onMoveLayer}
            onVisible={onLayerVisible}
            onOpacity={onLayerOpacity}
          />
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

      {panel === 'settings' && (
        <Flyout title="Settings">
          <div className="flex w-52 flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="w-16 text-xs text-muted-foreground">Loop time</span>
              <Slider
                value={[loopTime]}
                onValueChange={([value]) => onLoopTimeChange(value)}
                min={1}
                max={4}
                step={0.5}
              />
              <span className="w-8 text-right text-xs tabular-nums text-muted-foreground">{loopTime}s</span>
            </div>
            <p className="text-[11px] leading-snug text-muted-foreground">
              One full wiggle cycle — and the length of an exported GIF, which always loops
              perfectly.
            </p>
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
