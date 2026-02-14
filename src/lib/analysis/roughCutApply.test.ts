import { describe, expect, it } from 'vitest';
import { applyRoughCutSuggestionsToAudioEdits, applyRoughCutSuggestionsToTrimRegions } from './roughCutApply';
import type { AudioEditRegion, TrimRegion } from '@/components/video-editor/types';
import type { RoughCutSuggestion } from './types';

const trim = (id: string, startMs: number, endMs: number): TrimRegion => ({ id, startMs, endMs });
const suggestion = (id: string, startMs: number, endMs: number): RoughCutSuggestion => ({
  id,
  startMs,
  endMs,
  reason: 'silence',
  confidence: 0.8,
  label: 'silence',
});
const audioEdit = (id: string, startMs: number, endMs: number, gain = 0): AudioEditRegion => ({
  id,
  startMs,
  endMs,
  gain,
  mode: gain <= 0 ? 'mute' : 'duck',
  source: 'manual',
});

describe('applyRoughCutSuggestionsToTrimRegions', () => {
  it('merges suggestions with existing trim regions and normalizes overlap', () => {
    const existing = [trim('t1', 200, 400)];
    const suggestions = [
      suggestion('s1', 390, 600),
      suggestion('s2', 800, 1_000),
    ];

    const next = applyRoughCutSuggestionsToTrimRegions(existing, suggestions, 2_000);

    expect(next).toHaveLength(2);
    expect(next[0].startMs).toBe(200);
    expect(next[0].endMs).toBe(600);
    expect(next[1].startMs).toBe(800);
    expect(next[1].endMs).toBe(1_000);
  });

  it('returns unchanged regions when suggestions are empty', () => {
    const existing = [trim('t1', 120, 220)];
    const next = applyRoughCutSuggestionsToTrimRegions(existing, [], 1_000);
    expect(next).toEqual(existing);
  });
});

describe('applyRoughCutSuggestionsToAudioEdits', () => {
  it('writes rough cut suggestions into audio edit regions without deleting timeline video', () => {
    const existing = [audioEdit('a1', 100, 180, 0.3)];
    const suggestions = [
      suggestion('s1', 170, 250),
      suggestion('s2', 400, 500),
    ];

    const next = applyRoughCutSuggestionsToAudioEdits(existing, suggestions, 2_000);

    expect(next).toHaveLength(3);
    expect(next[0].startMs).toBe(100);
    expect(next[0].endMs).toBe(180);
    expect(next[0].gain).toBe(0.3);
    expect(next[1].startMs).toBe(170);
    expect(next[1].endMs).toBe(250);
    expect(next[1].gain).toBe(0);
    expect(next[1].mode).toBe('mute');
    expect(next[2].startMs).toBe(400);
    expect(next[2].endMs).toBe(500);
  });

  it('keeps previous audio edits normalized when suggestions are empty', () => {
    const existing = [audioEdit('a1', -100, 80, 0)];
    const next = applyRoughCutSuggestionsToAudioEdits(existing, [], 1_000);
    expect(next).toHaveLength(1);
    expect(next[0].startMs).toBe(0);
    expect(next[0].endMs).toBe(80);
  });
});
