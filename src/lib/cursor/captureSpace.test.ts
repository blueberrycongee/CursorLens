import { describe, expect, it } from 'vitest';

import {
  isPointInsideBounds,
  normalizePointToBounds,
  resolveCursorBoundsForSource,
  resolveVirtualDesktopBounds,
  type CaptureDisplay,
} from './captureSpace';

const displays: CaptureDisplay[] = [
  { id: 101, bounds: { x: 0, y: 0, width: 1512, height: 982 } },
  { id: 202, bounds: { x: 1512, y: 0, width: 1920, height: 1080 } },
];

describe('captureSpace', () => {
  it('resolves virtual desktop bounds across multiple displays', () => {
    expect(resolveVirtualDesktopBounds(displays)).toEqual({
      x: 0,
      y: 0,
      width: 3432,
      height: 1080,
    });
  });

  it('resolves source display by display_id when available', () => {
    const resolved = resolveCursorBoundsForSource({
      displays,
      source: {
        id: 'screen:0:0',
        display_id: '202',
      },
      pointHint: { x: 1700, y: 420 },
    });

    expect(resolved.mode).toBe('source-display');
    expect(resolved.displayId).toBe('202');
    expect(resolved.bounds).toEqual(displays[1].bounds);
  });

  it('falls back to nearest display when source has no display_id', () => {
    const resolved = resolveCursorBoundsForSource({
      displays,
      source: { id: 'window:552:0' },
      pointHint: { x: 1200, y: 300 },
    });

    expect(resolved.mode).toBe('source-display');
    expect(resolved.bounds).toEqual(displays[0].bounds);
  });

  it('normalizes and clamps coordinates inside bounds', () => {
    const normalized = normalizePointToBounds(
      { x: 1700, y: 540 },
      { x: 1512, y: 0, width: 1920, height: 1080 },
    );

    expect(normalized.x).toBeCloseTo(0.0979, 3);
    expect(normalized.y).toBeCloseTo(0.5, 3);
  });

  it('clamps coordinates outside bounds to 0..1', () => {
    const normalized = normalizePointToBounds(
      { x: -100, y: 2000 },
      { x: 0, y: 0, width: 1000, height: 1000 },
    );

    expect(normalized).toEqual({ x: 0, y: 1 });
  });

  it('checks if point is inside bounds with optional padding', () => {
    const bounds = { x: 100, y: 50, width: 300, height: 200 };
    expect(isPointInsideBounds({ x: 120, y: 80 }, bounds)).toBe(true);
    expect(isPointInsideBounds({ x: 420, y: 80 }, bounds)).toBe(false);
    expect(isPointInsideBounds({ x: 420, y: 80 }, bounds, 25)).toBe(true);
  });
});
