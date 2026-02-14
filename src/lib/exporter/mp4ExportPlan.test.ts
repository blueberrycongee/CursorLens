import { describe, expect, it } from 'vitest';
import { calculateMp4ExportPlan, resolveExportFrameRate } from './mp4ExportPlan';

describe('mp4ExportPlan', () => {
  it('keeps source frame rate for source quality', () => {
    expect(resolveExportFrameRate(120, 'source')).toBe(120);
    expect(resolveExportFrameRate(15, 'source')).toBe(24);
  });

  it('caps non-source quality frame rate to 60fps', () => {
    expect(resolveExportFrameRate(120, 'good')).toBe(60);
    expect(resolveExportFrameRate(144, 'medium')).toBe(60);
  });

  it('uses preset resolution when source is sufficient', () => {
    const plan = calculateMp4ExportPlan({
      quality: 'good',
      aspectRatio: 16 / 9,
      sourceWidth: 3840,
      sourceHeight: 2160,
      sourceFrameRate: 60,
    });

    expect(plan.width).toBe(1920);
    expect(plan.height).toBe(1080);
    expect(plan.limitedBySource).toBe(false);
  });

  it('never upscales when source is below quality preset target', () => {
    const plan = calculateMp4ExportPlan({
      quality: 'good',
      aspectRatio: 16 / 9,
      sourceWidth: 992,
      sourceHeight: 558,
      sourceFrameRate: 120,
    });

    expect(plan.width).toBeLessThanOrEqual(992);
    expect(plan.height).toBeLessThanOrEqual(558);
    expect(plan.limitedBySource).toBe(true);
    expect(plan.frameRate).toBe(60);
  });

  it('matches source-bounded dimensions for source quality', () => {
    const plan = calculateMp4ExportPlan({
      quality: 'source',
      aspectRatio: 16 / 9,
      sourceWidth: 1919,
      sourceHeight: 1081,
      sourceFrameRate: 120,
    });

    expect(plan.width % 2).toBe(0);
    expect(plan.height % 2).toBe(0);
    expect(plan.width).toBeLessThanOrEqual(1918);
    expect(plan.height).toBeLessThanOrEqual(1080);
    expect(plan.limitedBySource).toBe(false);
    expect(plan.frameRate).toBe(120);
  });

  it('increases bitrate with higher frame rate under same quality and resolution', () => {
    const lowFps = calculateMp4ExportPlan({
      quality: 'good',
      aspectRatio: 16 / 9,
      sourceWidth: 3840,
      sourceHeight: 2160,
      sourceFrameRate: 30,
    });
    const highFps = calculateMp4ExportPlan({
      quality: 'good',
      aspectRatio: 16 / 9,
      sourceWidth: 3840,
      sourceHeight: 2160,
      sourceFrameRate: 60,
    });

    expect(highFps.bitrate).toBeGreaterThan(lowFps.bitrate);
  });
});
