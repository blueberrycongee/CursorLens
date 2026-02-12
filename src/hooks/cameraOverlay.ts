export interface OverlayRect {
  x: number
  y: number
  width: number
  height: number
  cornerRadius: number
}

export type CameraOverlayShape = "rounded" | "square" | "circle"

export interface OverlayOptions {
  shape?: CameraOverlayShape
  sizePercent?: number
}

export function computeCameraOverlayRect(
  canvasWidth: number,
  canvasHeight: number,
  options: OverlayOptions = {}
): OverlayRect {
  const shape = options.shape ?? "rounded"
  const sizePercent = clamp(options.sizePercent ?? 22, 14, 40)
  const width = clamp(Math.round(canvasWidth * (sizePercent / 100)), 180, 560)
  const height = shape === "rounded" ? Math.round((width * 9) / 16) : width
  const margin = clamp(Math.round(canvasWidth * 0.015), 16, 36)
  const cornerRadius = shape === "rounded" ? clamp(Math.round(width * 0.08), 12, 26) : 0

  return {
    x: canvasWidth - width - margin,
    y: canvasHeight - height - margin,
    width,
    height,
    cornerRadius,
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}
