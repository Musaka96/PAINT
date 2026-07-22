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
  Loader2,
  PaintbrushVertical,
  Pencil,
  PencilLine,
  Redo2,
  Settings2,
  Share,
  Sparkles,
  Undo2,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { BrushesPanel, supportsEdgeWiggle, type BrushGroup } from '@/components/BrushesPanel'
import { ColorPicker } from '@/components/ColorPicker'
import { LayersPanel } from '@/components/LayersPanel'
import { Slider } from '@/components/ui/slider'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { BrushId, WiggleSettings } from '@/lib/brush-types'
import type { LayerInfo } from '@/lib/PaintEngine'
import { PAPERS, type PaperId } from '@/lib/papers'

/** Brushes grouped by family — the picker shows names, so nothing is a mystery icon. */
const BRUSH_GROUPS: BrushGroup[] = [
  {
    name: 'Ink',
    accent: 'bg-white',
    brushes: [
      { id: 'round', label: 'Round', icon: Circle },
      { id: 'wobble', label: 'Wiggly', icon: Sparkles },
    ],
  },
  {
    name: 'Pencil',
    accent: 'bg-stone-50',
    brushes: [
      { id: 'pencil', label: 'HB', icon: PencilLine },
      { id: 'softpencil', label: 'Soft 6B', icon: Pencil },
    ],
  },
  {
    name: 'Watercolor',
    accent: 'bg-sky-50',
    brushes: [
      { id: 'wetsharp', label: 'Sharp', icon: Droplet },
      { id: 'wetround', label: 'Round', icon: Droplets },
    ],
  },
  {
    name: 'Dry media',
    accent: 'bg-amber-50',
    brushes: [
      { id: 'crayon', label: 'Crayon', icon: PaintbrushVertical },
      { id: 'pastel', label: 'Pastel', icon: Highlighter },
      { id: 'gouache', label: 'Gouache', icon: Brush },
    ],
  },
]

/** Flattened with their family name — two brushes are both called "Round" (ink vs watercolor),
 * so the button tooltip qualifies them: "Watercolor · Round". */
const ALL_BRUSHES = BRUSH_GROUPS.flatMap((g) => g.brushes.map((b) => ({ ...b, group: g.name })))

const PAPER_BLURBS: Record<PaperId, string> = {
  smooth: 'silky & even',
  coldpress: 'the classic',
  rough: 'extra toothy',
  sketch: 'cream & ribbed',
  canvas: 'woven threads',
  kraft: 'brown & pulpy',
}

