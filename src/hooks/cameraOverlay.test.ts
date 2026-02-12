import { describe, expect, it } from 'vitest'
import { computeCameraOverlayRect } from './cameraOverlay'

describe('computeCameraOverlayRect', () => {
  it('positions overlay in bottom-right with stable bounds', () => {
    const rect = computeCameraOverlayRect(1920, 1080)
    expect(rect.width).toBeGreaterThanOrEqual(180)
    expect(rect.width).toBeLessThanOrEqual(560)
    expect(rect.height).toBe(Math.round((rect.width * 9) / 16))
    expect(rect.x + rect.width).toBeLessThanOrEqual(1920)
    expect(rect.y + rect.height).toBeLessThanOrEqual(1080)
    expect(rect.cornerRadius).toBeGreaterThanOrEqual(12)
  })

  it('supports square and circle overlays with 1:1 ratio', () => {
    const square = computeCameraOverlayRect(1920, 1080, { shape: 'square', sizePercent: 26 })
    const circle = computeCameraOverlayRect(1920, 1080, { shape: 'circle', sizePercent: 26 })
    expect(square.width).toBe(square.height)
    expect(square.cornerRadius).toBe(0)
    expect(circle.width).toBe(circle.height)
    expect(circle.cornerRadius).toBe(0)
  })

  it('clamps overlay size percent to valid range', () => {
    const tooSmall = computeCameraOverlayRect(1920, 1080, { sizePercent: 1 })
    const tooLarge = computeCameraOverlayRect(1920, 1080, { sizePercent: 99 })
    expect(tooSmall.width).toBe(269)
    expect(tooLarge.width).toBe(560)
  })
})
