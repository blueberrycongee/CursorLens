import type { SubtitleCue, SubtitleGenerationOptions, TranscriptWord } from './types';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeWord(word: TranscriptWord): TranscriptWord | null {
  const startMs = Number(word.startMs);
  const endMs = Number(word.endMs);
  const text = String(word.text ?? '').trim();
  if (!text) return null;
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  if (endMs <= startMs) return null;
  return {
    text,
    startMs: Math.max(0, Math.round(startMs)),
    endMs: Math.max(0, Math.round(endMs)),
    confidence: Number.isFinite(word.confidence) ? Number(word.confidence) : undefined,
  };
}

function cueTextLength(text: string): number {
  return Array.from(text).length;
}

function applyCueDurationConstraints(
  rawCues: SubtitleCue[],
  options: SubtitleGenerationOptions,
): SubtitleCue[] {
  if (rawCues.length === 0) return [];

  const next = rawCues.map((cue) => ({ ...cue }));
  for (let index = 0; index < next.length; index += 1) {
    const cue = next[index];
    const minDurationForCpsMs = Math.ceil((cueTextLength(cue.text) / Math.max(0.001, options.maxCps)) * 1000);
    const requiredMinDurationMs = Math.min(
      options.maxCueDurationMs,
      Math.max(options.minCueDurationMs, minDurationForCpsMs),
    );
    const minEnd = cue.startMs + requiredMinDurationMs;
    const maxEnd = cue.startMs + options.maxCueDurationMs;

    let desiredEnd = cue.endMs;
    if (desiredEnd < minEnd) {
      desiredEnd = minEnd;
    }
    desiredEnd = Math.min(desiredEnd, maxEnd);

    if (desiredEnd <= cue.startMs) {
      desiredEnd = cue.startMs + 1;
    }

    cue.endMs = desiredEnd;
  }

  return next;
}

export function normalizeSubtitleText(input: string): string {
  return input
    .replace(/\s+/g, ' ')
    .replace(/\s+([，。！？；：、])/g, '$1')
    .replace(/([，。！？；：、])\s+/g, '$1')
    .replace(/([（【《“])\s+/g, '$1')
    .replace(/\s+([）】》”])/g, '$1')
    .trim();
}

export function buildSubtitleCuesFromWords(
  inputWords: TranscriptWord[],
  options: SubtitleGenerationOptions,
): SubtitleCue[] {
  const words = inputWords
    .map(normalizeWord)
    .filter((word): word is TranscriptWord => Boolean(word))
    .sort((left, right) => left.startMs - right.startMs);

  if (words.length === 0) return [];

  const cues: SubtitleCue[] = [];
  const maxChars = Math.max(1, options.maxCharsPerLine * options.maxLines);

  let buffer: TranscriptWord[] = [];

  const flushBuffer = (): void => {
    if (buffer.length === 0) return;
    const startMs = buffer[0].startMs;
    const endMs = buffer[buffer.length - 1].endMs;
    const text = normalizeSubtitleText(buffer.map((word) => word.text).join(' '));
    if (!text) {
      buffer = [];
      return;
    }

    const averageConfidence = buffer.reduce((sum, word) => sum + (word.confidence ?? 0.8), 0) / buffer.length;
    cues.push({
      id: `subtitle-${cues.length + 1}`,
      startMs,
      endMs,
      text,
      source: 'asr',
      confidence: Number.isFinite(averageConfidence) ? averageConfidence : undefined,
    });
    buffer = [];
  };

  for (let index = 0; index < words.length; index += 1) {
    const current = words[index];
    const previous = words[index - 1];

    if (previous) {
      const silenceGap = current.startMs - previous.endMs;
      if (silenceGap >= options.splitOnSilenceMs) {
        flushBuffer();
      }
    }

    if (buffer.length === 0) {
      buffer.push(current);
      continue;
    }

    const candidate = [...buffer, current];
    const candidateText = normalizeSubtitleText(candidate.map((word) => word.text).join(' '));
    const candidateDurationMs = candidate[candidate.length - 1].endMs - candidate[0].startMs;
    const candidateRequiredDurationMs = Math.ceil(
      (cueTextLength(candidateText) / Math.max(0.001, options.maxCps)) * 1000,
    );

    const exceedsDuration = candidateDurationMs > options.maxCueDurationMs;
    const exceedsChars = cueTextLength(candidateText) > maxChars;
    const exceedsCps = candidateRequiredDurationMs > options.maxCueDurationMs;

    if (exceedsDuration || exceedsChars || exceedsCps) {
      flushBuffer();
      buffer.push(current);
      continue;
    }

    buffer.push(current);
  }

  flushBuffer();

  return applyCueDurationConstraints(cues, options).map((cue, index) => ({
    ...cue,
    id: `subtitle-${index + 1}`,
    startMs: Math.max(0, Math.round(cue.startMs)),
    endMs: Math.max(Math.round(cue.startMs) + 1, Math.round(cue.endMs)),
  }));
}

export function defaultSubtitleGenerationOptions(): SubtitleGenerationOptions {
  return {
    minCueDurationMs: 800,
    maxCueDurationMs: 4000,
    splitOnSilenceMs: 650,
    maxCharsPerLine: 22,
    maxLines: 2,
    maxCps: 14,
  };
}

export function estimateMaxCharsPerLine(videoWidth: number, widthRatio: number): number {
  const width = Math.max(320, Math.round(videoWidth));
  const ratio = clamp(widthRatio, 0.5, 0.95);
  const usable = width * ratio;
  return Math.max(8, Math.round(usable / 38));
}
