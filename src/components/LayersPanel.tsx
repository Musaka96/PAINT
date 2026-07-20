import { ChevronDown, ChevronUp, Eye, EyeOff, Plus, Trash2 } from 'lucide-react'
import { Slider } from '@/components/ui/slider'
import type { LayerInfo } from '@/lib/PaintEngine'

interface LayersPanelProps {
  layers: LayerInfo[] // top layer first
  onAdd: () => void
  onDelete: (id: string) => void
  onSelect: (id: string) => void
  onMove: (id: string, direction: 'up' | 'down') => void
  onVisible: (id: string, visible: boolean) => void
  onOpacity: (id: string, opacity: number) => void
}

export function LayersPanel({
  layers,
  onAdd,
  onDelete,
  onSelect,
  onMove,
  onVisible,
  onOpacity,
}: LayersPanelProps) {
  return (
    <div className="flex w-60 flex-col">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Layers</span>
        <button
          type="button"
          aria-label="Add layer"
          onClick={onAdd}
          className="grid size-7 place-items-center rounded-lg bg-violet-500 text-white transition-transform hover:scale-110 hover:bg-violet-600"
        >
          <Plus className="size-4" />
        </button>
      </div>

      <div className="flex max-h-72 flex-col gap-1.5 overflow-y-auto">
        {layers.map((layer, i) => (
          <div
            key={layer.id}
            role="button"
            tabIndex={0}
            aria-pressed={layer.active}
            onClick={() => onSelect(layer.id)}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelect(layer.id)}
            className={`cursor-pointer rounded-2xl border p-2 transition-colors ${
              layer.active
                ? 'border-violet-300 bg-violet-50 shadow-inner'
                : 'border-black/5 bg-white hover:border-black/15'
            }`}
          >
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                aria-label={layer.visible ? `Hide ${layer.name}` : `Show ${layer.name}`}
                onClick={(e) => {
                  e.stopPropagation()
                  onVisible(layer.id, !layer.visible)
                }}
                className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-black/5 hover:text-foreground"
              >
                {layer.visible ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
              </button>

              <span className={`flex-1 truncate text-sm ${layer.visible ? '' : 'text-muted-foreground line-through'}`}>
                {layer.name}
              </span>

              <div className="flex shrink-0 items-center">
                <button
                  type="button"
                  aria-label={`Move ${layer.name} up`}
                  disabled={i === 0}
                  onClick={(e) => {
                    e.stopPropagation()
                    onMove(layer.id, 'up')
                  }}
                  className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-black/5 hover:text-foreground disabled:pointer-events-none disabled:opacity-25"
                >
                  <ChevronUp className="size-4" />
                </button>
                <button
                  type="button"
                  aria-label={`Move ${layer.name} down`}
                  disabled={i === layers.length - 1}
                  onClick={(e) => {
                    e.stopPropagation()
                    onMove(layer.id, 'down')
                  }}
                  className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-black/5 hover:text-foreground disabled:pointer-events-none disabled:opacity-25"
                >
                  <ChevronDown className="size-4" />
                </button>
                <button
                  type="button"
                  aria-label={`Delete ${layer.name}`}
                  disabled={layers.length <= 1}
                  onClick={(e) => {
                    e.stopPropagation()
                    onDelete(layer.id)
                  }}
                  className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-rose-50 hover:text-rose-500 disabled:pointer-events-none disabled:opacity-25"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            </div>

            {layer.active && (
              <div className="mt-2 flex items-center gap-2 pl-0.5" onClick={(e) => e.stopPropagation()}>
                <span className="text-[10px] text-muted-foreground uppercase">Opacity</span>
                <Slider
                  value={[Math.round(layer.opacity * 100)]}
                  onValueChange={([v]) => onOpacity(layer.id, v / 100)}
                  min={0}
                  max={100}
                  step={1}
                />
                <span className="w-8 text-right text-[10px] tabular-nums text-muted-foreground">
                  {Math.round(layer.opacity * 100)}%
                </span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
