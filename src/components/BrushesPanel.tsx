import type { LucideIcon } from 'lucide-react'
import { Slider } from '@/components/ui/slider'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import type { BrushId, WigglePattern, WiggleSettings } from '@/lib/brush-types'
import { WET_BRUSHES, isWetBrush } from '@/lib/wet-brushes'

export interface BrushOption {
  id: BrushId
  label: string
  icon: LucideIcon
}

export interface BrushGroup {
  name: string
  /** Tailwind classes tinting the group's tiles, so families read at a glance. */
  accent: string
  brushes: BrushOption[]
}

const WIGGLE_PATTERNS: { id: WigglePattern; label: string }[] = [
  { id: 'sine', label: 'Sine' },
  { id: 'zigzag', label: 'Zigzag' },
  { id: 'square', label: 'Square' },
]

/** Brushes whose outer edge can be left "wet" and animated. */
export function supportsEdgeWiggle(id: BrushId) {
  return isWetBrush(id) && WET_BRUSHES[id].wiggleable !== false
}

interface BrushesPanelProps {
  groups: BrushGroup[]
  brush: BrushId
  onBrushChange: (brush: BrushId) => void
  wiggle: WiggleSettings
  onWiggleChange: (settings: Partial<WiggleSettings>) => void
  wetWiggle: boolean
  onWetWiggleChange: (on: boolean) => void
}

export function BrushesPanel({
  groups,
  brush,
  onBrushChange,
  wiggle,
  onWiggleChange,
  wetWiggle,
  onWetWiggleChange,
}: BrushesPanelProps) {
  return (
    <div className="flex w-60 flex-col gap-3">
      {groups.map((group) => (
        <div key={group.name}>
          <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
            {group.name}
          </p>
          <div className="grid grid-cols-3 gap-1.5">
            {group.brushes.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                aria-label={label}
                aria-pressed={brush === id}
                onClick={() => onBrushChange(id)}
                className={`flex flex-col items-center gap-1 rounded-2xl border px-1 py-2 transition-all ${
                  brush === id
                    ? 'border-violet-300 bg-violet-50 text-violet-700 shadow-inner'
                    : `border-black/5 ${group.accent} hover:border-black/15`
                }`}
              >
                <Icon className="size-5" />
                <span className="text-[10px] leading-tight">{label}</span>
              </button>
            ))}
          </div>
        </div>
      ))}

      {/* Options for the selected brush live with the brushes, not as mystery sidebar icons. */}
      {(brush === 'wobble' || supportsEdgeWiggle(brush)) && (
        <div className="border-t border-black/5 pt-3">
          <p className="mb-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
            {brush === 'wobble' ? 'Wave' : 'Options'}
          </p>

          {supportsEdgeWiggle(brush) && (
            <button
              type="button"
              role="switch"
              aria-checked={wetWiggle}
              aria-label="Wiggly edges"
              onClick={() => onWetWiggleChange(!wetWiggle)}
              className={`flex w-full items-center justify-between rounded-2xl border px-3 py-2 transition-all ${
                wetWiggle
                  ? 'border-violet-300 bg-violet-50 shadow-inner'
                  : 'border-black/5 bg-white hover:border-black/15'
              }`}
            >
              <span className="text-sm">Wiggly edges</span>
              <span
                className={`relative h-5 w-9 rounded-full transition-colors ${
                  wetWiggle ? 'bg-violet-500' : 'bg-black/15'
                }`}
              >
                <span
                  className={`absolute top-0.5 size-4 rounded-full bg-white shadow transition-all ${
                    wetWiggle ? 'left-[1.125rem]' : 'left-0.5'
                  }`}
                />
              </span>
            </button>
          )}

          {brush === 'wobble' && (
            <div className="flex flex-col gap-3">
              <ToggleGroup
                type="single"
                value={wiggle.pattern}
                onValueChange={(value) => value && onWiggleChange({ pattern: value as WigglePattern })}
                className="gap-1"
              >
                {WIGGLE_PATTERNS.map(({ id, label }) => (
                  <ToggleGroupItem key={id} value={id} className="flex-1 px-2 text-xs">
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
          )}
        </div>
      )}
    </div>
  )
}
