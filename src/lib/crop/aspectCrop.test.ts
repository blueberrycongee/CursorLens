import { describe, expect, it } from 'vitest'
import { cropRegionEquals, getCenteredAspectCropRegion, normalizeAspectCropRegion } from './aspectCrop'

describe('getCenteredAspectCropRegion', () => {
  it('returns centered square for 16:9 source', () => {
    const region = getCenteredAspectCropRegion(16 / 9, 1)
    expect(region.width).toBeCloseTo(0.5625, 5)
    expect(region.height).toBeCloseTo(1, 5)
    expect(region.x).toBeCloseTo((1 - 0.5625) / 2, 5)
    expect(region.y).toBeCloseTo(0, 5)
  })

  it('returns centered 16:9 crop for portrait source', () => {
    const region = getCenteredAspectCropRegion(9 / 16, 16 / 9)
    expect(region.width).toBeCloseTo(1, 5)
    expect(region.height).toBeCloseTo(0.31640625, 5)
    expect(region.x).toBeCloseTo(0, 5)
    expect(region.y).toBeCloseTo((1 - 0.31640625) / 2, 5)
  })
})

describe('normalizeAspectCropRegion', () => {
  it('converts arbitrary crop into target aspect while keeping center', () => {
    const normalized = normalizeAspectCropRegion(
      { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
      16 / 9,
      1,
    )
    expect(normalized.width).toBeCloseTo(0.5625, 5)
    expect(normalized.height).toBeCloseTo(1, 5)
    expect(normalized.x).toBeCloseTo((1 - 0.5625) / 2, 5)
    expect(normalized.y).toBeCloseTo(0, 5)
  })

  it('keeps already-normalized regions stable', () => {
    const input = { x: 0.18, y: 0.12, width: 0.45, height: 0.8 }
    const normalized = normalizeAspectCropRegion(input, 16 / 9, 1)
    expect(cropRegionEquals(input, normalized)).toBe(true)
  })

  it('clamps out-of-range crop values', () => {
    const normalized = normalizeAspectCropRegion(
      { x: -0.5, y: -0.2, width: 2.5, height: 1.5 },
      16 / 9,
      1,
    )
    expect(normalized.x).toBeGreaterThanOrEqual(0)
    expect(normalized.y).toBeGreaterThanOrEqual(0)
    expect(normalized.x + normalized.width).toBeLessThanOrEqual(1)
    expect(normalized.y + normalized.height).toBeLessThanOrEqual(1)
    const pixelRatio = (normalized.width * 16 / 9) / normalized.height
    expect(pixelRatio).toBeCloseTo(1, 4)
  })
})

