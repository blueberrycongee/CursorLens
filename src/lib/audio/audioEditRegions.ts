import type { AudioEditRegion } from '@/components/video-editor/types'

const MIN_AUDIO_EDIT_DURATION_MS = 20
const MAX_PREVIEW_VOLUME = 1
const AUDIO_GAIN_EPSILON = 0.0001

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function normalizeAudioEditGain(value: number): number {
  if (!Number.isFinite(value)) return 0
  return clamp(value, 0, 1)
}

function normalizeAudioEditRegion(
  region: AudioEditRegion,
  durationMs: number,
): AudioEditRegion | null {
  const maxDuration = Math.max(0, Math.round(durationMs))
  const startMs = clamp(Math.round(Number(region.startMs)), 0, maxDuration)
  const endMs = clamp(Math.round(Number(region.endMs)), 0, maxDuration)
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null
  if (endMs - startMs < MIN_AUDIO_EDIT_DURATION_MS) return null

  return {
    id: region.id,
    startMs,
    endMs,
    mode: region.mode === 'duck' ? 'duck' : 'mute',
    gain: normalizeAudioEditGain(region.gain),
    source: region.source === 'manual' ? 'manual' : region.source === 'rough-cut' ? 'rough-cut' : undefined,
    reason: region.reason === 'filler' ? 'filler' : region.reason === 'silence' ? 'silence' : undefined,
  }
}

export function normalizeAudioEditRegions(
  input: AudioEditRegion[] | undefined,
  durationMs: number,
): AudioEditRegion[] {
  if (!input?.length) return []
  const normalized = input
    .map((region) => normalizeAudioEditRegion(region, durationMs))
    .filter((region): region is AudioEditRegion => Boolean(region))
    .sort((left, right) => {
      if (left.startMs !== right.startMs) return left.startMs - right.startMs
      return left.endMs - right.endMs
    })

  if (normalized.length === 0) return []

  const merged: AudioEditRegion[] = []
  for (const region of normalized) {
    const previous = merged[merged.length - 1]
    const sameMode = previous?.mode === region.mode
    const sameGain = previous ? Math.abs(previous.gain - region.gain) <= AUDIO_GAIN_EPSILON : false
    const canMerge = Boolean(previous && sameMode && sameGain && region.startMs <= previous.endMs + 1)

    if (!canMerge || !previous) {
      merged.push({
        ...region,
        id: region.id || `audio-edit-${merged.length + 1}`,
      })
      continue
    }

    previous.endMs = Math.max(previous.endMs, region.endMs)
    if (previous.source !== 'manual' && region.source === 'manual') {
      previous.source = 'manual'
    }
    if (previous.reason !== region.reason) {
      previous.reason = undefined
    } else if (!previous.reason && region.reason) {
      previous.reason = region.reason
    }
  }

  return merged
}

export function getAudioEditGainMultiplierAtTime(
  timeMs: number,
  regions: AudioEditRegion[] | undefined,
): number {
  if (!regions?.length || !Number.isFinite(timeMs)) return 1
  const safeTimeMs = Math.max(0, timeMs)
  let multiplier = 1

  for (const region of regions) {
    if (region.startMs > safeTimeMs) {
      break
    }
    if (safeTimeMs >= region.startMs && safeTimeMs < region.endMs) {
      multiplier = Math.min(multiplier, normalizeAudioEditGain(region.gain))
      if (multiplier <= 0) return 0
    }
  }

  return multiplier
}

export function resolvePreviewAudioState(args: {
  hasAudioTrack: boolean
  audioEnabled: boolean
  baseGain: number
  timeMs: number
  regions: AudioEditRegion[] | undefined
}): { muted: boolean; volume: number } {
  if (!args.hasAudioTrack || !args.audioEnabled) {
    return { muted: true, volume: 0 }
  }

  const baseGain = clamp(Number.isFinite(args.baseGain) ? args.baseGain : 1, 0, MAX_PREVIEW_VOLUME)
  const regionMultiplier = getAudioEditGainMultiplierAtTime(args.timeMs, args.regions)
  const volume = clamp(baseGain * regionMultiplier, 0, MAX_PREVIEW_VOLUME)
  return {
    muted: volume <= 0.0001,
    volume,
  }
}
