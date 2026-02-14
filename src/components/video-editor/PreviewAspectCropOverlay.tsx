import type React from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { CropRegion } from './types'
import { normalizeAspectCropRegion } from '@/lib/crop/aspectCrop'

interface PreviewAspectCropOverlayProps {
  cropRegion: CropRegion
  onCropChange: (next: CropRegion) => void
  sourceAspectRatio: number
  targetAspectRatio: number
  positionHint: string
}

type DragState =
  | {
      mode: 'move'
      pointerId: number
      offsetX: number
      offsetY: number
      width: number
      height: number
    }
  | {
      mode: 'resize-br'
      pointerId: number
      anchorX: number
      anchorY: number
    }
  | null

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

type PixelRect = { x: number; y: number; width: number; height: number }

function resolveContentRect(bounds: PixelRect, sourceAspectRatio: number): PixelRect {
  if (bounds.width <= 0 || bounds.height <= 0) return { x: 0, y: 0, width: 0, height: 0 }
  const safeSourceAspect = Number.isFinite(sourceAspectRatio) && sourceAspectRatio > 0 ? sourceAspectRatio : 16 / 9
  const containerAspect = bounds.width / bounds.height

  if (containerAspect > safeSourceAspect) {
    const height = bounds.height
    const width = height * safeSourceAspect
    return {
      x: (bounds.width - width) / 2,
      y: 0,
      width,
      height,
    }
  }

  const width = bounds.width
  const height = width / safeSourceAspect
  return {
    x: 0,
    y: (bounds.height - height) / 2,
    width,
    height,
  }
}

