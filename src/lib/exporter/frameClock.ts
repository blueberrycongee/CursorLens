const MICROSECONDS_PER_SECOND = 1_000_000;

export function normalizeFrameRate(frameRate: number, fallback = 60): number {
  if (!Number.isFinite(frameRate) || frameRate <= 0) {
    return fallback;
  }

  return Math.max(1, Math.min(240, Math.round(frameRate)));
}

export function frameIndexToTimestampUs(frameIndex: number, frameRate: number): number {
  const fps = normalizeFrameRate(frameRate);
  const index = Math.max(0, Math.floor(frameIndex));
  return Math.round((index * MICROSECONDS_PER_SECOND) / fps);
}

export function frameDurationUs(frameIndex: number, frameRate: number): number {
  const start = frameIndexToTimestampUs(frameIndex, frameRate);
  const end = frameIndexToTimestampUs(frameIndex + 1, frameRate);
  return Math.max(1, end - start);
}
