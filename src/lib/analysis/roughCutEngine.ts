import type { RoughCutOptions, RoughCutSuggestion, TranscriptWord } from './types';

function normalizeWord(word: TranscriptWord): TranscriptWord | null {
  const text = String(word.text ?? '').trim();
  const startMs = Number(word.startMs);
  const endMs = Number(word.endMs);
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

function normalizeTextToken(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

export function normalizeRoughCutSuggestions(
  input: RoughCutSuggestion[],
  durationMs: number,
): RoughCutSuggestion[] {
  const totalDurationMs = Math.max(0, Math.round(durationMs));
  const normalized = input
    .map((item) => {
      const startMs = Math.max(0, Math.round(Number(item.startMs)));
      const endMs = Math.min(totalDurationMs, Math.round(Number(item.endMs)));
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;
      return {
        ...item,
        startMs,
        endMs,
      };
    })
    .filter((item): item is RoughCutSuggestion => Boolean(item))
    .sort((left, right) => left.startMs - right.startMs);

  if (normalized.length === 0) {
    return [];
  }

  const merged: RoughCutSuggestion[] = [];
  for (const item of normalized) {
    const previous = merged[merged.length - 1];
    if (!previous || item.startMs > previous.endMs + 40) {
      merged.push({ ...item });
      continue;
    }

    previous.endMs = Math.max(previous.endMs, item.endMs);
    if (item.confidence > previous.confidence) {
      previous.reason = item.reason;
      previous.label = item.label;
      previous.confidence = item.confidence;
    } else {
      previous.confidence = Math.max(previous.confidence, item.confidence);
    }
  }

  return merged.map((item, index) => ({
    ...item,
    id: `roughcut-${index + 1}`,
  }));
}

export function generateRoughCutSuggestions(
  inputWords: TranscriptWord[],
  durationMs: number,
  options: RoughCutOptions,
): RoughCutSuggestion[] {
  const words = inputWords
    .map(normalizeWord)
    .filter((word): word is TranscriptWord => Boolean(word))
    .sort((left, right) => left.startMs - right.startMs);

  if (words.length === 0) return [];

  const suggestions: RoughCutSuggestion[] = [];

  for (let index = 1; index < words.length; index += 1) {
    const previous = words[index - 1];
    const current = words[index];
    const gap = current.startMs - previous.endMs;
    if (gap < options.minSilenceMs) continue;

    suggestions.push({
      id: `silence-${index}`,
      startMs: previous.endMs,
      endMs: current.startMs,
      reason: 'silence',
      confidence: Math.min(0.98, 0.55 + gap / 3_000),
      label: 'Long silence',
    });
  }

  const fillerSet = new Set(options.fillerWords.map((word) => normalizeTextToken(word)).filter(Boolean));
  const MAX_FILLER_GAP_MS = 200;
  let runStart: TranscriptWord | null = null;
  let runEnd: TranscriptWord | null = null;

  const flushFillerRun = (): void => {
    if (!runStart || !runEnd) return;
    const duration = runEnd.endMs - runStart.startMs;
    if (duration >= options.minFillerDurationMs) {
      suggestions.push({
        id: `filler-${runStart.startMs}`,
        startMs: runStart.startMs,
        endMs: runEnd.endMs,
        reason: 'filler',
        confidence: Math.min(0.96, 0.62 + duration / 2_000),
        label: 'Filler words',
      });
    }
    runStart = null;
    runEnd = null;
  };

  for (const word of words) {
    const normalized = normalizeTextToken(word.text);
    const isFiller = fillerSet.has(normalized);

    if (!isFiller) {
      flushFillerRun();
      continue;
    }

    if (!runStart || !runEnd) {
      runStart = word;
      runEnd = word;
      continue;
    }

    if (word.startMs - runEnd.endMs > MAX_FILLER_GAP_MS) {
      flushFillerRun();
      runStart = word;
      runEnd = word;
      continue;
    }

    runEnd = word;
  }

  flushFillerRun();

  return normalizeRoughCutSuggestions(suggestions, durationMs);
}

export function defaultRoughCutOptions(): RoughCutOptions {
  return {
    minSilenceMs: 800,
    minFillerDurationMs: 260,
    fillerWords: ['um', 'uh', 'emm', 'ah', 'er', '呃', '嗯', '这个'],
  };
}
