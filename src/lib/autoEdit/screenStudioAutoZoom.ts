import type { ZoomDepth, ZoomFocus } from '@/components/video-editor/types';
import type { CursorSample, CursorTrack, CursorTrackEvent } from '@/lib/cursor';

export type AutoZoomReason = 'click' | 'selection' | 'movement';

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
  preRollMs?: number;
  holdMs?: number;
  startHintMs?: number;
  endHintMs?: number;
};

type DraftWithWeight = AutoZoomDraft & { weight: number };

const CLICK_PRE_ROLL_MS = 220;
const CLICK_HOLD_MS = 1_400;
const CLICK_MIN_GAP_MS = 260;

const SELECTION_PRE_ROLL_MS = 120;
const SELECTION_BASE_HOLD_MS = 1_550;
const SELECTION_MAX_EXTRA_HOLD_MS = 2_200;
const SELECTION_DURATION_HOLD_FACTOR = 0.9;
const SELECTION_SPAN_HOLD_FACTOR = 2_000;
const SELECTION_MIN_DIMENSION = 0.008;

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

function toNormalizedEvents(track: CursorTrack | null | undefined): CursorTrackEvent[] {
  if (!track?.events?.length) return [];

  return track.events
    .map((event) => {
      const startMs = Number(event.startMs);
      const endMs = Number(event.endMs);
      const pointX = Number(event.point?.x);
      const pointY = Number(event.point?.y);
      if (
        !Number.isFinite(startMs)
        || !Number.isFinite(endMs)
        || !Number.isFinite(pointX)
        || !Number.isFinite(pointY)
      ) {
        return null;
      }

      const minX = Number(event.bounds?.minX);
      const minY = Number(event.bounds?.minY);
      const maxX = Number(event.bounds?.maxX);
      const maxY = Number(event.bounds?.maxY);
      const normalizedBounds = [minX, minY, maxX, maxY].every(Number.isFinite)
        ? {
          minX: clamp01(minX),
          minY: clamp01(minY),
          maxX: clamp01(Math.max(minX, maxX)),
          maxY: clamp01(Math.max(minY, maxY)),
          width: clamp01(Math.max(0, maxX - minX)),
          height: clamp01(Math.max(0, maxY - minY)),
        }
        : undefined;

      const normalizedEvent: CursorTrackEvent = {
        type: event.type === 'selection' ? 'selection' : 'click',
        startMs: Math.max(0, Math.round(startMs)),
        endMs: Math.max(Math.max(0, Math.round(startMs)), Math.round(endMs)),
        point: {
          x: clamp01(pointX),
          y: clamp01(pointY),
        },
      };
      const startPointX = Number(event.startPoint?.x);
      const startPointY = Number(event.startPoint?.y);
      if (Number.isFinite(startPointX) && Number.isFinite(startPointY)) {
        normalizedEvent.startPoint = {
          x: clamp01(startPointX),
          y: clamp01(startPointY),
        };
      }
      const endPointX = Number(event.endPoint?.x);
      const endPointY = Number(event.endPoint?.y);
      if (Number.isFinite(endPointX) && Number.isFinite(endPointY)) {
        normalizedEvent.endPoint = {
          x: clamp01(endPointX),
          y: clamp01(endPointY),
        };
      }
      if (normalizedBounds) {
        normalizedEvent.bounds = normalizedBounds;
      }
      return normalizedEvent;
    })
    .filter((event): event is CursorTrackEvent => event !== null)
    .sort((left, right) => left.startMs - right.startMs);
}

function resolveSelectionHoldMs(event: CursorTrackEvent): number {
  const duration = Math.max(0, event.endMs - event.startMs);
  const span = event.bounds ? Math.max(event.bounds.width, event.bounds.height) : 0;
  const dynamicExtra = duration * SELECTION_DURATION_HOLD_FACTOR + span * SELECTION_SPAN_HOLD_FACTOR;
  return clampMs(
    SELECTION_BASE_HOLD_MS + dynamicExtra,
    SELECTION_BASE_HOLD_MS,
    SELECTION_BASE_HOLD_MS + SELECTION_MAX_EXTRA_HOLD_MS,
  );
}

function quantile(sortedValues: number[], ratio: number): number {
  if (sortedValues.length === 0) return 0;
  const clampedRatio = clamp01(ratio);
  const index = Math.floor((sortedValues.length - 1) * clampedRatio);
  return sortedValues[Math.max(0, Math.min(index, sortedValues.length - 1))];
}

