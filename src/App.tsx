import { useEffect, useRef, useState } from 'react'
import { PaintCanvas, type PaintCanvasHandle } from '@/components/PaintCanvas'
import { Toolbar } from '@/components/Toolbar'
import { TooltipProvider } from '@/components/ui/tooltip'
import { DEFAULT_WIGGLE, type BrushId, type WiggleSettings } from '@/lib/brush-types'
import { DEFAULT_PAPER, type PaperId } from '@/lib/papers'

/** Horizontal room reserved for the floating sidebar (its width + breathing space). */
const SIDEBAR_SPACE = 92

function App() {
  const canvasHandleRef = useRef<PaintCanvasHandle>(null)
  // The engine's textures are allocated at this size, and changing it recreates the engine —
  // which destroys the drawing. So: while the canvas is still blank, follow window resizes at
  // full size (recreating costs nothing); once anything is drawn, the size freezes and the
  // canvas only CSS-scales down to fit (pointer coords map through the live bounding rect).
  const [canvasSize, setCanvasSize] = useState(() => ({
    width: Math.max(480, window.innerWidth - SIDEBAR_SPACE - 32),
    height: Math.max(360, window.innerHeight - 32),
  }))
  const [displayScale, setDisplayScale] = useState(1)
  const [brush, setBrush] = useState<BrushId>('wetround')
  const [color, setColor] = useState('#1e1e2e')
  const [size, setSize] = useState(18)
  const [wiggle, setWiggle] = useState<WiggleSettings>(DEFAULT_WIGGLE)
  const [wetWiggle, setWetWiggle] = useState(false)
  const [paper, setPaper] = useState<PaperId>(DEFAULT_PAPER)
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)

  const isBlank = !canUndo && !canRedo

  useEffect(() => {
    const compute = () => {
      const availWidth = Math.max(480, window.innerWidth - SIDEBAR_SPACE - 32)
      const availHeight = Math.max(360, window.innerHeight - 32)
      if (isBlank && (availWidth !== canvasSize.width || availHeight !== canvasSize.height)) {
        setCanvasSize({ width: availWidth, height: availHeight })
        setDisplayScale(1)
        return
      }
      // Drawing in progress: never touch the engine, just shrink the display to fit.
      setDisplayScale(Math.min(1, availWidth / canvasSize.width, availHeight / canvasSize.height))
    }
    compute()
    window.addEventListener('resize', compute)
    return () => window.removeEventListener('resize', compute)
  }, [canvasSize, isBlank])

  const handleWiggleChange = (settings: Partial<WiggleSettings>) => {
    setWiggle((prev) => ({ ...prev, ...settings }))
  }

  const handleExport = async () => {
    const dataUrl = await canvasHandleRef.current?.exportPNG()
    if (!dataUrl) return
    const link = document.createElement('a')
    link.href = dataUrl
    link.download = 'paint.png'
    link.click()
  }

  const [exportingGif, setExportingGif] = useState(false)
  const handleExportGif = async () => {
    if (exportingGif) return
    setExportingGif(true)
    try {
      const blob = await canvasHandleRef.current?.exportGIF()
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'paint.gif'
      link.click()
      URL.revokeObjectURL(url)
    } finally {
      setExportingGif(false)
    }
  }

  return (
    <TooltipProvider>
      <div
        className="fixed inset-0 overflow-hidden"
        style={{ background: 'linear-gradient(135deg, #f6f0e8 0%, #efe8f2 55%, #e7eef1 100%)' }}
      >
        <main
          className="absolute inset-y-4 left-4 flex items-center justify-center"
          style={{ right: SIDEBAR_SPACE }}
        >
          <PaintCanvas
            ref={canvasHandleRef}
            brush={brush}
            color={color}
            size={size}
            wiggle={wiggle}
            wetWiggle={wetWiggle}
            paper={paper}
            width={canvasSize.width}
            height={canvasSize.height}
            displayScale={displayScale}
            onHistoryChange={(undo, redo) => {
              setCanUndo(undo)
              setCanRedo(redo)
            }}
          />
        </main>

        <h1
          className="pointer-events-none fixed top-4 left-6 z-10 -rotate-2 rounded-full bg-white/70 px-4 py-0.5 text-2xl text-violet-500 shadow-sm backdrop-blur-sm select-none"
          style={{ fontFamily: "'Caveat', cursive" }}
        >
          Wiggly Paint
        </h1>

        <Toolbar
          brush={brush}
          onBrushChange={setBrush}
          color={color}
          onColorChange={setColor}
          size={size}
          onSizeChange={setSize}
          wiggle={wiggle}
          onWiggleChange={handleWiggleChange}
          wetWiggle={wetWiggle}
          onWetWiggleChange={setWetWiggle}
          paper={paper}
          onPaperChange={setPaper}
          canUndo={canUndo}
          canRedo={canRedo}
          onUndo={() => canvasHandleRef.current?.undo()}
          onRedo={() => canvasHandleRef.current?.redo()}
          onClear={() => canvasHandleRef.current?.clear()}
          onExport={handleExport}
          onExportGif={handleExportGif}
          exportingGif={exportingGif}
        />
      </div>
    </TooltipProvider>
  )
}

export default App
