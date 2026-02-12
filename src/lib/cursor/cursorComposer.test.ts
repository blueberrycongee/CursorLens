import { describe, expect, it } from 'vitest';
import { DEFAULT_CURSOR_STYLE, type CursorTrack } from './types';
import { normalizePointerSample, projectCursorToViewport, resolveCursorState } from './cursorComposer';

describe('cursorComposer', () => {
  it('interpolates and smooths recorded cursor track', () => {
    const track: CursorTrack = {
      source: 'recorded',
      samples: [
        { timeMs: 0, x: 0.1, y: 0.1, visible: true },
        { timeMs: 100, x: 0.2, y: 0.2, visible: true },
        { timeMs: 200, x: 0.4, y: 0.4, visible: true },
      ],
    };

    const state = resolveCursorState({
      timeMs: 100,
      track,
      style: { ...DEFAULT_CURSOR_STYLE, smoothingMs: 0 },
    });

    expect(state.visible).toBe(true);
    expect(state.x).toBeCloseTo(0.2, 2);
    expect(state.y).toBeCloseTo(0.2, 2);
  });

  it('uses fallback focus when no cursor track exists', () => {
    const state = resolveCursorState({
      timeMs: 100,
      track: { samples: [] },
      zoomRegions: [],
      fallbackFocus: { cx: 0.62, cy: 0.34 },
    });

    expect(state.x).toBeCloseTo(0.62, 3);
    expect(state.y).toBeCloseTo(0.34, 3);
    expect(state.visible).toBe(false);
  });

  it('projects normalized point through crop and camera transform', () => {
    const projected = projectCursorToViewport({
      normalizedX: 0.5,
      normalizedY: 0.5,
      cropRegion: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
      baseOffset: { x: 100, y: 50 },
      maskRect: { width: 800, height: 400 },
      cameraScale: { x: 1.2, y: 1.2 },
      cameraPosition: { x: -40, y: 20 },
      stageSize: { width: 1280, height: 720 },
    });

    expect(projected.x).toBeCloseTo(560, 2);
    expect(projected.y).toBeCloseTo(320, 2);
    expect(projected.inViewport).toBe(true);
  });

  it('normalizes pointer samples to 0..1', () => {
    const sample = normalizePointerSample(16, 960, 540, 1920, 1080, true);
    expect(sample.x).toBe(0.5);
    expect(sample.y).toBe(0.5);
    expect(sample.click).toBe(true);
  });
});
