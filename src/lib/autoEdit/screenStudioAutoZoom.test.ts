import { describe, expect, it } from 'vitest';
import type { CursorTrack } from '@/lib/cursor';
import { generateAutoZoomDrafts } from './screenStudioAutoZoom';

function trackFrom(samples: CursorTrack['samples']): CursorTrack {
  return {
    source: 'recorded',
    samples,
  };
}

function trackFromWithEvents(
  samples: CursorTrack['samples'],
  events: NonNullable<CursorTrack['events']>,
): CursorTrack {
  return {
    source: 'recorded',
    samples,
    events,
  };
}

describe('screenStudioAutoZoom', () => {
  it('generates click-first auto zoom regions with pre-roll', () => {
    const track = trackFrom([
      { timeMs: 0, x: 0.2, y: 0.3, visible: true },
      { timeMs: 350, x: 0.22, y: 0.31, visible: true, click: true },
      { timeMs: 700, x: 0.25, y: 0.34, visible: true },
    ]);

    const drafts = generateAutoZoomDrafts(track, { durationMs: 2_000 });
    expect(drafts).toHaveLength(1);
    expect(drafts[0].reason).toBe('click');
    expect(drafts[0].startMs).toBe(130);
    expect(drafts[0].endMs).toBe(1_750);
    expect(drafts[0].depth).toBe(3);
    expect(drafts[0].focus.cx).toBeCloseTo(0.22, 4);
    expect(drafts[0].focus.cy).toBeCloseTo(0.31, 4);
  });

  it('merges dense click candidates into one continuous region', () => {
    const track = trackFrom([
      { timeMs: 120, x: 0.3, y: 0.3, visible: true, click: true },
      { timeMs: 400, x: 0.31, y: 0.33, visible: true, click: true },
      { timeMs: 1_200, x: 0.5, y: 0.4, visible: true },
    ]);

    const drafts = generateAutoZoomDrafts(track, { durationMs: 2_000 });
    expect(drafts).toHaveLength(1);
    expect(drafts[0].startMs).toBe(0);
    expect(drafts[0].endMs).toBe(1_800);
  });

  it('falls back to movement-driven auto zoom when no clicks are present', () => {
    const track = trackFrom([
      { timeMs: 0, x: 0.1, y: 0.1, visible: true },
      { timeMs: 100, x: 0.4, y: 0.42, visible: true },
      { timeMs: 240, x: 0.42, y: 0.44, visible: true },
      { timeMs: 400, x: 0.43, y: 0.45, visible: true },
      { timeMs: 1_100, x: 0.44, y: 0.46, visible: true },
    ]);

    const drafts = generateAutoZoomDrafts(track, { durationMs: 2_000 });
    expect(drafts.length).toBeGreaterThan(0);
    expect(drafts[0].reason).toBe('movement');
    expect(drafts[0].depth).toBe(2);
  });

  it('respects max region cap', () => {
    const samples: CursorTrack['samples'] = [];
    for (let index = 0; index < 10; index += 1) {
      samples.push({
        timeMs: index * 2_200 + 300,
        x: 0.2 + index * 0.03,
        y: 0.3,
        click: true,
        visible: true,
      });
    }

    const drafts = generateAutoZoomDrafts(trackFrom(samples), {
      durationMs: 24_000,
      maxRegions: 4,
    });

    expect(drafts).toHaveLength(4);
  });

  it('uses recorded click events as focus anchors when present', () => {
    const track = trackFromWithEvents(
      [
        { timeMs: 0, x: 0.1, y: 0.1, visible: true },
        { timeMs: 600, x: 0.16, y: 0.16, visible: true },
        { timeMs: 1_000, x: 0.2, y: 0.2, visible: true },
      ],
      [
        {
          type: 'click',
          startMs: 340,
          endMs: 360,
          point: { x: 0.62, y: 0.41 },
        },
      ],
    );

    const drafts = generateAutoZoomDrafts(track, { durationMs: 2_000 });
    expect(drafts).toHaveLength(1);
    expect(drafts[0].reason).toBe('click');
    expect(drafts[0].startMs).toBe(120);
    expect(drafts[0].endMs).toBe(1_760);
    expect(drafts[0].focus.cx).toBeCloseTo(0.62, 4);
    expect(drafts[0].focus.cy).toBeCloseTo(0.41, 4);
  });

  it('creates longer hold regions for selection events around selection center', () => {
    const track = trackFromWithEvents(
      [
        { timeMs: 0, x: 0.2, y: 0.2, visible: true },
        { timeMs: 800, x: 0.3, y: 0.4, visible: true },
        { timeMs: 1_600, x: 0.55, y: 0.6, visible: true },
        { timeMs: 2_000, x: 0.58, y: 0.62, visible: true },
      ],
      [
        {
          type: 'selection',
          startMs: 500,
          endMs: 1_500,
          point: { x: 0.46, y: 0.52 },
          bounds: {
            minX: 0.24,
            minY: 0.36,
            maxX: 0.68,
            maxY: 0.78,
            width: 0.44,
            height: 0.42,
          },
        },
      ],
    );

    const drafts = generateAutoZoomDrafts(track, { durationMs: 6_000 });
    expect(drafts).toHaveLength(1);
    expect(drafts[0].reason).toBe('selection');
    expect(drafts[0].startMs).toBe(380);
    expect(drafts[0].endMs).toBeGreaterThan(4_800);
    expect(drafts[0].focus.cx).toBeCloseTo(0.46, 4);
    expect(drafts[0].focus.cy).toBeCloseTo(0.52, 4);
  });

  it('returns empty list for invalid or too short input', () => {
    expect(generateAutoZoomDrafts(null, { durationMs: 10_000 })).toEqual([]);
    expect(generateAutoZoomDrafts(trackFrom([]), { durationMs: 10_000 })).toEqual([]);
    expect(
      generateAutoZoomDrafts(
        trackFrom([{ timeMs: 0, x: 0.5, y: 0.5, visible: true }]),
        { durationMs: 100 },
      ),
    ).toEqual([]);
  });
});
