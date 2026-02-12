import { describe, expect, it } from 'vitest';
import { frameDurationUs, frameIndexToTimestampUs, normalizeFrameRate } from './frameClock';

describe('frameClock', () => {
  it('normalizes invalid frame rates to fallback', () => {
    expect(normalizeFrameRate(Number.NaN)).toBe(60);
    expect(normalizeFrameRate(0)).toBe(60);
    expect(normalizeFrameRate(-10)).toBe(60);
  });

  it('clamps frame rates to supported range', () => {
    expect(normalizeFrameRate(1000)).toBe(240);
    expect(normalizeFrameRate(59.7)).toBe(60);
    expect(normalizeFrameRate(23.4)).toBe(23);
  });

  it('produces strictly increasing integer timestamps', () => {
    let last = -1;

    for (let i = 0; i < 10_000; i++) {
      const timestamp = frameIndexToTimestampUs(i, 60);
      expect(Number.isInteger(timestamp)).toBe(true);
      expect(timestamp).toBeGreaterThan(last);
      last = timestamp;
    }
  });

  it('maintains bounded drift against ideal timeline', () => {
    const fps = 60;
    const frameCount = 12_000;
    const endTimestamp = frameIndexToTimestampUs(frameCount, fps);
    const ideal = (frameCount / fps) * 1_000_000;

    expect(Math.abs(endTimestamp - ideal)).toBeLessThanOrEqual(1);
  });

  it('never emits zero or negative frame durations', () => {
    for (let i = 0; i < 5000; i++) {
      expect(frameDurationUs(i, 120)).toBeGreaterThan(0);
    }
  });
});
