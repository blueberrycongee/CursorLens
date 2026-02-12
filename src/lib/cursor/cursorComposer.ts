import type { CropRegion, ZoomFocus, ZoomRegion } from '@/components/video-editor/types';
import { DEFAULT_FOCUS } from '@/components/video-editor/videoPlayback/constants';
import { findDominantRegion } from '@/components/video-editor/videoPlayback/zoomRegionUtils';
import {
  DEFAULT_CURSOR_STYLE,
  type CursorResolvedState,
  type CursorResolveParams,
  type CursorSample,
  type CursorStyleConfig,
  type CursorTrack,
  type ProjectedCursorPoint,
} from './types';

const CLICK_PULSE_MS = 420;
const CURSOR_GLYPH_HOTSPOT = { x: -4, y: -8 };

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function easeOutCubic(t: number): number {
  const x = 1 - clamp01(t);
  return 1 - x * x * x;
}

function normalizeCursorStyle(input?: Partial<CursorStyleConfig>): CursorStyleConfig {
  const merged: CursorStyleConfig = {
    ...DEFAULT_CURSOR_STYLE,
    ...input,
  };

  return {
    enabled: Boolean(merged.enabled),
    size: Math.min(3.5, Math.max(0.8, merged.size)),
    highlight: clamp01(merged.highlight),
    ripple: clamp01(merged.ripple),
    shadow: clamp01(merged.shadow),
    smoothingMs: Math.max(0, Math.min(220, Math.round(merged.smoothingMs))),
    offsetX: Math.max(-240, Math.min(240, Number.isFinite(merged.offsetX) ? merged.offsetX : 0)),
    offsetY: Math.max(-240, Math.min(240, Number.isFinite(merged.offsetY) ? merged.offsetY : 0)),
  };
}

function sampleIsVisible(sample: CursorSample): boolean {
  return sample.visible !== false;
}

function getFallbackFocus(timeMs: number, zoomRegions?: ZoomRegion[], fallbackFocus?: ZoomFocus): ZoomFocus {
  if (fallbackFocus) {
    return {
      cx: clamp01(fallbackFocus.cx),
      cy: clamp01(fallbackFocus.cy),
    };
  }

  if (!zoomRegions || zoomRegions.length === 0) {
    return DEFAULT_FOCUS;
  }

  const { region, strength } = findDominantRegion(zoomRegions, timeMs);
  if (!region || strength <= 0.02) {
    return DEFAULT_FOCUS;
  }

  return {
    cx: clamp01(region.focus.cx),
    cy: clamp01(region.focus.cy),
  };
}

