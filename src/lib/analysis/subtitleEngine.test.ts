import { describe, expect, it } from 'vitest';
import { buildSubtitleCuesFromWords, normalizeSubtitleText } from './subtitleEngine';
import type { TranscriptWord } from './types';

function w(text: string, startMs: number, endMs: number): TranscriptWord {
  return { text, startMs, endMs, confidence: 0.9 };
}

describe('normalizeSubtitleText', () => {
  it('collapses repeated whitespace and trims boundaries', () => {
    expect(normalizeSubtitleText('  hello   world  ')).toBe('hello world');
  });

  it('normalizes chinese punctuation spacing', () => {
    expect(normalizeSubtitleText('你好 ， 世界 ！')).toBe('你好，世界！');
  });
});

describe('buildSubtitleCuesFromWords', () => {
  it('splits cues when there is a long silence gap', () => {
    const words = [
      w('hello', 0, 240),
      w('team', 260, 520),
      w('next', 1_900, 2_140),
    ];

    const cues = buildSubtitleCuesFromWords(words, {
      minCueDurationMs: 600,
      maxCueDurationMs: 3_000,
      splitOnSilenceMs: 600,
      maxCharsPerLine: 14,
      maxLines: 2,
      maxCps: 14,
    });

    expect(cues).toHaveLength(2);
    expect(cues[0].text).toContain('hello');
    expect(cues[0].text).toContain('team');
    expect(cues[1].text).toContain('next');
    expect(cues[0].endMs).toBeLessThanOrEqual(cues[1].startMs);
  });

  it('limits cue text length using line width and cps constraints', () => {
    const words = [
      w('this', 0, 140),
      w('is', 150, 260),
      w('a', 270, 340),
      w('very', 350, 520),
      w('long', 530, 710),
      w('sentence', 720, 1_020),
      w('for', 1_030, 1_180),
      w('testing', 1_190, 1_470),
    ];

    const cues = buildSubtitleCuesFromWords(words, {
      minCueDurationMs: 700,
      maxCueDurationMs: 1_500,
      splitOnSilenceMs: 900,
      maxCharsPerLine: 10,
      maxLines: 1,
      maxCps: 8,
    });

    expect(cues.length).toBeGreaterThan(1);
    for (const cue of cues) {
      expect(cue.text.length).toBeLessThanOrEqual(10);
      const durationSeconds = Math.max(0.001, (cue.endMs - cue.startMs) / 1_000);
      expect(cue.text.length / durationSeconds).toBeLessThanOrEqual(8.5);
    }
  });

  it('clamps cue durations to configured minimum and maximum', () => {
    const words = [
      w('alpha', 0, 120),
      w('beta', 130, 250),
      w('gamma', 260, 380),
    ];

    const cues = buildSubtitleCuesFromWords(words, {
      minCueDurationMs: 900,
      maxCueDurationMs: 1_000,
      splitOnSilenceMs: 700,
      maxCharsPerLine: 20,
      maxLines: 2,
      maxCps: 20,
    });

    expect(cues).toHaveLength(1);
    expect(cues[0].endMs - cues[0].startMs).toBeGreaterThanOrEqual(900);
    expect(cues[0].endMs - cues[0].startMs).toBeLessThanOrEqual(1_000);
  });
});
