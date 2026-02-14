import { describe, expect, it } from 'vitest';
import { applyRoughCutSuggestionsToTrimRegions } from './roughCutApply';
import type { TrimRegion } from '@/components/video-editor/types';
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
