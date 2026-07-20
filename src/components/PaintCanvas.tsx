import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { PaintEngine, type LayerInfo, type PictureSnapshot } from '@/lib/PaintEngine'
import { BrushSounds } from '@/lib/sounds'
import type { BrushId, WiggleSettings } from '@/lib/brush-types'
import type { PaperId } from '@/lib/papers'

export interface PaintCanvasHandle {
  undo: () => void
  redo: () => void
  clear: () => void
  exportPNG: () => Promise<string>
  exportGIF: () => Promise<Blob>
  addLayer: () => void
  deleteLayer: (id: string) => void
  selectLayer: (id: string) => void
  moveLayer: (id: string, direction: 'up' | 'down') => void
  setLayerVisible: (id: string, visible: boolean) => void
  setLayerOpacity: (id: string, opacity: number) => void
}

interface PaintCanvasProps {
  brush: BrushId
  color: string
  size: number
  wiggle: WiggleSettings
  wetWiggle: boolean
  loopTime: number
  sound: boolean
  paper: PaperId
  width: number
  height: number
  /** Display-only scale: shrinks the element (not the engine) so the fixed-size drawing
   * surface fits the window if it's resized smaller after mount. Pointer coords are
   * unaffected — they already map through the live bounding rect. */
  displayScale?: number
  onHistoryChange: (canUndo: boolean, canRedo: boolean) => void
  onLayersChange: (layers: LayerInfo[]) => void
}