export function PreviewAspectCropOverlay({
  cropRegion,
  onCropChange,
  sourceAspectRatio,
  targetAspectRatio,
  positionHint,
}: PreviewAspectCropOverlayProps) {
  const overlayRef = useRef<HTMLDivElement | null>(null)
  const [dragState, setDragState] = useState<DragState>(null)
  const [overlaySize, setOverlaySize] = useState({ width: 0, height: 0 })

  useEffect(() => {
    const element = overlayRef.current
    if (!element) return

    const updateSize = () => {
      setOverlaySize({ width: element.clientWidth, height: element.clientHeight })
    }

    updateSize()
    if (typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver(updateSize)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const containerRect = useMemo<PixelRect>(() => ({
    x: 0,
    y: 0,
    width: overlaySize.width,
    height: overlaySize.height,
  }), [overlaySize.height, overlaySize.width])

  const contentRect = useMemo(
    () => resolveContentRect(containerRect, sourceAspectRatio),
    [containerRect, sourceAspectRatio],
  )

  const frameRect = useMemo(() => ({
    left: contentRect.x + cropRegion.x * contentRect.width,
    top: contentRect.y + cropRegion.y * contentRect.height,
    width: cropRegion.width * contentRect.width,
    height: cropRegion.height * contentRect.height,
  }), [contentRect.height, contentRect.width, contentRect.x, contentRect.y, cropRegion.height, cropRegion.width, cropRegion.x, cropRegion.y])

  const pointToNormalized = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = overlayRef.current?.getBoundingClientRect()
    if (!rect || contentRect.width <= 0 || contentRect.height <= 0) return null

    const localX = event.clientX - rect.left
    const localY = event.clientY - rect.top

    const normalizedX = clamp((localX - contentRect.x) / contentRect.width, 0, 1)
    const normalizedY = clamp((localY - contentRect.y) / contentRect.height, 0, 1)
    return { x: normalizedX, y: normalizedY }
  }

  const handleMoveStart = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const point = pointToNormalized(event)
    if (!point) return

    setDragState({
      mode: 'move',
      pointerId: event.pointerId,
      offsetX: point.x - cropRegion.x,
      offsetY: point.y - cropRegion.y,
      width: cropRegion.width,
      height: cropRegion.height,
    })
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handleResizeStart = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    setDragState({
      mode: 'resize-br',
      pointerId: event.pointerId,
      anchorX: cropRegion.x,
      anchorY: cropRegion.y,
    })
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragState || dragState.pointerId !== event.pointerId) return
    const point = pointToNormalized(event)
    if (!point) return

    const safeTargetAspect = Number.isFinite(targetAspectRatio) && targetAspectRatio > 0 ? targetAspectRatio : 16 / 9
    const safeSourceAspect = Number.isFinite(sourceAspectRatio) && sourceAspectRatio > 0 ? sourceAspectRatio : 16 / 9

    if (dragState.mode === 'move') {
      const nextX = clamp(point.x - dragState.offsetX, 0, 1 - dragState.width)
      const nextY = clamp(point.y - dragState.offsetY, 0, 1 - dragState.height)
      onCropChange({
        x: nextX,
        y: nextY,
        width: dragState.width,
        height: dragState.height,
      })
      return
    }

    const candidateWidthByX = point.x - dragState.anchorX
    const candidateWidthByY = (point.y - dragState.anchorY) * safeTargetAspect / safeSourceAspect
    const maxWidthByX = 1 - dragState.anchorX
    const maxWidthByY = (1 - dragState.anchorY) * safeTargetAspect / safeSourceAspect
    const maxWidth = Math.max(0.06, Math.min(maxWidthByX, maxWidthByY))
    const nextWidth = clamp(Math.max(candidateWidthByX, candidateWidthByY), 0.06, maxWidth)
    const nextHeight = nextWidth * safeSourceAspect / safeTargetAspect

    onCropChange(
      normalizeAspectCropRegion(
        {
          x: dragState.anchorX,
          y: dragState.anchorY,
          width: nextWidth,
          height: nextHeight,
        },
        safeSourceAspect,
        safeTargetAspect,
      ),
    )
  }

  const handlePointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragState || dragState.pointerId !== event.pointerId) return
    setDragState(null)
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      // no-op
    }
  }

  if (contentRect.width <= 0 || contentRect.height <= 0) {
    return null
  }

  return (
    <div
      ref={overlayRef}
      className="absolute inset-0 z-40 touch-none"
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onPointerLeave={handlePointerEnd}
    >
      <div
        className="absolute bg-black/45 pointer-events-none"
        style={{
          left: contentRect.x,
          top: contentRect.y,
          width: contentRect.width,
          height: Math.max(0, frameRect.top - contentRect.y),
        }}
      />
      <div
        className="absolute bg-black/45 pointer-events-none"
        style={{
          left: contentRect.x,
          top: frameRect.top + frameRect.height,
          width: contentRect.width,
          height: Math.max(0, contentRect.y + contentRect.height - (frameRect.top + frameRect.height)),
        }}
      />
      <div
        className="absolute bg-black/45 pointer-events-none"
        style={{
          left: contentRect.x,
          top: frameRect.top,
          width: Math.max(0, frameRect.left - contentRect.x),
          height: frameRect.height,
        }}
      />
      <div
        className="absolute bg-black/45 pointer-events-none"
        style={{
          left: frameRect.left + frameRect.width,
          top: frameRect.top,
          width: Math.max(0, contentRect.x + contentRect.width - (frameRect.left + frameRect.width)),
          height: frameRect.height,
        }}
      />

      <div
        className="absolute border-2 border-[#34B27B] rounded-sm cursor-move shadow-[0_0_0_1px_rgba(52,178,123,0.35)]"
        style={{
          left: frameRect.left,
          top: frameRect.top,
          width: frameRect.width,
          height: frameRect.height,
        }}
        onPointerDown={handleMoveStart}
      >
        <div className="absolute -top-6 left-0 rounded bg-black/75 px-2 py-0.5 text-[10px] text-slate-200 pointer-events-none">
          {positionHint}
        </div>
        <div
          className="absolute -right-2 -bottom-2 h-4 w-4 rounded border border-white/80 bg-[#34B27B] cursor-se-resize"
          onPointerDown={handleResizeStart}
          title="Resize"
        />
      </div>
    </div>
  )
}
