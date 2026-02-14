import type { ExportQuality } from './types';

export interface Mp4ExportPlanInput {
  quality: ExportQuality;
  aspectRatio: number;
  sourceWidth: number;
  sourceHeight: number;
  sourceFrameRate?: number;
}

export interface Mp4ExportPlan {
  width: number;
  height: number;
  bitrate: number;
  frameRate: number;
  limitedBySource: boolean;
}

type Dimensions = {
  width: number;
  height: number;
};

const DEFAULT_ASPECT_RATIO = 16 / 9;

const QUALITY_TARGET_HEIGHT: Record<Exclude<ExportQuality, 'source'>, number> = {
  medium: 720,
  good: 1080,
};

const BITRATE_BPP_PER_FRAME: Record<ExportQuality, number> = {
  medium: 0.08,
  good: 0.11,
  source: 0.14,
};

const BITRATE_LIMITS: Record<ExportQuality, { min: number; max: number }> = {
  medium: { min: 6_000_000, max: 18_000_000 },
  good: { min: 10_000_000, max: 35_000_000 },
  source: { min: 12_000_000, max: 90_000_000 },
};

function normalizeDimension(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.max(2, Math.floor(value / 2) * 2);
}

function normalizeAspectRatio(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_ASPECT_RATIO;
  return value;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function fitAspectRatioWithinBounds(aspectRatio: number, maxWidth: number, maxHeight: number): Dimensions {
  const safeMaxWidth = normalizeDimension(maxWidth, 2);
  const safeMaxHeight = normalizeDimension(maxHeight, 2);

  const boundsRatio = safeMaxWidth / safeMaxHeight;

  let width: number;
  let height: number;

  if (boundsRatio > aspectRatio) {
    height = safeMaxHeight;
    width = Math.floor((height * aspectRatio) / 2) * 2;
  } else {
    width = safeMaxWidth;
    height = Math.floor((width / aspectRatio) / 2) * 2;
  }

  if (width < 2 || height < 2) {
    return { width: 2, height: 2 };
  }

  if (width > safeMaxWidth) {
    width = safeMaxWidth;
    height = Math.floor((width / aspectRatio) / 2) * 2;
  }
  if (height > safeMaxHeight) {
    height = safeMaxHeight;
    width = Math.floor((height * aspectRatio) / 2) * 2;
  }

  width = normalizeDimension(width, 2);
  height = normalizeDimension(height, 2);

  return {
    width: Math.max(2, Math.min(width, safeMaxWidth)),
    height: Math.max(2, Math.min(height, safeMaxHeight)),
  };
}

export function normalizeExportSourceFrameRate(sourceFrameRate?: number): number {
  if (!Number.isFinite(sourceFrameRate)) return 60;
  const normalized = Math.round(sourceFrameRate || 60);
  if (normalized < 24) return 24;
  if (normalized > 120) return 120;
  return normalized;
}

export function resolveExportFrameRate(sourceFrameRate: number | undefined, quality: ExportQuality): number {
  const sourceRate = normalizeExportSourceFrameRate(sourceFrameRate);
  if (quality === 'source') {
    return sourceRate;
  }
  return Math.min(sourceRate, 60);
}

function calculateBitrate(width: number, height: number, frameRate: number, quality: ExportQuality): number {
  const pixels = Math.max(1, width * height);
  const fps = Math.max(1, frameRate);
  const raw = Math.round(pixels * fps * BITRATE_BPP_PER_FRAME[quality]);
  const limits = BITRATE_LIMITS[quality];
  return clamp(raw, limits.min, limits.max);
}

export function calculateMp4ExportPlan(input: Mp4ExportPlanInput): Mp4ExportPlan {
  const aspectRatio = normalizeAspectRatio(input.aspectRatio);
  const sourceWidth = normalizeDimension(input.sourceWidth, 1920);
  const sourceHeight = normalizeDimension(input.sourceHeight, 1080);
  const frameRate = resolveExportFrameRate(input.sourceFrameRate, input.quality);

  const sourceBound = fitAspectRatioWithinBounds(aspectRatio, sourceWidth, sourceHeight);

  if (input.quality === 'source') {
    return {
      width: sourceBound.width,
      height: sourceBound.height,
      frameRate,
      bitrate: calculateBitrate(sourceBound.width, sourceBound.height, frameRate, input.quality),
      limitedBySource: false,
    };
  }

  const targetHeight = QUALITY_TARGET_HEIGHT[input.quality];
  const requestedHeight = normalizeDimension(targetHeight, 720);
  const requestedWidth = normalizeDimension(Math.round(requestedHeight * aspectRatio), 1280);

  const bounded = fitAspectRatioWithinBounds(
    aspectRatio,
    Math.min(requestedWidth, sourceBound.width),
    Math.min(requestedHeight, sourceBound.height),
  );

  const limitedBySource = bounded.width < requestedWidth || bounded.height < requestedHeight;

  return {
    width: bounded.width,
    height: bounded.height,
    frameRate,
    bitrate: calculateBitrate(bounded.width, bounded.height, frameRate, input.quality),
    limitedBySource,
  };
}
