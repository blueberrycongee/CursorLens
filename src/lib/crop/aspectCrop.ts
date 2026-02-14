import type { CropRegion } from '@/components/video-editor/types'

const MIN_SIZE = 0.06

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function sanitizeAspect(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function sanitizeCropRegion(region: CropRegion): CropRegion {
  const width = clamp(Number.isFinite(region.width) ? region.width : 1, MIN_SIZE, 1)
  const height = clamp(Number.isFinite(region.height) ? region.height : 1, MIN_SIZE, 1)
  const x = clamp(Number.isFinite(region.x) ? region.x : 0, 0, 1 - width)
  const y = clamp(Number.isFinite(region.y) ? region.y : 0, 0, 1 - height)
  return { x, y, width, height }
}

export function getCenteredAspectCropRegion(sourceAspectInput: number, targetAspectInput: number): CropRegion {
  const sourceAspect = sanitizeAspect(sourceAspectInput, 16 / 9)
  const targetAspect = sanitizeAspect(targetAspectInput, sourceAspect)

  // ratio = (widthNorm * sourceAspect) / heightNorm
  let width = 1
  let height = sourceAspect / targetAspect

  if (height > 1) {
    height = 1
    width = targetAspect / sourceAspect
  }

  width = clamp(width, MIN_SIZE, 1)
  height = clamp(height, MIN_SIZE, 1)

  return {
    x: (1 - width) / 2,
    y: (1 - height) / 2,
    width,
    height,
  }
}

export function normalizeAspectCropRegion(
  input: CropRegion,
  sourceAspectInput: number,
  targetAspectInput: number,
): CropRegion {
  const sourceAspect = sanitizeAspect(sourceAspectInput, 16 / 9)
  const targetAspect = sanitizeAspect(targetAspectInput, sourceAspect)
  const region = sanitizeCropRegion(input)

  const centerX = region.x + region.width / 2
  const centerY = region.y + region.height / 2

  const maxWidthFromCenter = 2 * Math.min(centerX, 1 - centerX)
  const maxHeightFromCenter = 2 * Math.min(centerY, 1 - centerY)
  const maxWidthFromHeight = maxHeightFromCenter * targetAspect / sourceAspect
  const maxAllowedWidth = clamp(Math.min(maxWidthFromCenter, maxWidthFromHeight), MIN_SIZE, 1)

  const requestedWidthFromInput = Math.max(region.width, region.height * targetAspect / sourceAspect)
  const width = clamp(requestedWidthFromInput, MIN_SIZE, maxAllowedWidth)
  const height = clamp(width * sourceAspect / targetAspect, MIN_SIZE, 1)

  const nextX = clamp(centerX - width / 2, 0, 1 - width)
  const nextY = clamp(centerY - height / 2, 0, 1 - height)

  return {
    x: nextX,
    y: nextY,
    width,
    height,
  }
}

export function cropRegionEquals(a: CropRegion, b: CropRegion, epsilon = 1e-4): boolean {
  return (
    Math.abs(a.x - b.x) <= epsilon
    && Math.abs(a.y - b.y) <= epsilon
    && Math.abs(a.width - b.width) <= epsilon
    && Math.abs(a.height - b.height) <= epsilon
  )
}

