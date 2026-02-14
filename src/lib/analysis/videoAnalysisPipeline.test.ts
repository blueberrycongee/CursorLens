import { describe, expect, it } from 'vitest';
import { buildVideoAnalysisResult } from './videoAnalysisPipeline';
import type { TranscriptWord } from './types';

function w(text: string, startMs: number, endMs: number): TranscriptWord {
  return { text, startMs, endMs, confidence: 0.8 };
}

describe('buildVideoAnalysisResult', () => {
  it('creates subtitles and rough cut suggestions from transcript words', () => {
    const words = [
      w('hello', 0, 200),
      w('um', 240, 360),
      w('team', 420, 580),
      w('next', 2_100, 2_260),
    ];

    const result = buildVideoAnalysisResult(words, {
      durationMs: 3_000,
      videoWidth: 1920,
      subtitleWidthRatio: 0.82,
      locale: 'en-US',
    });

    expect(result.subtitleCues.length).toBeGreaterThan(0);
    expect(result.roughCutSuggestions.length).toBeGreaterThan(0);
    expect(result.transcript.words).toHaveLength(4);
    expect(result.transcript.locale).toBe('en-US');
  });
});
