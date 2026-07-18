import { Circle, Download, Droplets, Redo2, Sparkles, Trash2, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import type { BrushId, WigglePattern, WiggleSettings } from '@/lib/brush-types'
import { PAPERS, type PaperId } from '@/lib/papers'

const BRUSH_OPTIONS: { id: BrushId; label: string; icon: typeof Circle }[] = [
  { id: 'round', label: 'Round', icon: Circle },
  { id: 'wobble', label: 'Wiggly', icon: Sparkles },
  { id: 'watercolor', label: 'Watercolor', icon: Droplets },
]

const WIGGLE_PATTERNS: { id: WigglePattern; label: string }[] = [
  { id: 'sine', label: 'Sine' },
  { id: 'zigzag', label: 'Zigzag' },
  { id: 'square', label: 'Square' },
]

const SWATCHES = ['#1e1e2e', '#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#a855f7', '#ffffff']

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
  return (
    <div className="flex w-full max-w-3xl flex-col gap-2">
      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-border bg-card p-3 shadow-sm">
        <ToggleGroup
          type="single"
          value={brush}
          onValueChange={(value) => value && onBrushChange(value as BrushId)}
          className="gap-1"
        >
          {BRUSH_OPTIONS.map(({ id, label, icon: Icon }) => (
            <Tooltip key={id}>
              <TooltipTrigger asChild>
                <ToggleGroupItem value={id} aria-label={label} className="size-10">
                  <Icon className="size-4" />
                </ToggleGroupItem>
              </TooltipTrigger>
              <TooltipContent>{label}</TooltipContent>
            </Tooltip>
          ))}
        </ToggleGroup>

        <div className="h-8 w-px bg-border" />

        <div className="flex items-center gap-1.5">
          {SWATCHES.map((swatch) => (
            <button
              key={swatch}
              type="button"
              aria-label={`Color ${swatch}`}
              onClick={() => onColorChange(swatch)}
              className="size-6 rounded-full border transition-transform hover:scale-110"
              style={{
                backgroundColor: swatch,
                borderColor: swatch === color ? 'var(--color-ring)' : 'var(--color-border)',
                outline: swatch === color ? '2px solid var(--color-ring)' : 'none',
                outlineOffset: 1,
              }}
            />
          ))}
          <input
            type="color"
            value={color}
            onChange={(e) => onColorChange(e.target.value)}
            className="size-7 cursor-pointer rounded-full border border-border bg-transparent p-0"
            aria-label="Custom color"
          />
        </div>

        <div className="h-8 w-px bg-border" />

        <div className="flex w-40 items-center gap-2">
          <span className="text-xs text-muted-foreground">Size</span>
          <Slider
            value={[size]}
            onValueChange={([value]) => onSizeChange(value)}
            min={2}
            max={64}
            step={1}
          />
          <span className="w-6 text-right text-xs tabular-nums text-muted-foreground">{size}</span>
        </div>

        <div className="h-8 w-px bg-border" />

        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" onClick={onUndo} disabled={!canUndo}>
                <Undo2 className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Undo</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" onClick={onRedo} disabled={!canRedo}>
                <Redo2 className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Redo</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" onClick={onClear}>
                <Trash2 className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Clear canvas</TooltipContent>
          </Tooltip>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Paper</span>
          <ToggleGroup
            type="single"
            value={paper}
            onValueChange={(value) => value && onPaperChange(value as PaperId)}
            className="gap-1"
          >
            {PAPERS.map(({ id, label }) => (
              <ToggleGroupItem key={id} value={id} className="px-3 text-xs">
                {label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>

        <div className="ml-auto">
          <Button onClick={onExport} className="gap-2">
            <Download className="size-4" />
            Save PNG
          </Button>
        </div>
      </div>

      {brush === 'wobble' && (
        <div className="flex flex-wrap items-center gap-4 rounded-xl border border-border bg-card p-3 shadow-sm">
          <ToggleGroup
            type="single"
            value={wiggle.pattern}
            onValueChange={(value) => value && onWiggleChange({ pattern: value as WigglePattern })}
            className="gap-1"
          >
            {WIGGLE_PATTERNS.map(({ id, label }) => (
              <ToggleGroupItem key={id} value={id} className="px-3 text-xs">
                {label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>

          <div className="h-8 w-px bg-border" />

          <div className="flex w-36 items-center gap-2">
            <span className="text-xs text-muted-foreground">Height</span>
            <Slider
              value={[wiggle.amplitude]}
              onValueChange={([value]) => onWiggleChange({ amplitude: value })}
              min={0}
              max={1.5}
              step={0.05}
            />
          </div>

          <div className="flex w-36 items-center gap-2">
            <span className="text-xs text-muted-foreground">Length</span>
            <Slider
              value={[wiggle.wavelength]}
              onValueChange={([value]) => onWiggleChange({ wavelength: value })}
              min={30}
              max={300}
              step={10}
            />
          </div>

          <div className="flex w-36 items-center gap-2">
            <span className="text-xs text-muted-foreground">Speed</span>
            <Slider
              value={[wiggle.speed]}
              onValueChange={([value]) => onWiggleChange({ speed: value })}
              min={0}
              max={15}
              step={0.5}
            />
          </div>
        </div>
      )}
    </div>
  )
}
