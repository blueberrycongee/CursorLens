import { describe, expect, it } from "vitest";
import {
  dbToLinear,
  linearToDb,
  normalizeExportAudioProcessingConfig,
  resolveExportAudioNormalizationGain,
} from "./exportAudioProcessing";

describe("exportAudioProcessing", () => {
  it("normalizes config with safe defaults", () => {
    const normalized = normalizeExportAudioProcessingConfig();
    expect(normalized.normalizeLoudness).toBe(true);
    expect(normalized.targetLufs).toBe(-16);
    expect(normalized.limiterDb).toBe(-1);
    expect(normalized.limiterLinear).toBeCloseTo(dbToLinear(-1), 6);
  });

  it("clamps out-of-range config values", () => {
    const normalized = normalizeExportAudioProcessingConfig({
      targetLufs: -50,
      limiterDb: 3,
      maxBoostDb: 99,
      maxCutDb: -3,
    });
    expect(normalized.targetLufs).toBe(-32);
    expect(normalized.limiterDb).toBe(-0.1);
    expect(normalized.maxBoostDb).toBe(24);
    expect(normalized.maxCutDb).toBe(0);
  });

  it("resolves normalization gain towards target loudness", () => {
    const processing = normalizeExportAudioProcessingConfig({
      targetLufs: -16,
      limiterDb: -1,
      maxBoostDb: 12,
      maxCutDb: 12,
    });
    const stats = {
      sampleCount: 48_000,
      sumSquares: 48_000 * Math.pow(dbToLinear(-24), 2),
      peakAbs: dbToLinear(-20),
    };
    const resolved = resolveExportAudioNormalizationGain({ stats, processing });

    expect(resolved.measuredLufs).toBeCloseTo(-24, 1);
    expect(linearToDb(resolved.normalizationGain)).toBeCloseTo(8, 1);
    expect(resolved.limiterCompensationGain).toBe(1);
    expect(resolved.appliedGain).toBeGreaterThan(1);
  });

  it("applies limiter compensation when predicted peak would clip", () => {
    const processing = normalizeExportAudioProcessingConfig({
      targetLufs: -16,
      limiterDb: -1,
      maxBoostDb: 12,
      maxCutDb: 12,
    });
    const stats = {
      sampleCount: 48_000,
      sumSquares: 48_000 * Math.pow(dbToLinear(-24), 2),
      peakAbs: 0.95,
    };
    const resolved = resolveExportAudioNormalizationGain({ stats, processing });

    expect(resolved.normalizationGain).toBeGreaterThan(1);
    expect(resolved.limiterCompensationGain).toBeLessThan(1);
    expect(stats.peakAbs * resolved.appliedGain).toBeLessThanOrEqual(processing.limiterLinear + 1e-6);
  });

  it("returns identity when normalization is disabled", () => {
    const processing = normalizeExportAudioProcessingConfig({ normalizeLoudness: false });
    const resolved = resolveExportAudioNormalizationGain({
      stats: { sampleCount: 120, sumSquares: 1, peakAbs: 0.9 },
      processing,
    });
    expect(resolved.measuredLufs).toBeNull();
    expect(resolved.appliedGain).toBe(1);
  });
});
