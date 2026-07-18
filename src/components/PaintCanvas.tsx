import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { PaintEngine } from '@/lib/PaintEngine'
import type { BrushId, WiggleSettings } from '@/lib/brush-types'
import type { PaperId } from '@/lib/papers'

export interface PaintCanvasHandle {
  undo: () => void
  redo: () => void
  clear: () => void
  exportPNG: () => Promise<string>
}

interface PaintCanvasProps {
  brush: BrushId
  color: string
  size: number
  wiggle: WiggleSettings
  paper: PaperId
  width: number
  height: number
  onHistoryChange: (canUndo: boolean, canRedo: boolean) => void
}

export const PaintCanvas = forwardRef<PaintCanvasHandle, PaintCanvasProps>(function PaintCanvas(
  { brush, color, size, wiggle, paper, width, height, onHistoryChange },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<PaintEngine | null>(null)
  const drawingRef = useRef(false)
  const enginePromiseRef = useRef<Promise<PaintEngine> | null>(null)
  const destroyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useImperativeHandle(ref, () => ({
    undo: () => engineRef.current?.undo(),
    redo: () => engineRef.current?.redo(),
    clear: () => engineRef.current?.clear(),
    exportPNG: () => engineRef.current?.exportPNG() ?? Promise.reject(new Error('Canvas not ready yet')),
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

    if (!enginePromiseRef.current) {
      enginePromiseRef.current = PaintEngine.create(canvas, width, height)
    }

    enginePromiseRef.current.then((engine) => {
      if (enginePromiseRef.current === null) return // destroyed before it finished creating
      engineRef.current = engine
      engine.setBrush(brush)
      engine.setColor(color)
      engine.setSize(size)
      engine.setWiggle(wiggle)
      engine.setPaper(paper)
      engine.setHistoryListener(onHistoryChange)
      if (import.meta.env.DEV) (window as unknown as { __engine?: PaintEngine }).__engine = engine
    })

    return () => {
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

  useEffect(() => {
    engineRef.current?.setSize(size)
  }, [size])

  useEffect(() => {
    engineRef.current?.setWiggle(wiggle)
  }, [wiggle])

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
      canvas.setPointerCapture(e.pointerId)
      drawingRef.current = true
      const { x, y, pressure } = toLocal(e)
      engineRef.current?.pointerDown(x, y, pressure)
    }
    const handleMove = (e: PointerEvent) => {
      if (!drawingRef.current) return
      const { x, y, pressure } = toLocal(e)
      engineRef.current?.pointerMove(x, y, pressure)
    }
    const handleUp = (e: PointerEvent) => {
      if (!drawingRef.current) return
      drawingRef.current = false
      canvas.releasePointerCapture(e.pointerId)
      engineRef.current?.pointerUp()
    }

    canvas.addEventListener('pointerdown', handleDown)
    canvas.addEventListener('pointermove', handleMove)
    canvas.addEventListener('pointerup', handleUp)
    canvas.addEventListener('pointercancel', handleUp)

    return () => {
      canvas.removeEventListener('pointerdown', handleDown)
      canvas.removeEventListener('pointermove', handleMove)
      canvas.removeEventListener('pointerup', handleUp)
      canvas.removeEventListener('pointercancel', handleUp)
    }
  }, [width, height])

  return (
    <canvas
      ref={canvasRef}
      className="touch-none rounded-lg border border-border shadow-sm"
      style={{ width, height }}
    />
  )
})
