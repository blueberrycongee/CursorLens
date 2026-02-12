import { describe, expect, it } from "vitest";
import { getSeekToleranceSeconds, shouldSeekToTime } from "./videoExporter";

describe("videoExporter seek helpers", () => {
  it("uses half-frame tolerance at common frame rates", () => {
    expect(getSeekToleranceSeconds(60)).toBeCloseTo(1 / 120, 6);
    expect(getSeekToleranceSeconds(30)).toBeCloseTo(1 / 60, 6);
  });

  it("clamps tolerance for high frame rates", () => {
    expect(getSeekToleranceSeconds(240)).toBeCloseTo(1 / 240, 6);
    expect(getSeekToleranceSeconds(120)).toBeCloseTo(1 / 240, 6);
  });

  it("falls back to a safe default when frame rate is invalid", () => {
    expect(getSeekToleranceSeconds(0)).toBeCloseTo(1 / 120, 6);
    expect(getSeekToleranceSeconds(Number.NaN)).toBeCloseTo(1 / 120, 6);
  });

  it("only seeks when current time drifts beyond tolerance", () => {
    const frameRate = 60;
    const target = 10;
    const tolerance = getSeekToleranceSeconds(frameRate);

    expect(shouldSeekToTime(target, target + tolerance * 0.9, frameRate)).toBe(false);
    expect(shouldSeekToTime(target, target + tolerance * 1.1, frameRate)).toBe(true);
  });
});
