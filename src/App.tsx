import { useEffect, useRef, useState } from 'react'
import { PaintCanvas, type PaintCanvasHandle } from '@/components/PaintCanvas'
import { Toolbar } from '@/components/Toolbar'
import { TooltipProvider } from '@/components/ui/tooltip'
import { DEFAULT_WIGGLE, type BrushId, type WiggleSettings } from '@/lib/brush-types'
import { DEFAULT_PAPER, type PaperId } from '@/lib/papers'

/** Horizontal room reserved for the floating sidebar (its width + breathing space). */
const SIDEBAR_SPACE = 92

/** The desk wallpaper: a seamless tile of little hand-doodled ants wandering in different
 * directions, kept very faint so the artwork stays the loudest thing on screen. */
const ANT_TILE_SVG = `
<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'>
  <g fill='none' stroke='#8a7d94' stroke-opacity='0.4' stroke-width='1.3' stroke-linecap='round'>
    <g transform='translate(34,38) rotate(-24)'>
      <ellipse cx='0' cy='0' rx='4.4' ry='3.1' fill='#8a7d94' fill-opacity='0.4' stroke='none'/>
      <ellipse cx='6.6' cy='-0.8' rx='2.5' ry='2' fill='#8a7d94' fill-opacity='0.4' stroke='none'/>
      <circle cx='11.4' cy='-1.6' r='2.3' fill='#8a7d94' fill-opacity='0.4' stroke='none'/>
      <path d='M5 -2.5 L2.5 -7 M6.8 -2.6 L6.6 -7.6 M8.4 -2.4 L10.8 -6.8'/>
      <path d='M5 1 L2.6 5.4 M6.8 1 L6.8 5.8 M8.4 0.8 L11 5'/>
      <path d='M12.6 -3.4 Q14 -6 16 -6.6 M13.4 -2.2 Q15.6 -3 17.2 -2.4'/>
    </g>
    <g transform='translate(118,110) rotate(142)'>
      <ellipse cx='0' cy='0' rx='4.4' ry='3.1' fill='#8a7d94' fill-opacity='0.4' stroke='none'/>
      <ellipse cx='6.6' cy='-0.8' rx='2.5' ry='2' fill='#8a7d94' fill-opacity='0.4' stroke='none'/>
      <circle cx='11.4' cy='-1.6' r='2.3' fill='#8a7d94' fill-opacity='0.4' stroke='none'/>
      <path d='M5 -2.5 L2.5 -7 M6.8 -2.6 L6.6 -7.6 M8.4 -2.4 L10.8 -6.8'/>
      <path d='M5 1 L2.6 5.4 M6.8 1 L6.8 5.8 M8.4 0.8 L11 5'/>
      <path d='M12.6 -3.4 Q14 -6 16 -6.6 M13.4 -2.2 Q15.6 -3 17.2 -2.4'/>
    </g>
    <g transform='translate(120,32) rotate(65)'>
      <ellipse cx='0' cy='0' rx='4.4' ry='3.1' fill='#8a7d94' fill-opacity='0.3' stroke='none'/>
      <ellipse cx='6.6' cy='-0.8' rx='2.5' ry='2' fill='#8a7d94' fill-opacity='0.3' stroke='none'/>
      <circle cx='11.4' cy='-1.6' r='2.3' fill='#8a7d94' fill-opacity='0.3' stroke='none'/>
      <path d='M5 -2.5 L2.5 -7 M6.8 -2.6 L6.6 -7.6 M8.4 -2.4 L10.8 -6.8' stroke-opacity='0.3'/>
      <path d='M5 1 L2.6 5.4 M6.8 1 L6.8 5.8 M8.4 0.8 L11 5' stroke-opacity='0.3'/>
      <path d='M12.6 -3.4 Q14 -6 16 -6.6 M13.4 -2.2 Q15.6 -3 17.2 -2.4' stroke-opacity='0.3'/>
    </g>
    <g transform='translate(40,124) rotate(-105)'>
      <ellipse cx='0' cy='0' rx='4.4' ry='3.1' fill='#8a7d94' fill-opacity='0.3' stroke='none'/>
      <ellipse cx='6.6' cy='-0.8' rx='2.5' ry='2' fill='#8a7d94' fill-opacity='0.3' stroke='none'/>
      <circle cx='11.4' cy='-1.6' r='2.3' fill='#8a7d94' fill-opacity='0.3' stroke='none'/>
      <path d='M5 -2.5 L2.5 -7 M6.8 -2.6 L6.6 -7.6 M8.4 -2.4 L10.8 -6.8' stroke-opacity='0.3'/>
      <path d='M5 1 L2.6 5.4 M6.8 1 L6.8 5.8 M8.4 0.8 L11 5' stroke-opacity='0.3'/>
      <path d='M12.6 -3.4 Q14 -6 16 -6.6 M13.4 -2.2 Q15.6 -3 17.2 -2.4' stroke-opacity='0.3'/>
    </g>
  </g>
</svg>`

