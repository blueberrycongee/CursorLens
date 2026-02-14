import type { SubtitleCue } from './types';

export function normalizeSubtitleCues(input: SubtitleCue[]): SubtitleCue[] {
  return input
    .map((cue) => {
      const startMs = Math.max(0, Math.round(Number(cue.startMs)));
      const endMs = Math.max(0, Math.round(Number(cue.endMs)));
      const text = String(cue.text ?? '').trim();
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs || !text) {
        return null;
      }
      return {
        ...cue,
        startMs,
        endMs,
        text,
      } satisfies SubtitleCue;
    })
    .filter((cue): cue is SubtitleCue => Boolean(cue))
    .sort((left, right) => left.startMs - right.startMs);
}

export function findSubtitleCueAtTime(
  cuesInput: SubtitleCue[],
  timeMsInput: number,
): SubtitleCue | null {
  if (!Array.isArray(cuesInput) || cuesInput.length === 0) return null;
  const timeMs = Number(timeMsInput);
  if (!Number.isFinite(timeMs) || timeMs < 0) return null;

  let low = 0;
  let high = cuesInput.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const cue = cuesInput[mid];
    if (timeMs < cue.startMs) {
      high = mid - 1;
      continue;
    }
    if (timeMs >= cue.endMs) {
      low = mid + 1;
      continue;
    }
    return cue;
  }

  return null;
}
