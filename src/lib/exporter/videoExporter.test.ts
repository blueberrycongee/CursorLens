import { describe, expect, it } from "vitest";
import {
  buildAudioGainSegments,
  buildKeptRanges,
  clampAudioGain,
  VideoExporter,
  estimateRemainingSeconds,
  getSeekToleranceSeconds,
  normalizeTrimRanges,
  shouldSeekToTime,
  withTimeout,
} from "./videoExporter";

describe("videoExporter seek helpers", () => {
  it("normalizes and merges overlapping trim ranges", () => {
    const merged = normalizeTrimRanges(
      [
        { id: "a", startMs: 200, endMs: 400 },
        { id: "b", startMs: 300, endMs: 700 },
        { id: "c", startMs: -100, endMs: 100 },
      ],
      1000,
    );

    expect(merged).toEqual([
      { startMs: 0, endMs: 100 },
      { startMs: 200, endMs: 700 },
    ]);
  });

  it("builds kept ranges by subtracting trim ranges", () => {
    const kept = buildKeptRanges(
      1000,
      [
        { id: "a", startMs: 100, endMs: 300 },
        { id: "b", startMs: 500, endMs: 600 },
      ],
    );

    expect(kept).toEqual([
      { startMs: 0, endMs: 100 },
      { startMs: 300, endMs: 500 },
      { startMs: 600, endMs: 1000 },
    ]);
  });

  it("builds per-range audio gain segments from rough-cut edits", () => {
    const segments = buildAudioGainSegments(
      50,
      260,
      1,
      [
        { id: "a", startMs: 100, endMs: 200, mode: "mute", gain: 0 },
        { id: "b", startMs: 150, endMs: 250, mode: "duck", gain: 0.5 },
      ],
    );

    expect(segments).toEqual([
      { startMs: 50, endMs: 100, gain: 1 },
      { startMs: 100, endMs: 150, gain: 0 },
      { startMs: 150, endMs: 200, gain: 0 },
      { startMs: 200, endMs: 250, gain: 0.5 },
      { startMs: 250, endMs: 260, gain: 1 },
    ]);
  });

  it("applies region multiplier on top of base gain", () => {
    const segments = buildAudioGainSegments(
      0,
      1000,
      0.8,
      [{ id: "d1", startMs: 100, endMs: 400, mode: "duck", gain: 0.5 }],
    );

    expect(segments).toEqual([
      { startMs: 0, endMs: 100, gain: 0.8 },
      { startMs: 100, endMs: 400, gain: 0.4 },
      { startMs: 400, endMs: 1000, gain: 0.8 },
    ]);
  });

  it("clamps audio gain to supported bounds", () => {
    expect(clampAudioGain(undefined)).toBe(1);
    expect(clampAudioGain(-2)).toBe(0);
    expect(clampAudioGain(0.5)).toBe(0.5);
    expect(clampAudioGain(9)).toBe(2);
  });

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

  it("resolves values when timeout is not exceeded", async () => {
    await expect(withTimeout(Promise.resolve("ok"), 50, "test")).resolves.toBe("ok");
  });

  it("rejects when timeout is exceeded", async () => {
    const never = new Promise<void>(() => {});
    await expect(withTimeout(never, 10, "test-timeout")).rejects.toThrow("test-timeout timed out");
  });

  it("estimates remaining time from current throughput", () => {
    // 60 frames in 3s => 20fps, remain 60 frames => ~3s
    expect(estimateRemainingSeconds(60, 120, 3000)).toBe(3);
  });

  it("returns zero eta for invalid or terminal progress", () => {
    expect(estimateRemainingSeconds(0, 120, 3000)).toBe(0);
    expect(estimateRemainingSeconds(120, 120, 3000)).toBe(0);
    expect(estimateRemainingSeconds(80, 60, 3000)).toBe(0);
    expect(estimateRemainingSeconds(50, 120, Number.NaN)).toBe(0);
  });

  describe("buildKeptRanges boundary cases", () => {
    it("returns full range when no trims", () => {
      expect(buildKeptRanges(5000, undefined)).toEqual([{ startMs: 0, endMs: 5000 }]);
      expect(buildKeptRanges(5000, [])).toEqual([{ startMs: 0, endMs: 5000 }]);
    });

    it("returns empty when trim covers entire duration", () => {
      expect(buildKeptRanges(1000, [{ id: "a", startMs: 0, endMs: 1000 }])).toEqual([]);
    });

    it("returns empty for zero, NaN, or negative totalDurationMs", () => {
      expect(buildKeptRanges(0, undefined)).toEqual([]);
      expect(buildKeptRanges(Number.NaN, undefined)).toEqual([]);
      expect(buildKeptRanges(-100, undefined)).toEqual([]);
    });
  });

  describe("buildAudioGainSegments boundary cases", () => {
    it("returns single segment with baseGain when no audioEditRegions", () => {
      expect(buildAudioGainSegments(0, 1000, 0.8, undefined)).toEqual([
        { startMs: 0, endMs: 1000, gain: 0.8 },
      ]);
      expect(buildAudioGainSegments(0, 1000, 0.8, [])).toEqual([
        { startMs: 0, endMs: 1000, gain: 0.8 },
      ]);
    });

    it("returns empty when rangeStart equals rangeEnd", () => {
      expect(buildAudioGainSegments(500, 500, 1, undefined)).toEqual([]);
    });

    it("swaps inverted range and returns a valid segment", () => {
      // Implementation normalises: safeStart=min(600,400)=400, safeEnd=max(600,400)=600
      expect(buildAudioGainSegments(600, 400, 1, undefined)).toEqual([
        { startMs: 400, endMs: 600, gain: 1 },
      ]);
    });

    it("falls back to default gain 1 for NaN or undefined baseGain", () => {
      const result1 = buildAudioGainSegments(0, 100, Number.NaN, undefined);
      expect(result1).toEqual([{ startMs: 0, endMs: 100, gain: 1 }]);

      const result2 = buildAudioGainSegments(0, 100, undefined as any, undefined);
      expect(result2).toEqual([{ startMs: 0, endMs: 100, gain: 1 }]);
    });
  });

  describe("samplingMode constraint", () => {
    it("samplingMode is always seek-only", () => {
      const exporter = new VideoExporter({
        videoUrl: "file:///tmp/mock.webm",
        width: 1920,
        height: 1080,
        frameRate: 60,
        bitrate: 20_000_000,
        wallpaper: "#000",
        zoomRegions: [],
        cropRegion: { x: 0, y: 0, width: 1, height: 1 },
        showShadow: false,
        shadowIntensity: 0,
        showBlur: false,
      }) as any;

      expect(exporter.samplingMode).toBe("seek-only");
    });
  });

  it("does not call play() in seek-only frame export path", async () => {
    const exporter = new VideoExporter({
      videoUrl: "file:///tmp/mock.webm",
      width: 1920,
      height: 1080,
      frameRate: 60,
      bitrate: 20_000_000,
      wallpaper: "#000",
      zoomRegions: [],
      cropRegion: { x: 0, y: 0, width: 1, height: 1 },
      showShadow: false,
      shadowIntensity: 0,
      showBlur: false,
      trimRegions: [],
      annotationRegions: [],
    }) as any;

    let playCalls = 0;
    let seekCalls = 0;
    let rendered = 0;

    const video: any = {
      currentTime: 0,
      duration: 10,
      paused: true,
      muted: false,
      volume: 1,
      play() {
        playCalls += 1;
        this.paused = false;
        return Promise.resolve();
      },
    };

    exporter.seekVideoTo = async (vid: any, target: number) => {
      seekCalls += 1;
      vid.currentTime = target;
    };
    exporter.renderAndEncodeFrame = async () => {
      rendered += 1;
    };

    const result = await exporter.exportFramesBySeeking(video, 90);

    expect(result).toBe(90);
    expect(rendered).toBe(90);
    expect(seekCalls).toBe(90);
    expect(playCalls).toBe(0);
  });
});
