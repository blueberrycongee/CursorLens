import type { ZoomDepth, ZoomFocus } from '@/components/video-editor/types';
import type { CursorSample, CursorTrack } from '@/lib/cursor';

export type AutoZoomReason = 'click' | 'movement';

export interface AutoZoomDraft {
  startMs: number;
  endMs: number;
  depth: ZoomDepth;
  focus: ZoomFocus;
  reason: AutoZoomReason;
}

export interface AutoZoomGenerationOptions {
  durationMs: number;
  maxRegions?: number;
}

type Candidate = {
  timeMs: number;
  focus: ZoomFocus;
  depth: ZoomDepth;
  reason: AutoZoomReason;
  weight: number;
};

type DraftWithWeight = AutoZoomDraft & { weight: number };

const CLICK_PRE_ROLL_MS = 220;
const CLICK_HOLD_MS = 1_400;
const CLICK_MIN_GAP_MS = 260;

const MOVEMENT_PRE_ROLL_MS = 120;
const MOVEMENT_HOLD_MS = 920;
const MOVEMENT_MIN_GAP_MS = 680;
const MOVEMENT_MIN_DISTANCE = 0.018;
const MOVEMENT_BASE_SPEED = 0.42;
const MOVEMENT_PERCENTILE = 0.86;

const MERGE_GAP_MS = 140;
const MIN_REGION_DURATION_MS = 420;
const DEFAULT_MAX_REGIONS = 64;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function clampMs(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function sampleVisible(sample: CursorSample): boolean {
  return sample.visible !== false;
}

function normalizeFocus(sample: CursorSample): ZoomFocus {
  return {
    cx: clamp01(sample.x),
    cy: clamp01(sample.y),
  };
}

function toNormalizedSamples(track: CursorTrack | null | undefined): CursorSample[] {
  if (!track?.samples?.length) return [];

  return track.samples
    .map((sample) => {
      const timeMs = Number(sample.timeMs);
      const x = Number(sample.x);
      const y = Number(sample.y);
      if (!Number.isFinite(timeMs) || !Number.isFinite(x) || !Number.isFinite(y)) {
        return null;
      }
      return {
        ...sample,
        timeMs: Math.max(0, Math.round(timeMs)),
        x: clamp01(x),
        y: clamp01(y),
      } satisfies CursorSample;
    })
    .filter((sample): sample is CursorSample => Boolean(sample))
    .sort((left, right) => left.timeMs - right.timeMs);
}

function quantile(sortedValues: number[], ratio: number): number {
  if (sortedValues.length === 0) return 0;
  const clampedRatio = clamp01(ratio);
  const index = Math.floor((sortedValues.length - 1) * clampedRatio);
  return sortedValues[Math.max(0, Math.min(index, sortedValues.length - 1))];
}

function resolveMovementSpeedThreshold(samples: CursorSample[]): number {
  const speeds: number[] = [];
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    if (!sampleVisible(previous) || !sampleVisible(current)) continue;
    const dt = current.timeMs - previous.timeMs;
    if (dt < 6 || dt > 320) continue;
    const dx = current.x - previous.x;
    const dy = current.y - previous.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 0.0008) continue;
    speeds.push(distance / (dt / 1_000));
  }

  if (speeds.length === 0) return MOVEMENT_BASE_SPEED;
  speeds.sort((left, right) => left - right);
  return Math.max(MOVEMENT_BASE_SPEED, quantile(speeds, MOVEMENT_PERCENTILE));
}

function collectCandidates(samples: CursorSample[]): Candidate[] {
  const candidates: Candidate[] = [];

  let lastClickAt = -Infinity;
  for (const sample of samples) {
    if (!sampleVisible(sample) || !sample.click) continue;
    if (sample.timeMs - lastClickAt < CLICK_MIN_GAP_MS) continue;

    candidates.push({
      timeMs: sample.timeMs,
      focus: normalizeFocus(sample),
      depth: 3,
      reason: 'click',
      weight: 3,
    });
    lastClickAt = sample.timeMs;
  }

  const speedThreshold = resolveMovementSpeedThreshold(samples);
  let lastMovementAt = -Infinity;
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    if (!sampleVisible(previous) || !sampleVisible(current)) continue;

    const dt = current.timeMs - previous.timeMs;
    if (dt < 6 || dt > 320) continue;

    const dx = current.x - previous.x;
    const dy = current.y - previous.y;
    const distance = Math.hypot(dx, dy);
    if (distance < MOVEMENT_MIN_DISTANCE) continue;

    const speed = distance / (dt / 1_000);
    if (speed < speedThreshold) continue;
    if (current.timeMs - lastMovementAt < MOVEMENT_MIN_GAP_MS) continue;

    const nearClick = candidates.some((candidate) =>
      candidate.reason === 'click' && Math.abs(candidate.timeMs - current.timeMs) < 360,
    );
    if (nearClick) continue;

    candidates.push({
      timeMs: current.timeMs,
      focus: normalizeFocus(current),
      depth: 2,
      reason: 'movement',
      weight: speed,
    });
    lastMovementAt = current.timeMs;
  }

  return candidates.sort((left, right) => left.timeMs - right.timeMs);
}