function findSurroundingSamples(samples: CursorSample[], timeMs: number): {
  prev: CursorSample;
  next: CursorSample;
  alpha: number;
} | null {
  if (samples.length === 0) return null;

  if (timeMs <= samples[0].timeMs) {
    return { prev: samples[0], next: samples[0], alpha: 0 };
  }

  const last = samples[samples.length - 1];
  if (timeMs >= last.timeMs) {
    return { prev: last, next: last, alpha: 0 };
  }

  let low = 0;
  let high = samples.length - 1;

  while (low <= high) {
    const mid = (low + high) >> 1;
    const value = samples[mid].timeMs;
    if (value < timeMs) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  const next = samples[Math.min(samples.length - 1, low)];
  const prev = samples[Math.max(0, low - 1)];
  const duration = next.timeMs - prev.timeMs;
  const alpha = duration > 0 ? clamp01((timeMs - prev.timeMs) / duration) : 0;

  return { prev, next, alpha };
}

function interpolateFromTrack(samples: CursorSample[], timeMs: number): { x: number; y: number; visible: boolean } | null {
  const surrounding = findSurroundingSamples(samples, timeMs);
  if (!surrounding) return null;

  const { prev, next, alpha } = surrounding;
  const x = lerp(prev.x, next.x, alpha);
  const y = lerp(prev.y, next.y, alpha);
  const visible = sampleIsVisible(prev) || sampleIsVisible(next);

  return {
    x: clamp01(x),
    y: clamp01(y),
    visible,
  };
}

function smoothFromTrack(samples: CursorSample[], timeMs: number, windowMs: number): { x: number; y: number; visible: boolean } | null {
  if (windowMs <= 0 || samples.length === 0) {
    return interpolateFromTrack(samples, timeMs);
  }

  const start = timeMs - windowMs;
  const end = timeMs + windowMs;
  const sigma = Math.max(1, windowMs / 2.2);

  let sumX = 0;
  let sumY = 0;
  let weightSum = 0;
  let hasVisible = false;

  for (const sample of samples) {
    if (sample.timeMs < start) continue;
    if (sample.timeMs > end) break;

    const delta = sample.timeMs - timeMs;
    const weight = Math.exp(-((delta * delta) / (2 * sigma * sigma)));
    sumX += sample.x * weight;
    sumY += sample.y * weight;
    weightSum += weight;
    hasVisible ||= sampleIsVisible(sample);
  }

  if (weightSum <= 0.0001) {
    return interpolateFromTrack(samples, timeMs);
  }

  return {
    x: clamp01(sumX / weightSum),
    y: clamp01(sumY / weightSum),
    visible: hasVisible,
  };
}

function collectClickTimes(track: CursorTrack | null | undefined, zoomRegions?: ZoomRegion[]): number[] {
  const clickTimes: number[] = [];

  if (track?.samples?.length) {
    for (const sample of track.samples) {
      if (sample.click) {
        clickTimes.push(sample.timeMs);
      }
    }
  }

  if (zoomRegions?.length) {
    for (const region of zoomRegions) {
      clickTimes.push(region.startMs);
    }
  }

  clickTimes.sort((a, b) => a - b);
  return clickTimes;
}

function resolveClickPulse(timeMs: number, clickTimes: number[]): number {
  if (clickTimes.length === 0) return 0;

  let idx = clickTimes.length - 1;
  while (idx >= 0 && clickTimes[idx] > timeMs) {
    idx -= 1;
  }

  if (idx < 0) return 0;

  const delta = timeMs - clickTimes[idx];
  if (delta < 0 || delta > CLICK_PULSE_MS) return 0;

  return 1 - clamp01(delta / CLICK_PULSE_MS);
}

export function resolveCursorState(params: CursorResolveParams): CursorResolvedState {
  const style = normalizeCursorStyle(params.style);
  if (!style.enabled) {
    return {
      visible: false,
      x: 0.5,
      y: 0.5,
      scale: style.size,
      highlightAlpha: 0,
      rippleScale: 0,
      rippleAlpha: 0,
    };
  }

  const sortedSamples = (params.track?.samples || [])
    .filter((sample) => Number.isFinite(sample.timeMs))
    .slice()
    .sort((a, b) => a.timeMs - b.timeMs);

  const fromTrack = sortedSamples.length
    ? smoothFromTrack(sortedSamples, params.timeMs, style.smoothingMs)
    : null;

  const fallback = getFallbackFocus(params.timeMs, params.zoomRegions, params.fallbackFocus);

  const baseX = fromTrack?.x ?? fallback.cx;
  const baseY = fromTrack?.y ?? fallback.cy;

  const fallbackVisible = Boolean(params.zoomRegions?.length);
  const visible = fromTrack?.visible ?? fallbackVisible;

  const clickPulse = resolveClickPulse(params.timeMs, collectClickTimes(params.track, params.zoomRegions));
  const clickAccent = easeOutCubic(clickPulse);

  return {
    visible,
    x: clamp01(baseX),
    y: clamp01(baseY),
    scale: style.size * (1 + clickAccent * 0.1),
    highlightAlpha: style.highlight * (0.35 + clickAccent * 0.25),
    rippleScale: 1 + clickAccent * 1.8,
    rippleAlpha: style.ripple * clickPulse,
  };
}

export function projectCursorToViewport(args: {
  normalizedX: number;
  normalizedY: number;
  cropRegion: CropRegion;
  baseOffset: { x: number; y: number };
  maskRect: { width: number; height: number };
  cameraScale: { x: number; y: number };
  cameraPosition: { x: number; y: number };
  stageSize: { width: number; height: number };
}): ProjectedCursorPoint {
  const { normalizedX, normalizedY, cropRegion, baseOffset, maskRect, cameraScale, cameraPosition, stageSize } = args;

  const inCropX = (normalizedX - cropRegion.x) / Math.max(0.0001, cropRegion.width);
  const inCropY = (normalizedY - cropRegion.y) / Math.max(0.0001, cropRegion.height);

  const localX = baseOffset.x + inCropX * maskRect.width;
  const localY = baseOffset.y + inCropY * maskRect.height;

  const x = localX * cameraScale.x + cameraPosition.x;
  const y = localY * cameraScale.y + cameraPosition.y;

  const inViewport = x >= -32 && y >= -32 && x <= stageSize.width + 32 && y <= stageSize.height + 32;

  return { x, y, inViewport };
}

function drawCursorGlyph(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.moveTo(-4, -8);
  ctx.lineTo(13, 2);
  ctx.lineTo(6, 4);
  ctx.lineTo(9, 13);
  ctx.lineTo(5, 14);
  ctx.lineTo(2, 5);
  ctx.lineTo(-2, 10);
  ctx.closePath();

  ctx.fillStyle = '#f7f9ff';
  ctx.fill();
  ctx.strokeStyle = '#0f1218';
  ctx.lineWidth = 1.4;
  ctx.stroke();
}

export function drawCompositedCursor(
  ctx: CanvasRenderingContext2D,
  point: { x: number; y: number },
  state: CursorResolvedState,
  style?: Partial<CursorStyleConfig>,
): void {
  if (!state.visible) return;

  const normalized = normalizeCursorStyle(style);
  const scale = state.scale;
  const translatedX = point.x + normalized.offsetX;
  const translatedY = point.y + normalized.offsetY;

  ctx.save();
  ctx.translate(translatedX, translatedY);

  if (state.rippleAlpha > 0.001) {
    ctx.save();
    ctx.globalAlpha = state.rippleAlpha;
    ctx.strokeStyle = 'rgba(78,161,255,1)';
    ctx.lineWidth = 2;
    const rippleRadius = 10 * state.rippleScale * scale;
    ctx.beginPath();
    ctx.arc(0, 0, rippleRadius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  if (state.highlightAlpha > 0.001) {
    ctx.save();
    ctx.globalAlpha = state.highlightAlpha;
    const gradient = ctx.createRadialGradient(0, 0, 2, 0, 0, 20 * scale);
    gradient.addColorStop(0, 'rgba(78,161,255,0.5)');
    gradient.addColorStop(1, 'rgba(78,161,255,0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(0, 0, 20 * scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  if (normalized.shadow > 0.001) {
    ctx.save();
    ctx.shadowColor = `rgba(0,0,0,${0.5 * normalized.shadow})`;
    ctx.shadowBlur = 10 * scale;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 2 * scale;
    // Align OS hotspot with synthetic glyph tip to avoid visible drift versus source cursor.
    ctx.translate(-CURSOR_GLYPH_HOTSPOT.x * scale, -CURSOR_GLYPH_HOTSPOT.y * scale);
    ctx.scale(scale, scale);
    drawCursorGlyph(ctx);
    ctx.restore();
  } else {
    ctx.save();
    ctx.translate(-CURSOR_GLYPH_HOTSPOT.x * scale, -CURSOR_GLYPH_HOTSPOT.y * scale);
    ctx.scale(scale, scale);
    drawCursorGlyph(ctx);
    ctx.restore();
  }

  ctx.restore();
}

export function normalizePointerSample(
  timeMs: number,
  screenX: number,
  screenY: number,
  screenWidth: number,
  screenHeight: number,
  click = false,
): CursorSample {
  return {
    timeMs,
    x: clamp01(screenWidth > 0 ? screenX / screenWidth : 0.5),
    y: clamp01(screenHeight > 0 ? screenY / screenHeight : 0.5),
    click,
    visible: true,
  };
}