export const PaintCanvas = forwardRef<PaintCanvasHandle, PaintCanvasProps>(function PaintCanvas(
  { brush, color, size, wiggle, wetWiggle, loopTime, sound, paper, width, height, displayScale = 1, onHistoryChange, onLayersChange },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<PaintEngine | null>(null)
  const drawingRef = useRef(false)
  const enginePromiseRef = useRef<Promise<PaintEngine> | null>(null)
  const destroyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** The DOM node the current engine (promise) was created on. A resize remounts the <canvas>
   * (size-keyed element), so a changed node means "recreate"; the same node means a StrictMode
   * remount and the engine is reused. */
  const engineCanvasRef = useRef<HTMLCanvasElement | null>(null)
  /** The whole picture (all layers) rescued from an engine about to be destroyed by a canvas
   * resize — replayed into the replacement engine so resizing never eats the drawing. */
  const carriedSnapshotRef = useRef<PictureSnapshot | null>(null)

  /** One sound engine for the component's lifetime (it survives canvas resizes). The pointer
   * handlers live in a [width,height] effect, so they read brush/sound through refs to stay
   * current without re-binding listeners. */
  const soundsRef = useRef<BrushSounds | null>(null)
  if (!soundsRef.current) soundsRef.current = new BrushSounds()
  const brushRef = useRef(brush)
  brushRef.current = brush
  const lastMoveRef = useRef<{ x: number; y: number; t: number } | null>(null)

  useEffect(() => {
    soundsRef.current?.setEnabled(sound)
  }, [sound])

  useImperativeHandle(ref, () => ({
    undo: () => engineRef.current?.undo(),
    redo: () => engineRef.current?.redo(),
    clear: () => engineRef.current?.clear(),
    exportPNG: () => engineRef.current?.exportPNG() ?? Promise.reject(new Error('Canvas not ready yet')),
    exportGIF: () => engineRef.current?.exportGIF() ?? Promise.reject(new Error('Canvas not ready yet')),
    addLayer: () => engineRef.current?.addLayer(),
    deleteLayer: (id) => engineRef.current?.deleteLayer(id),
    selectLayer: (id) => engineRef.current?.selectLayer(id),
    moveLayer: (id, direction) => engineRef.current?.moveLayer(id, direction),
    setLayerVisible: (id, visible) => engineRef.current?.setLayerVisible(id, visible),
    setLayerOpacity: (id, opacity) => engineRef.current?.setLayerOpacity(id, opacity),
  }))

  // StrictMode mounts this effect twice synchronously (mount -> cleanup -> mount). PixiJS can't have two
  // Applications racing to init WebGL on the same <canvas>, so we share one in-flight creation promise and
  // defer destruction — an immediate remount cancels the pending destroy instead of tearing down the engine.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    if (destroyTimerRef.current !== null) {
      clearTimeout(destroyTimerRef.current)
      destroyTimerRef.current = null
    }

    // A resize remounts the size-keyed <canvas>, so a different node here means the engine
    // must be recreated. Crucially the old engine dies on its OLD canvas node — initializing
    // a fresh WebGL context on a canvas whose previous context was just destroyed hangs the
    // renderer, so the two engines must never share a node. (Same node = StrictMode remount:
    // reuse the in-flight engine as before.)
    if (enginePromiseRef.current && engineCanvasRef.current !== canvas) {
      enginePromiseRef.current.then((engine) => engine.destroy())
      enginePromiseRef.current = null
      engineRef.current = null
    }

    if (!enginePromiseRef.current) {
      enginePromiseRef.current = PaintEngine.create(canvas, width, height)
      engineCanvasRef.current = canvas
    }

    const thisPromise = enginePromiseRef.current
    thisPromise.then((engine) => {
      // Destroyed, or superseded by a resize, before it finished creating — don't configure
      // (or expose) an engine that's already retired.
      if (enginePromiseRef.current !== thisPromise) return
      engineRef.current = engine
      engine.setBrush(brush)
      engine.setColor(color)
      engine.setSize(size)
      engine.setWiggle(wiggle)
      engine.setWetWiggle(wetWiggle)
      engine.setLoopTime(loopTime)
      engine.setPaper(paper)
      engine.setHistoryListener(onHistoryChange)
      engine.setLayersListener(onLayersChange)
      if (carriedSnapshotRef.current) {
        engine.loadSnapshot(carriedSnapshotRef.current)
        carriedSnapshotRef.current = null
      }
    })

    return () => {
      // Rescue the whole picture before the (possible) teardown — if this cleanup is a resize,
      // the next effect run replays these layers into the fresh engine.
      const snapshot = engineRef.current?.getSnapshot()
      if (snapshot?.layers.some((l) => l.strokes.length > 0)) carriedSnapshotRef.current = snapshot
      destroyTimerRef.current = setTimeout(() => {
        enginePromiseRef.current?.then((engine) => engine.destroy())
        enginePromiseRef.current = null
        engineRef.current = null
        destroyTimerRef.current = null
      }, 0)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height])

  useEffect(() => {
    engineRef.current?.setBrush(brush)
  }, [brush])

  useEffect(() => {
    engineRef.current?.setColor(color)
  }, [color])

  const sizePreviewArmedRef = useRef(false)
  useEffect(() => {
    engineRef.current?.setSize(size)
    // Skip the mount-time run — the centered true-size ghost should only flash when the user
    // actually changes the size.
    if (!sizePreviewArmedRef.current) {
      sizePreviewArmedRef.current = true
      return
    }
    engineRef.current?.previewSize()
  }, [size])

  useEffect(() => {
    engineRef.current?.setWiggle(wiggle)
  }, [wiggle])

  useEffect(() => {
    engineRef.current?.setWetWiggle(wetWiggle)
  }, [wetWiggle])

  useEffect(() => {
    engineRef.current?.setLoopTime(loopTime)
  }, [loopTime])

  useEffect(() => {
    engineRef.current?.setPaper(paper)
  }, [paper])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const toLocal = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      return {
        x: ((e.clientX - rect.left) / rect.width) * width,
        y: ((e.clientY - rect.top) / rect.height) * height,
        pressure: e.pressure > 0 ? e.pressure : 0.5,
      }
    }

    const handleDown = (e: PointerEvent) => {
      // A second pointer mid-stroke (palm touch, second finger) must not restart the stroke —
      // that would discard the in-progress points and clear the wet silhouette.
      if (drawingRef.current) return
      // Capture keeps the stroke alive when the pointer leaves the canvas mid-drag. It can
      // throw (pointer already released, or a synthetic event) — drawing shouldn't die with it.
      try {
        canvas.setPointerCapture(e.pointerId)
      } catch {
        /* stroke still works without capture */
      }
      drawingRef.current = true
      const { x, y, pressure } = toLocal(e)
      engineRef.current?.pointerDown(x, y, pressure)
      soundsRef.current?.start(brushRef.current)
      lastMoveRef.current = { x: e.clientX, y: e.clientY, t: e.timeStamp }
    }
    const handleMove = (e: PointerEvent) => {
      const { x, y, pressure } = toLocal(e)
      if (drawingRef.current) {
        engineRef.current?.pointerMove(x, y, pressure)
        const last = lastMoveRef.current
        if (last) {
          const dt = Math.max(1, e.timeStamp - last.t)
          const speed = Math.hypot(e.clientX - last.x, e.clientY - last.y) / dt
          soundsRef.current?.move(speed)
        }
        lastMoveRef.current = { x: e.clientX, y: e.clientY, t: e.timeStamp }
      } else if (e.pointerType !== 'touch') {
        // Hovering (mouse/pen in the air): show the brush ghost. Touch has no hover.
        engineRef.current?.pointerHover(x, y)
      }
    }
    const handleLeave = () => {
      engineRef.current?.pointerLeave()
    }
    const handleUp = (e: PointerEvent) => {
      if (!drawingRef.current) return
      drawingRef.current = false
      try {
        canvas.releasePointerCapture(e.pointerId)
      } catch {
        /* capture may never have been taken */
      }
      engineRef.current?.pointerUp()
      soundsRef.current?.stop()
    }

    canvas.addEventListener('pointerdown', handleDown)
    canvas.addEventListener('pointermove', handleMove)
    canvas.addEventListener('pointerup', handleUp)
    canvas.addEventListener('pointercancel', handleUp)
    canvas.addEventListener('pointerleave', handleLeave)

    return () => {
      canvas.removeEventListener('pointerdown', handleDown)
      canvas.removeEventListener('pointermove', handleMove)
      canvas.removeEventListener('pointerup', handleUp)
      canvas.removeEventListener('pointercancel', handleUp)
      canvas.removeEventListener('pointerleave', handleLeave)
    }
  }, [width, height])

  return (
    <canvas
      // Size-keyed: a resize swaps in a brand-new canvas node instead of reusing one whose
      // WebGL context is being torn down (see the engine-recreation comment above).
      key={`${width}x${height}`}
      ref={canvasRef}
      className="cursor-none touch-none rounded-2xl border border-black/5 shadow-[0_16px_48px_-16px_rgba(90,70,120,0.35)]"
      // Scale via transform, NOT style.width/height: Pixi's autoDensity owns the canvas CSS
      // width/height (it pins them to the engine size) and would clobber an inline width, so a
      // shrunk-window display never took effect and the canvas overflowed. transform is
      // orthogonal to that, and getBoundingClientRect reports the transformed box, so pointer
      // mapping stays correct. The wrapper is sized to width*displayScale, so anchoring the
      // scale at top-left makes the visual canvas fill the wrapper exactly.
      style={{ transform: `scale(${displayScale})`, transformOrigin: 'top left' }}
    />
  )
})