function toDraft(candidate: Candidate, durationMs: number): DraftWithWeight | null {
  const preRollMs = candidate.reason === 'click' ? CLICK_PRE_ROLL_MS : MOVEMENT_PRE_ROLL_MS;
  const holdMs = candidate.reason === 'click' ? CLICK_HOLD_MS : MOVEMENT_HOLD_MS;

  let startMs = clampMs(candidate.timeMs - preRollMs, 0, durationMs);
  let endMs = clampMs(candidate.timeMs + holdMs, 0, durationMs);

  if (endMs - startMs < MIN_REGION_DURATION_MS) {
    endMs = clampMs(startMs + MIN_REGION_DURATION_MS, 0, durationMs);
    if (endMs - startMs < MIN_REGION_DURATION_MS) {
      startMs = clampMs(endMs - MIN_REGION_DURATION_MS, 0, durationMs);
    }
  }

  if (endMs <= startMs) return null;

  return {
    startMs,
    endMs,
    depth: candidate.depth,
    focus: candidate.focus,
    reason: candidate.reason,
    weight: candidate.weight,
  };
}

function mergeDrafts(drafts: DraftWithWeight[]): DraftWithWeight[] {
  if (drafts.length === 0) return [];

  const merged: DraftWithWeight[] = [];
  for (const draft of drafts) {
    const previous = merged[merged.length - 1];
    if (!previous) {
      merged.push(draft);
      continue;
    }

    if (draft.startMs > previous.endMs + MERGE_GAP_MS) {
      merged.push(draft);
      continue;
    }

    previous.endMs = Math.max(previous.endMs, draft.endMs);
    if (draft.reason === 'click' || (previous.reason !== 'click' && draft.weight > previous.weight)) {
      previous.focus = draft.focus;
      previous.depth = draft.depth;
      previous.reason = draft.reason;
      previous.weight = Math.max(previous.weight, draft.weight);
    } else {
      previous.weight = Math.max(previous.weight, draft.weight);
      previous.depth = Math.max(previous.depth, draft.depth) as ZoomDepth;
    }
  }

  return merged;
}

function limitDrafts(drafts: DraftWithWeight[], maxRegions: number): DraftWithWeight[] {
  if (drafts.length <= maxRegions) return drafts;

  const ranked = drafts
    .map((draft, index) => ({
      index,
      score: draft.weight + (draft.reason === 'click' ? 2 : 0),
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, maxRegions);

  const selected = new Set(ranked.map((item) => item.index));
  return drafts.filter((_, index) => selected.has(index));
}

export function generateAutoZoomDrafts(
  track: CursorTrack | null | undefined,
  options: AutoZoomGenerationOptions,
): AutoZoomDraft[] {
  const durationMs = clampMs(options.durationMs, 0, Number.MAX_SAFE_INTEGER);
  if (durationMs < 200) return [];

  const maxRegions = clampMs(options.maxRegions ?? DEFAULT_MAX_REGIONS, 1, 200);
  const samples = toNormalizedSamples(track);
  if (samples.length < 2) return [];

  const candidates = collectCandidates(samples);
  if (candidates.length === 0) return [];

  const merged = mergeDrafts(
    candidates
      .map((candidate) => toDraft(candidate, durationMs))
      .filter((draft): draft is DraftWithWeight => Boolean(draft)),
  );

  const limited = limitDrafts(merged, maxRegions)
    .sort((left, right) => left.startMs - right.startMs)
    .map(({ startMs, endMs, depth, focus, reason }) => ({
      startMs,
      endMs,
      depth,
      focus,
      reason,
    }));

  return limited;
}
