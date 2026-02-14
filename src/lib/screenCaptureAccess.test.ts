import { describe, expect, it } from 'vitest'
import { isScreenCaptureAccessBlocked, type ScreenCaptureAccessStatus } from './screenCaptureAccess'

describe('isScreenCaptureAccessBlocked', () => {
  it('returns true for denied and restricted statuses', () => {
    expect(isScreenCaptureAccessBlocked('denied')).toBe(true)
    expect(isScreenCaptureAccessBlocked('restricted')).toBe(true)
  })

  it('returns false for granted-like statuses', () => {
    const allowedStatuses: ScreenCaptureAccessStatus[] = ['granted', 'not-determined', 'unknown']
    for (const status of allowedStatuses) {
      expect(isScreenCaptureAccessBlocked(status)).toBe(false)
    }
  })
})

