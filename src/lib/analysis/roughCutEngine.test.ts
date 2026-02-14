import { describe, expect, it } from 'vitest';
import { generateRoughCutSuggestions, normalizeRoughCutSuggestions } from './roughCutEngine';
import type { TranscriptWord, RoughCutSuggestion } from './types';

function w(text: string, startMs: number, endMs: number): TranscriptWord {
  return { text, startMs, endMs };
}

function s(startMs: number, endMs: number, reason: 'silence' | 'filler'): RoughCutSuggestion {
  return {
    id: `${reason}-${startMs}-${endMs}`,
    startMs,
    endMs,
    reason,
    confidence: 0.9,
    label: reason,
  };
}

describe('generateRoughCutSuggestions', () => {
  it('detects long silence gaps', () => {
    const words = [
      w('hello', 0, 150),
      w('world', 200, 350),
      w('again', 2_000, 2_220),
    ];

    const suggestions = generateRoughCutSuggestions(words, 2_800, {
      minSilenceMs: 700,
      minFillerDurationMs: 250,
      fillerWords: ['um', 'uh'],
    });

    expect(suggestions.some((item) => item.reason === 'silence')).toBe(true);
  });

  it('detects filler runs', () => {
    const words = [
      w('um', 0, 120),
      w('uh', 140, 260),
      w('okay', 600, 860),
    ];

    const suggestions = generateRoughCutSuggestions(words, 1_500, {
      minSilenceMs: 700,
      minFillerDurationMs: 220,
      fillerWords: ['um', 'uh'],
    });

    expect(suggestions.some((item) => item.reason === 'filler')).toBe(true);
  });
});

describe('normalizeRoughCutSuggestions', () => {
  it('sorts and merges overlapping suggestions', () => {
    const normalized = normalizeRoughCutSuggestions([
      s(100, 400, 'filler'),
      s(390, 600, 'silence'),
      s(900, 1_200, 'silence'),
    ], 2_000);

    expect(normalized).toHaveLength(2);
    expect(normalized[0].startMs).toBe(100);
    expect(normalized[0].endMs).toBe(600);
  });
});
