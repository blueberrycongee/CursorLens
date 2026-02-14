import { describe, expect, it } from 'vitest'
import { getAudioEditGainMultiplierAtTime, normalizeAudioEditRegions, resolvePreviewAudioState } from './audioEditRegions'
import type { AudioEditRegion } from '@/components/video-editor/types'

function edit(id: string, startMs: number, endMs: number, gain = 0): AudioEditRegion {
  return {
    id,
    startMs,
    endMs,
    gain,
    mode: gain <= 0 ? 'mute' : 'duck',
    source: 'rough-cut',
  }
}

describe('normalizeAudioEditRegions', () => {
  it('preserves different gains while merging adjacent equal-gain edits', () => {
    const normalized = normalizeAudioEditRegions(
      [
        edit('e1', 100, 280, 0.3),
        edit('e2', 260, 410, 0),
        edit('e3', 410, 450, 0),
      ],
      1_000,
    )
    expect(normalized).toHaveLength(2)
    expect(normalized[0].startMs).toBe(100)
    expect(normalized[0].endMs).toBe(280)
    expect(normalized[0].gain).toBe(0.3)
    expect(normalized[1].startMs).toBe(260)
    expect(normalized[1].endMs).toBe(450)
    expect(normalized[1].gain).toBe(0)
  })
})

describe('getAudioEditGainMultiplierAtTime', () => {
  const regions = normalizeAudioEditRegions([edit('e1', 100, 300, 0.4), edit('e2', 200, 260, 0)], 1_000)

  it('returns 1 when outside any edit range', () => {
    expect(getAudioEditGainMultiplierAtTime(80, regions)).toBe(1)
    expect(getAudioEditGainMultiplierAtTime(999, regions)).toBe(1)
  })

  it('returns minimum gain when inside edit ranges', () => {
    expect(getAudioEditGainMultiplierAtTime(150, regions)).toBeCloseTo(0.4, 5)
    expect(getAudioEditGainMultiplierAtTime(240, regions)).toBeCloseTo(0, 5)
  })
})

describe('resolvePreviewAudioState', () => {
  it('mutes when audio is disabled', () => {
    const state = resolvePreviewAudioState({
      hasAudioTrack: true,
      audioEnabled: false,
      baseGain: 0.9,
      timeMs: 120,
      regions: [edit('e1', 100, 200, 0.2)],
    })
    expect(state.muted).toBe(true)
    expect(state.volume).toBe(0)
  })

  it('applies region multiplier on top of base gain', () => {
    const state = resolvePreviewAudioState({
      hasAudioTrack: true,
      audioEnabled: true,
      baseGain: 0.8,
      timeMs: 120,
      regions: [edit('e1', 100, 200, 0.25)],
    })
    expect(state.muted).toBe(false)
    expect(state.volume).toBeCloseTo(0.2, 4)
  })
})