function isNearAnyTime(sortedTimes: number[], timeMs: number, windowMs: number): boolean {
  if (sortedTimes.length === 0) return false;
  let low = 0;
  let high = sortedTimes.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (sortedTimes[mid] < timeMs) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  const left = low - 1;
  const right = low;
  if (left >= 0 && Math.abs(sortedTimes[left] - timeMs) < windowMs) return true;
  if (right < sortedTimes.length && Math.abs(sortedTimes[right] - timeMs) < windowMs) return true;
  return false;
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

function collectCandidates(samples: CursorSample[], events: CursorTrackEvent[]): Candidate[] {
  const candidates: Candidate[] = [];
  const interactionAnchors: number[] = [];
  let hasEventClicks = false;

  if (events.length > 0) {
    let lastClickAt = -Infinity;
    for (const event of events) {
      const eventTimeMs = event.endMs;
      if (event.type === 'click') {
        if (eventTimeMs - lastClickAt < CLICK_MIN_GAP_MS) continue;
        hasEventClicks = true;
        candidates.push({
          timeMs: eventTimeMs,
          focus: {
            cx: clamp01(event.point.x),
            cy: clamp01(event.point.y),
          },
          depth: 3,
          reason: 'click',
          weight: 3.2,
          preRollMs: CLICK_PRE_ROLL_MS,
          holdMs: CLICK_HOLD_MS,
          startHintMs: event.startMs,
          endHintMs: event.endMs,
        });
        interactionAnchors.push(eventTimeMs);
        lastClickAt = eventTimeMs;
        continue;
      }

      const selectionSpan = event.bounds ? Math.max(event.bounds.width, event.bounds.height) : 0;
      if (selectionSpan < SELECTION_MIN_DIMENSION && event.endMs - event.startMs < 120) {
        continue;
      }

      candidates.push({
        timeMs: eventTimeMs,
        focus: {
          cx: clamp01(event.point.x),
          cy: clamp01(event.point.y),
        },
        depth: 3,
        reason: 'selection',
        weight: 3.8 + Math.min(1.6, selectionSpan * 8),
        preRollMs: SELECTION_PRE_ROLL_MS,
        holdMs: resolveSelectionHoldMs(event),
        startHintMs: event.startMs,
        endHintMs: event.endMs,
      });
      interactionAnchors.push(eventTimeMs);
    }
  }

  if (events.length === 0 || !hasEventClicks) {
    let lastClickAt = -Infinity;
    for (const sample of samples) {
      if (!sampleVisible(sample) || !sample.click) continue;
      if (sample.timeMs - lastClickAt < CLICK_MIN_GAP_MS) continue;
      if (interactionAnchors.some((timeMs) => Math.abs(timeMs - sample.timeMs) < CLICK_MIN_GAP_MS)) continue;

      candidates.push({
        timeMs: sample.timeMs,
        focus: normalizeFocus(sample),
        depth: 3,
        reason: 'click',
        weight: 3,
      });
      interactionAnchors.push(sample.timeMs);
      lastClickAt = sample.timeMs;
    }
  }

  interactionAnchors.sort((left, right) => left - right);

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

    if (isNearAnyTime(interactionAnchors, current.timeMs, 360)) continue;

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
  const preRollMs = candidate.preRollMs
    ?? (candidate.reason === 'selection'
      ? SELECTION_PRE_ROLL_MS
      : candidate.reason === 'click'
        ? CLICK_PRE_ROLL_MS
        : MOVEMENT_PRE_ROLL_MS);
  const holdMs = candidate.holdMs
    ?? (candidate.reason === 'selection'
      ? SELECTION_BASE_HOLD_MS
      : candidate.reason === 'click'
        ? CLICK_HOLD_MS
        : MOVEMENT_HOLD_MS);

  const startAnchor = Number.isFinite(candidate.startHintMs) ? Number(candidate.startHintMs) : candidate.timeMs;
  const endAnchor = Number.isFinite(candidate.endHintMs) ? Number(candidate.endHintMs) : candidate.timeMs;

  let startMs = clampMs(startAnchor - preRollMs, 0, durationMs);
  let endMs = clampMs(endAnchor + holdMs, 0, durationMs);

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
  const reasonPriority = (reason: AutoZoomReason): number => {
    switch (reason) {
      case 'selection':
        return 3;
      case 'click':
        return 2;
      case 'movement':
      default:
        return 1;
    }
  };

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
    if (
      reasonPriority(draft.reason) > reasonPriority(previous.reason)
      || (reasonPriority(draft.reason) === reasonPriority(previous.reason) && draft.weight > previous.weight)
    ) {
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

  const reasonBonus = (reason: AutoZoomReason): number => {
    switch (reason) {
      case 'selection':
        return 2.6;
      case 'click':
        return 2;
      case 'movement':
      default:
        return 0;
    }
  };

  const ranked = drafts
    .map((draft, index) => ({
      index,
      score: draft.weight + reasonBonus(draft.reason),
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
  const events = toNormalizedEvents(track);

  const candidates = collectCandidates(samples, events);
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
