export type ScreenCaptureAccessStatus = 'granted' | 'denied' | 'restricted' | 'not-determined' | 'unknown'

export function isScreenCaptureAccessBlocked(status: ScreenCaptureAccessStatus): boolean {
  return status === 'denied' || status === 'restricted'
}