const ANT_TILE_URL = `url("data:image/svg+xml,${encodeURIComponent(ANT_TILE_SVG)}")`

/** localStorage THROWS in sandboxed iframes (itch.io embeds, strict-privacy browsers) — a
 * blocked preference must degrade to the default, never crash the first render. */
function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* preference just won't persist */
  }
}

function App() {
  const canvasHandleRef = useRef<PaintCanvasHandle>(null)
  // The engine's textures are allocated at this size, and changing it recreates the engine —
  // which destroys the drawing. So: while the canvas is still blank, follow window resizes at
  // full size (recreating costs nothing); once anything is drawn, the size freezes and the
  // canvas only CSS-scales down to fit (pointer coords map through the live bounding rect).
  const [canvasSize, setCanvasSize] = useState(() => ({
    width: Math.max(480, window.innerWidth - SIDEBAR_SPACE - 32 - 72),
    height: Math.max(360, window.innerHeight - 32 - 72),
  }))
  const [displayScale, setDisplayScale] = useState(1)
  /** Dashed outline shown while dragging a resize handle; committed on release. */
  const [resizeGhost, setResizeGhost] = useState<{ width: number; height: number } | null>(null)
  /** Once the user has sized the canvas by hand, the window stops dictating its size. */
  const userSizedRef = useRef(false)
  const [brush, setBrush] = useState<BrushId>('wetround')
  const [color, setColor] = useState('#1e1e2e')
  const [size, setSize] = useState(18)
  const [wiggle, setWiggle] = useState<WiggleSettings>(DEFAULT_WIGGLE)
  const [wetWiggle, setWetWiggle] = useState(false)
  const [loopTime, setLoopTime] = useState(1)
  const [sound, setSound] = useState(() => readStorage('ants-sound') !== 'off')

  useEffect(() => {
    writeStorage('ants-sound', sound ? 'on' : 'off')
  }, [sound])
  const [paper, setPaper] = useState<PaperId>(DEFAULT_PAPER)
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)

  const isBlank = !canUndo && !canRedo

  useEffect(() => {
    const compute = () => {
      // True room available to the canvas (main is left:16, right:SIDEBAR_SPACE) — no floor,
      // so a genuinely small window scales the DISPLAY down below the engine's minimum size.
      const trueWidth = window.innerWidth - SIDEBAR_SPACE - 32
      const trueHeight = window.innerHeight - 32
      // Engine size is floored at a minimum drawable resolution; the display can go smaller.
      const availWidth = Math.max(480, trueWidth)
      const availHeight = Math.max(360, trueHeight)

      let targetWidth = canvasSize.width
      let targetHeight = canvasSize.height
      if (isBlank && !userSizedRef.current) {
        // The canvas is a sheet on the ant-doodle desk, not wall-to-wall glass — keep a fixed
        // ~72px ring of wallpaper visible around it (a percentage over-shrinks on big screens).
        targetWidth = Math.max(480, availWidth - 72)
        targetHeight = Math.max(360, availHeight - 72)
        if (targetWidth !== canvasSize.width || targetHeight !== canvasSize.height) {
          setCanvasSize({ width: targetWidth, height: targetHeight })
        }
      }
      // Scale the DISPLAY against the true room (not the floored size), so the canvas never
      // spills past the window even when the window is smaller than the engine minimum.
      setDisplayScale(Math.min(1, trueWidth / targetWidth, trueHeight / targetHeight))
    }
    compute()
    window.addEventListener('resize', compute)
    return () => window.removeEventListener('resize', compute)
  }, [canvasSize, isBlank])

  /** Edge-handle drag: ghost preview while dragging, one engine recreation on release (the
   * strokes are carried over and replayed — see PaintCanvas). Deltas divide by displayScale
   * so dragging tracks the pointer even when the canvas is shown shrunken. */
  const startResize = (axis: 'x' | 'y') => (e: React.PointerEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startY = e.clientY
    const base = { ...canvasSize }
    let ghost = { width: base.width, height: base.height }
    const onMove = (ev: PointerEvent) => {
      const dx = (ev.clientX - startX) / displayScale
      const dy = (ev.clientY - startY) / displayScale
      // Clamp to the desk: the sheet can grow right up to the available room but never past
      // the window edge — what you drag is exactly what you get, no post-release rescaling.
      const maxWidth = Math.max(480, window.innerWidth - SIDEBAR_SPACE - 32)
      const maxHeight = Math.max(360, window.innerHeight - 32)
      ghost = {
        width: axis === 'x' ? Math.min(maxWidth, Math.max(320, Math.round(base.width + dx))) : base.width,
        height: axis === 'y' ? Math.min(maxHeight, Math.max(240, Math.round(base.height + dy))) : base.height,
      }
      setResizeGhost({ ...ghost })
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      setResizeGhost(null)
      if (ghost.width !== base.width || ghost.height !== base.height) {
        userSizedRef.current = true
        setCanvasSize(ghost)
      }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const handleWiggleChange = (settings: Partial<WiggleSettings>) => {
    setWiggle((prev) => ({ ...prev, ...settings }))
  }

  const handleExport = async () => {
    const dataUrl = await canvasHandleRef.current?.exportPNG()
    if (!dataUrl) return
    const link = document.createElement('a')
    link.href = dataUrl
    link.download = 'ants-paint.png'
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
      link.download = 'ants-paint.gif'
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
        style={{ backgroundColor: '#f3eee6', backgroundImage: ANT_TILE_URL, backgroundSize: '160px 160px' }}
      >
        <main
          className="absolute inset-y-4 left-4 flex items-center justify-center"
          style={{ right: SIDEBAR_SPACE }}
        >
          <div
            className="relative"
            style={{ width: canvasSize.width * displayScale, height: canvasSize.height * displayScale }}
          >
            <PaintCanvas
              ref={canvasHandleRef}
              brush={brush}
              color={color}
              size={size}
              wiggle={wiggle}
              wetWiggle={wetWiggle}
              loopTime={loopTime}
              sound={sound}
              paper={paper}
              width={canvasSize.width}
              height={canvasSize.height}
              displayScale={displayScale}
              onHistoryChange={(undo, redo) => {
                setCanUndo(undo)
                setCanRedo(redo)
              }}
            />

            <div
              role="separator"
              aria-label="Resize canvas width"
              onPointerDown={startResize('x')}
              className="absolute top-1/2 -right-2 h-14 w-3.5 -translate-y-1/2 cursor-ew-resize touch-none rounded-full border border-black/10 bg-white shadow-md transition-colors hover:bg-violet-100"
            />
            <div
              role="separator"
              aria-label="Resize canvas height"
              onPointerDown={startResize('y')}
              className="absolute -bottom-2 left-1/2 h-3.5 w-14 -translate-x-1/2 cursor-ns-resize touch-none rounded-full border border-black/10 bg-white shadow-md transition-colors hover:bg-violet-100"
            />

            {resizeGhost && (
              <>
                <div
                  className="pointer-events-none absolute top-0 left-0 rounded-2xl border-2 border-dashed border-violet-400 bg-violet-200/10"
                  style={{ width: resizeGhost.width * displayScale, height: resizeGhost.height * displayScale }}
                />
                <span className="pointer-events-none absolute top-2 left-2 rounded-full bg-white/90 px-3 py-0.5 text-xs font-medium text-violet-600 shadow">
                  {resizeGhost.width} × {resizeGhost.height}
                </span>
              </>
            )}
          </div>
        </main>

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
          loopTime={loopTime}
          onLoopTimeChange={setLoopTime}
          sound={sound}
          onSoundChange={setSound}
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
