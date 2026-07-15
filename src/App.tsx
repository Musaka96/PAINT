import { useRef, useState } from 'react'
import { PaintCanvas, type PaintCanvasHandle } from '@/components/PaintCanvas'
import { Toolbar } from '@/components/Toolbar'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { BrushId } from '@/lib/brush-types'

const CANVAS_WIDTH = 900
const CANVAS_HEIGHT = 600

function App() {
  const canvasHandleRef = useRef<PaintCanvasHandle>(null)
  const [brush, setBrush] = useState<BrushId>('watercolor')
  const [color, setColor] = useState('#1e1e2e')
  const [size, setSize] = useState(18)
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)

  const handleExport = async () => {
    const dataUrl = await canvasHandleRef.current?.exportPNG()
    if (!dataUrl) return
    const link = document.createElement('a')
    link.href = dataUrl
    link.download = 'paint.png'
    link.click()
  }

  return (
    <TooltipProvider>
      <div className="flex min-h-svh flex-col items-center gap-6 bg-muted/40 px-4 py-8">
        <h1 className="text-2xl font-semibold tracking-tight">Wiggly Paint</h1>

        <Toolbar
          brush={brush}
          onBrushChange={setBrush}
          color={color}
          onColorChange={setColor}
          size={size}
          onSizeChange={setSize}
          canUndo={canUndo}
          canRedo={canRedo}
          onUndo={() => canvasHandleRef.current?.undo()}
          onRedo={() => canvasHandleRef.current?.redo()}
          onClear={() => canvasHandleRef.current?.clear()}
          onExport={handleExport}
        />

        <PaintCanvas
          ref={canvasHandleRef}
          brush={brush}
          color={color}
          size={size}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          onHistoryChange={(undo, redo) => {
            setCanUndo(undo)
            setCanRedo(redo)
          }}
        />
      </div>
    </TooltipProvider>
  )
}

export default App
