import { describe, expect, it } from "vitest";
import {
  buildKeptRanges,
  clampAudioGain,
  VideoExporter,
  estimateRemainingSeconds,
  getSeekToleranceSeconds,
  hasRecordedCursorSamples,
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

  it("detects recorded cursor tracks for export sampling strategy", () => {
    expect(hasRecordedCursorSamples(null)).toBe(false);
    expect(hasRecordedCursorSamples({ source: "recorded", samples: [] })).toBe(false);
    expect(
      hasRecordedCursorSamples({
        source: "recorded",
        samples: [{ timeMs: 0, x: 0.1, y: 0.2 }],
      }),
    ).toBe(true);
  });

  it("uses continuous playback sampling without per-frame play/pause churn", async () => {
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
    let pauseCalls = 0;
    let seekCalls = 0;
    let rendered = 0;

    const video: any = {
      currentTime: 0,
      playbackRate: 1,
      paused: true,
      muted: false,
      volume: 0.7,
      ended: false,
      pause() {
        pauseCalls += 1;
        this.paused = true;
      },
      async play() {
        playCalls += 1;
        this.paused = false;
      },
    };

    exporter.waitForVideoFrame = async (vid: any) => {
      if (!vid.paused) {
        vid.currentTime += 1 / 60;
      } else {
        vid.currentTime += 1 / 60;
      }
      if (vid.currentTime > 5) {
        vid.ended = true;
      }
    };
    exporter.renderAndEncodeFrame = async () => {
      rendered += 1;
    };
    exporter.seekVideoTo = async (vid: any, target: number) => {
      seekCalls += 1;
      vid.currentTime = target;
    };

    const result = await exporter.exportFramesWithPlaybackSampling(video, 120);
    expect(result).toBe(120);
    expect(rendered).toBe(120);
    expect(playCalls).toBe(1);
    expect(pauseCalls).toBeLessThanOrEqual(3);
    expect(seekCalls).toBeLessThan(10);
    expect(video.muted).toBe(false);
    expect(video.volume).toBeCloseTo(0.7);
  });
});
