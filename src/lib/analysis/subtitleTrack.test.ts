import { describe, expect, it } from 'vitest';
import { findSubtitleCueAtTime, normalizeSubtitleCues } from './subtitleTrack';
import type { SubtitleCue } from './types';

function cue(id: string, startMs: number, endMs: number, text: string): SubtitleCue {
  return {
    id,
    startMs,
    endMs,
    text,
    source: 'asr',
  };
}

describe('subtitleTrack', () => {
  it('normalizes, sorts and filters invalid cues', () => {
    const normalized = normalizeSubtitleCues([
      cue('3', 1200, 1500, 'third'),
      cue('1', 100, 500, 'first'),
      cue('2', 600, 600, 'invalid'),
      cue('4', 700, 900, 'second'),
    ]);

    expect(normalized.map((item) => item.id)).toEqual(['1', '4', '3']);
  });

  it('finds active cue with binary search boundaries', () => {
    const cues = normalizeSubtitleCues([
      cue('1', 0, 300, 'alpha'),
      cue('2', 300, 600, 'beta'),
      cue('3', 600, 900, 'gamma'),
    ]);

    expect(findSubtitleCueAtTime(cues, -1)?.id).toBeUndefined();
    expect(findSubtitleCueAtTime(cues, 0)?.id).toBe('1');
    expect(findSubtitleCueAtTime(cues, 299)?.id).toBe('1');
    expect(findSubtitleCueAtTime(cues, 300)?.id).toBe('2');
    expect(findSubtitleCueAtTime(cues, 899)?.id).toBe('3');
    expect(findSubtitleCueAtTime(cues, 900)?.id).toBeUndefined();
  });
});