type PanelId = 'brushes' | 'color' | 'layers' | 'settings' | 'export' | null

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
          className={`grid size-10 place-items-center rounded-2xl transition-all duration-200 ${
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

  // Close the open flyout when tapping anywhere else (a stray panel floating over the art is
  // worse than having to reopen it).
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

  const current = ALL_BRUSHES.find((b) => b.id === brush) ?? ALL_BRUSHES[0]
  const CurrentIcon = current.icon
  // The edge-wiggle modifier is a per-brush option, but worth surfacing on the button so an
  // enabled mode is never invisible.
  const wiggleOn = wetWiggle && supportsEdgeWiggle(brush)

  return (
    // Outer wrapper is the flyout anchor and is capped to the viewport; the inner pill holds the
    // controls. With the brush picker folded into one button the pill fits any window, but the
    // cap keeps it safe if it ever grows again.
    <aside
      ref={asideRef}
      className="fixed top-1/2 right-3 z-20 flex max-h-[calc(100dvh-1rem)] -translate-y-1/2 flex-col"
    >
      <div className="flex min-h-0 flex-col items-center gap-1 overflow-y-auto rounded-[26px] border border-black/5 bg-white/80 p-2 shadow-xl backdrop-blur-md [scrollbar-width:thin]">
        {/* --- What you're drawing with -------------------------------------- */}
        <ToolButton
          label={`${current.group} · ${current.label}${wiggleOn ? ' — wiggly edges' : ''}`}
          active={panel === 'brushes'}
          onClick={() => togglePanel('brushes')}
          className="relative"
        >
          <CurrentIcon className="size-5" />
          {wiggleOn && (
            <span className="absolute right-1 bottom-1 size-1.5 rounded-full bg-violet-500 ring-2 ring-white" />
          )}
        </ToolButton>

        <ToolButton label="Color" active={panel === 'color'} onClick={() => togglePanel('color')}>
          <span
            className="size-6 rounded-full border-2 border-white shadow ring-1 ring-black/10"
            style={{ backgroundColor: color }}
          />
        </ToolButton>

        {/* Size stays inline — it's the control you reach for constantly. */}
        <div className="flex flex-col items-center gap-1 py-1" aria-label={`Brush size ${size}`}>
          <Slider
            orientation="vertical"
            value={[size]}
            onValueChange={([value]) => onSizeChange(value)}
            min={2}
            max={64}
            step={1}
            className="data-vertical:h-20 data-vertical:min-h-20"
          />
          <span className="text-[10px] tabular-nums text-muted-foreground">{size}</span>
        </div>

        <div className="my-0.5 h-px w-6 bg-black/10" />

        {/* --- Where it goes / how it looks ----------------------------------- */}
        <ToolButton label="Layers" active={panel === 'layers'} onClick={() => togglePanel('layers')}>
          <Layers className="size-5" />
        </ToolButton>

        <ToolButton label="Settings" active={panel === 'settings'} onClick={() => togglePanel('settings')}>
          <Settings2 className="size-5" />
        </ToolButton>

        <div className="my-0.5 h-px w-6 bg-black/10" />

        {/* --- History (paired to save a row) --------------------------------- */}
        <div className="flex items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="Undo"
                onClick={onUndo}
                disabled={!canUndo}
                className="grid size-8 place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground disabled:pointer-events-none disabled:opacity-25"
              >
                <Undo2 className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="left">Undo</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="Redo"
                onClick={onRedo}
                disabled={!canRedo}
                className="grid size-8 place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground disabled:pointer-events-none disabled:opacity-25"
              >
                <Redo2 className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="left">Redo</TooltipContent>
          </Tooltip>
        </div>

        {/* --- Take it with you ----------------------------------------------- */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="Export"
              onClick={() => togglePanel('export')}
              className={`mt-0.5 grid size-10 place-items-center rounded-full bg-violet-500 text-white shadow-md transition-all duration-200 hover:scale-110 hover:-rotate-6 hover:bg-violet-600 ${
                panel === 'export' ? 'scale-110 -rotate-6' : ''
              }`}
            >
              {exportingGif ? <Loader2 className="size-5 animate-spin" /> : <Share className="size-5" />}
            </button>
          </TooltipTrigger>
          <TooltipContent side="left">Export</TooltipContent>
        </Tooltip>
      </div>

      {/* --- Flyouts (siblings of the scroll area, so they're never clipped) --- */}
      {panel === 'brushes' && (
        <Flyout title="Brushes">
          <BrushesPanel
            groups={BRUSH_GROUPS}
            brush={brush}
            onBrushChange={onBrushChange}
            wiggle={wiggle}
            onWiggleChange={onWiggleChange}
            wetWiggle={wetWiggle}
            onWetWiggleChange={onWetWiggleChange}
          />
        </Flyout>
      )}

      {panel === 'color' && (
        <Flyout title="Color">
          <ColorPicker color={color} onChange={onColorChange} />
          <p className="mt-3 text-center text-[11px] text-muted-foreground">
            psst — watercolors can't paint white!
          </p>
        </Flyout>
      )}

      {panel === 'layers' && (
        <Flyout>
          <LayersPanel
            layers={layers}
            onAdd={onAddLayer}
            onDelete={onDeleteLayer}
            onSelect={onSelectLayer}
            onMove={onMoveLayer}
            onVisible={onLayerVisible}
            onOpacity={onLayerOpacity}
            onClear={onClear}
          />
        </Flyout>
      )}

      {panel === 'settings' && (
        <Flyout title="Settings">
          <div className="flex w-56 flex-col gap-4">
            <div>
              <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                Paper
              </p>
              <div className="grid grid-cols-3 gap-1.5">
                {PAPERS.map(({ id, label }) => (
                  <button
                    key={id}
                    type="button"
                    aria-label={`${label} paper`}
                    onClick={() => onPaperChange(id)}
                    className={`rounded-2xl border px-1 py-2 transition-all ${
                      paper === id
                        ? 'border-violet-300 bg-violet-50 shadow-inner'
                        : 'border-black/5 bg-white hover:border-black/15'
                    }`}
                  >
                    <span className="block text-[11px] font-medium">{label}</span>
                    <span className="block text-[9px] leading-tight text-muted-foreground">
                      {PAPER_BLURBS[id]}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                Animation
              </p>
              <div className="flex items-center gap-2">
                <span className="w-14 text-xs text-muted-foreground">Loop</span>
                <Slider
                  value={[loopTime]}
                  onValueChange={([value]) => onLoopTimeChange(value)}
                  min={1}
                  max={4}
                  step={0.5}
                />
                <span className="w-7 text-right text-xs tabular-nums text-muted-foreground">{loopTime}s</span>
              </div>
              <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
                One full wiggle cycle — and the length of an exported GIF.
              </p>
            </div>

            <button
              type="button"
              role="switch"
              aria-checked={sound}
              aria-label={sound ? 'Sounds: on' : 'Sounds: off'}
              onClick={() => onSoundChange(!sound)}
              className={`flex items-center justify-between rounded-2xl border px-3 py-2 transition-all ${
                sound ? 'border-violet-300 bg-violet-50 shadow-inner' : 'border-black/5 bg-white hover:border-black/15'
              }`}
            >
              <span className="flex items-center gap-2 text-sm">
                {sound ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
                Brush sounds
              </span>
              <span className={`relative h-5 w-9 rounded-full transition-colors ${sound ? 'bg-violet-500' : 'bg-black/15'}`}>
                <span
                  className={`absolute top-0.5 size-4 rounded-full bg-white shadow transition-all ${
                    sound ? 'left-[1.125rem]' : 'left-0.5'
                  }`}
                />
              </span>
            </button>
          </div>
        </Flyout>
      )}

      {panel === 'export' && (
        <Flyout title="Export">
          <div className="flex w-48 flex-col gap-2">
            <button
              type="button"
              onClick={onExport}
              className="flex items-center gap-3 rounded-2xl border border-black/5 bg-white px-3 py-2.5 text-left transition-all hover:border-violet-300 hover:bg-violet-50"
            >
              <Download className="size-4 shrink-0 text-violet-500" />
              <span>
                <span className="block text-sm font-medium">PNG image</span>
                <span className="block text-[11px] text-muted-foreground">a still picture</span>
              </span>
            </button>
            <button
              type="button"
              onClick={onExportGif}
              disabled={exportingGif}
              className="flex items-center gap-3 rounded-2xl border border-black/5 bg-white px-3 py-2.5 text-left transition-all hover:border-pink-300 hover:bg-pink-50 disabled:pointer-events-none disabled:opacity-60"
            >
              {exportingGif ? (
                <Loader2 className="size-4 shrink-0 animate-spin text-pink-500" />
              ) : (
                <Film className="size-4 shrink-0 text-pink-500" />
              )}
              <span>
                <span className="block text-sm font-medium">{exportingGif ? 'Rendering…' : 'GIF loop'}</span>
                <span className="block text-[11px] text-muted-foreground">{loopTime}s, loops forever</span>
              </span>
            </button>
          </div>
        </Flyout>
      )}
    </aside>
  )
}
