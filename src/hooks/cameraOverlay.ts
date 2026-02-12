export interface OverlayRect {
  x: number
  y: number
  width: number
  height: number
  cornerRadius: number
}

export function computeCameraOverlayRect(canvasWidth: number, canvasHeight: number): OverlayRect {
  const width = clamp(Math.round(canvasWidth * 0.22), 220, 420)
  const height = Math.round((width * 9) / 16)
  const margin = clamp(Math.round(canvasWidth * 0.015), 16, 36)

  return {
    x: canvasWidth - width - margin,
    y: canvasHeight - height - margin,
    width,
    height,
    cornerRadius: clamp(Math.round(width * 0.08), 12, 26),
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}
