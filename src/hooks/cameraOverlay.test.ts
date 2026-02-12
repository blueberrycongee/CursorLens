import { describe, expect, it } from 'vitest'
import { computeCameraOverlayRect } from './cameraOverlay'

describe('computeCameraOverlayRect', () => {
  it('positions overlay in bottom-right with stable bounds', () => {
    const rect = computeCameraOverlayRect(1920, 1080)
    expect(rect.width).toBeGreaterThanOrEqual(220)
    expect(rect.width).toBeLessThanOrEqual(420)
    expect(rect.height).toBe(Math.round((rect.width * 9) / 16))
    expect(rect.x + rect.width).toBeLessThanOrEqual(1920)
    expect(rect.y + rect.height).toBeLessThanOrEqual(1080)
    expect(rect.cornerRadius).toBeGreaterThanOrEqual(12)
  })

  it('keeps minimum readable size on small captures', () => {
    const rect = computeCameraOverlayRect(854, 480)
    expect(rect.width).toBe(220)
    expect(rect.height).toBe(Math.round((220 * 9) / 16))
    expect(rect.x).toBeGreaterThanOrEqual(0)
    expect(rect.y).toBeGreaterThanOrEqual(0)
  })
})
