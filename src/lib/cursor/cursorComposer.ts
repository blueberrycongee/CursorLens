import type { CropRegion, ZoomFocus, ZoomRegion } from '@/components/video-editor/types';
import { DEFAULT_FOCUS } from '@/components/video-editor/videoPlayback/constants';
import { findDominantRegion } from '@/components/video-editor/videoPlayback/zoomRegionUtils';
import {
  DEFAULT_CURSOR_STYLE,
  type CursorKind,
  type CursorMovementStyle,
  type CursorResolvedState,
  type CursorResolveParams,
  type CursorSample,
  type CursorStyleConfig,
  type CursorTrack,
  type ProjectedCursorPoint,
} from './types';

const CLICK_PULSE_MS = 420;
const CURSOR_GLYPH_HOTSPOT: Record<CursorKind, { x: number; y: number }> = {
  arrow: { x: -4, y: -8 },
  ibeam: { x: 0, y: 0 },
};
const SUPPORTED_MOVEMENT_STYLES: CursorMovementStyle[] = ['rapid', 'quick', 'default', 'slow', 'custom'];
const POINTER_ACTIVITY_THRESHOLD = 0.0009;

function toFiniteNumber(value: unknown, fallback: number): number {
  return Number.isFinite(value) ? Number(value) : fallback;
}

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

function normalizeMovementStyle(value: unknown): CursorMovementStyle {
  if (typeof value !== 'string') return DEFAULT_CURSOR_STYLE.movementStyle;
  if (SUPPORTED_MOVEMENT_STYLES.includes(value as CursorMovementStyle)) {
    return value as CursorMovementStyle;
  }
  return DEFAULT_CURSOR_STYLE.movementStyle;
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
    movementStyle: normalizeMovementStyle(merged.movementStyle),
    autoHideStatic: Boolean(merged.autoHideStatic),
    staticHideDelayMs: Math.max(0, Math.min(8000, Math.round(toFiniteNumber(merged.staticHideDelayMs, DEFAULT_CURSOR_STYLE.staticHideDelayMs)))),
    staticHideFadeMs: Math.max(40, Math.min(2400, Math.round(toFiniteNumber(merged.staticHideFadeMs, DEFAULT_CURSOR_STYLE.staticHideFadeMs)))),
    loopCursorPosition: Boolean(merged.loopCursorPosition),
    loopBlendMs: Math.max(80, Math.min(10000, Math.round(toFiniteNumber(merged.loopBlendMs, DEFAULT_CURSOR_STYLE.loopBlendMs)))),
    offsetX: Math.max(-240, Math.min(240, Number.isFinite(merged.offsetX) ? merged.offsetX : 0)),
    offsetY: Math.max(-240, Math.min(240, Number.isFinite(merged.offsetY) ? merged.offsetY : 0)),
    timeOffsetMs: Math.max(-300, Math.min(300, Number.isFinite(merged.timeOffsetMs) ? merged.timeOffsetMs : 0)),
  };
}

function sampleIsVisible(sample: CursorSample): boolean {
  return sample.visible !== false;
}

function sampleCursorKind(sample: CursorSample): CursorKind {
  return sample.cursorKind === 'ibeam' ? 'ibeam' : 'arrow';
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

function interpolateFromTrack(
  samples: CursorSample[],
  timeMs: number,
): { x: number; y: number; visible: boolean; cursorKind: CursorKind } | null {
  const surrounding = findSurroundingSamples(samples, timeMs);
  if (!surrounding) return null;

  const { prev, next, alpha } = surrounding;
  const x = lerp(prev.x, next.x, alpha);
  const y = lerp(prev.y, next.y, alpha);
  const visible = sampleIsVisible(prev) || sampleIsVisible(next);
  const cursorKind = alpha < 0.5 ? sampleCursorKind(prev) : sampleCursorKind(next);

  return {
    x: clamp01(x),
    y: clamp01(y),
    visible,
    cursorKind,
  };
}

function smoothFromTrack(
  samples: CursorSample[],
  timeMs: number,
  windowMs: number,
): { x: number; y: number; visible: boolean; cursorKind: CursorKind } | null {
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
  let arrowWeight = 0;
  let ibeamWeight = 0;

  for (const sample of samples) {
    if (sample.timeMs < start) continue;
    if (sample.timeMs > end) break;

    const delta = sample.timeMs - timeMs;
    const weight = Math.exp(-((delta * delta) / (2 * sigma * sigma)));
    sumX += sample.x * weight;
    sumY += sample.y * weight;
    weightSum += weight;
    hasVisible ||= sampleIsVisible(sample);
    if (sampleCursorKind(sample) === 'ibeam') {
      ibeamWeight += weight;
    } else {
      arrowWeight += weight;
    }
  }

  if (weightSum <= 0.0001) {
    return interpolateFromTrack(samples, timeMs);
  }

  return {
    x: clamp01(sumX / weightSum),
    y: clamp01(sumY / weightSum),
    visible: hasVisible,
    cursorKind: ibeamWeight > arrowWeight ? 'ibeam' : 'arrow',
  };
}

function sampleActivityDetected(prev: CursorSample, next: CursorSample): boolean {
  if (next.click) return true;
  if (sampleIsVisible(prev) !== sampleIsVisible(next)) return true;
  if (sampleCursorKind(prev) !== sampleCursorKind(next)) return true;

  const deltaX = next.x - prev.x;
  const deltaY = next.y - prev.y;
  const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
  return distance >= POINTER_ACTIVITY_THRESHOLD;
}

function resolveStaticVisibilityFactor(
  samples: CursorSample[],
  timeMs: number,
  style: CursorStyleConfig,
): number {
  if (!style.autoHideStatic || samples.length < 2) {
    return 1;
  }

  let previous: CursorSample | null = null;
  let observedSample = false;
  let lastActivityTime = samples[0].timeMs;

  for (const sample of samples) {
    if (sample.timeMs > timeMs) break;
    observedSample = true;
    if (!previous) {
      previous = sample;
      if (sample.click) {
        lastActivityTime = sample.timeMs;
      }
      continue;
    }
    if (sampleActivityDetected(previous, sample)) {
      lastActivityTime = sample.timeMs;
    }
    previous = sample;
  }

  if (!observedSample) return 1;

  const surrounding = findSurroundingSamples(samples, timeMs);
  if (
    surrounding &&
    surrounding.prev.timeMs !== surrounding.next.timeMs &&
    sampleActivityDetected(surrounding.prev, surrounding.next)
  ) {
    return 1;
  }

  const inactivityMs = Math.max(0, timeMs - lastActivityTime);
  if (inactivityMs <= style.staticHideDelayMs) {
    return 1;
  }

  const fadeProgress = clamp01((inactivityMs - style.staticHideDelayMs) / Math.max(1, style.staticHideFadeMs));
  return 1 - easeOutCubic(fadeProgress);
}

function applyLoopCursorPosition(
  cursor: { x: number; y: number; visible: boolean; cursorKind: CursorKind } | null,
  samples: CursorSample[],
  timeMs: number,
  style: CursorStyleConfig,
): { x: number; y: number; visible: boolean; cursorKind: CursorKind } | null {
  if (!cursor || !style.loopCursorPosition || samples.length < 2) {
    return cursor;
  }

  const startTime = samples[0].timeMs;
  const endTime = samples[samples.length - 1].timeMs;
  const totalRange = endTime - startTime;
  if (totalRange <= 1) {
    return cursor;
  }

  const blendMs = Math.min(totalRange, style.loopBlendMs);
  const blendStart = endTime - blendMs;
  if (timeMs <= blendStart) {
    return cursor;
  }

  const blendProgress = clamp01((timeMs - blendStart) / Math.max(1, blendMs));
  if (blendProgress <= 0) {
    return cursor;
  }

  const startCursor = interpolateFromTrack(samples, startTime);
  if (!startCursor) {
    return cursor;
  }

  const easedBlend = easeOutCubic(blendProgress);
  return {
    x: clamp01(lerp(cursor.x, startCursor.x, easedBlend)),
    y: clamp01(lerp(cursor.y, startCursor.y, easedBlend)),
    visible: cursor.visible || startCursor.visible,
    cursorKind: easedBlend >= 0.5 ? startCursor.cursorKind : cursor.cursorKind,
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
      cursorKind: 'arrow',
    };
  }

  const sampleTimeMs = params.timeMs + style.timeOffsetMs;
  const sortedSamples = (params.track?.samples || [])
    .filter((sample) => Number.isFinite(sample.timeMs))
    .slice()
    .sort((a, b) => a.timeMs - b.timeMs);

  const fromTrackRaw = sortedSamples.length
    ? smoothFromTrack(sortedSamples, sampleTimeMs, style.smoothingMs)
    : null;
  const fromTrack = applyLoopCursorPosition(fromTrackRaw, sortedSamples, sampleTimeMs, style);

  const fallback = getFallbackFocus(params.timeMs, params.zoomRegions, params.fallbackFocus);

  const baseX = fromTrack?.x ?? fallback.cx;
  const baseY = fromTrack?.y ?? fallback.cy;

  const fallbackVisible = Boolean(params.zoomRegions?.length);
  const staticVisibilityFactor = fromTrack
    ? resolveStaticVisibilityFactor(sortedSamples, sampleTimeMs, style)
    : 1;
  const visibleFromTrack = fromTrack?.visible ?? fallbackVisible;
  const visible = visibleFromTrack && staticVisibilityFactor > 0.001;

  const clickPulse = resolveClickPulse(sampleTimeMs, collectClickTimes(params.track, params.zoomRegions));
  const clickAccent = easeOutCubic(clickPulse);
  const cursorKind = fromTrack?.cursorKind ?? 'arrow';

  return {
    visible,
    x: clamp01(baseX),
    y: clamp01(baseY),
    scale: style.size * (1 + clickAccent * 0.1),
    highlightAlpha: style.highlight * staticVisibilityFactor * (0.35 + clickAccent * 0.25),
    rippleScale: 1 + clickAccent * 1.8,
    rippleAlpha: style.ripple * staticVisibilityFactor * clickPulse,
    cursorKind,
  };
}

export function resolveCursorOcclusionState(params: CursorResolveParams): CursorResolvedState | null {
  const hasTrackSamples = Array.isArray(params.track?.samples) && params.track.samples.length > 0;
  if (!hasTrackSamples) {
    return null;
  }

  // Occlusion is independent from visual cursor styling. Keep temporal alignment/smoothing,
  // but never gate erasing on style.enabled or auto-hide/loop effects.
  const occlusionStyle: CursorStyleConfig = {
    ...normalizeCursorStyle(params.style),
    enabled: true,
    autoHideStatic: false,
    loopCursorPosition: false,
  };

  const state = resolveCursorState({
    ...params,
    style: occlusionStyle,
  });

  return state.visible ? state : null;
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

function drawArrowCursorGlyph(ctx: CanvasRenderingContext2D): void {
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

function drawIBeamCursorGlyph(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  ctx.strokeStyle = '#0f1218';
  ctx.lineWidth = 4.2;
  ctx.beginPath();
  ctx.moveTo(0, -10);
  ctx.lineTo(0, 10);
  ctx.moveTo(-4.8, -10);
  ctx.lineTo(4.8, -10);
  ctx.moveTo(-4.8, 10);
  ctx.lineTo(4.8, 10);
  ctx.stroke();

  ctx.strokeStyle = '#f7f9ff';
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(0, -10);
  ctx.lineTo(0, 10);
  ctx.moveTo(-4.8, -10);
  ctx.lineTo(4.8, -10);
  ctx.moveTo(-4.8, 10);
  ctx.lineTo(4.8, 10);
  ctx.stroke();
  ctx.restore();
}

function drawCursorGlyph(ctx: CanvasRenderingContext2D, cursorKind: CursorKind): void {
  if (cursorKind === 'ibeam') {
    drawIBeamCursorGlyph(ctx);
    return;
  }
  drawArrowCursorGlyph(ctx);
}

export function drawCompositedCursor(
  ctx: CanvasRenderingContext2D,
  point: { x: number; y: number },
  state: CursorResolvedState,
  style?: Partial<CursorStyleConfig>,
  contentScale = 1,
): void {
  if (!state.visible) return;

  const normalized = normalizeCursorStyle(style);
  const safeContentScale = Math.max(0.1, Math.min(8, Number.isFinite(contentScale) ? contentScale : 1));
  const scale = state.scale * safeContentScale;
  const cursorKind: CursorKind = state.cursorKind === 'ibeam' ? 'ibeam' : 'arrow';
  const cursorHotspot = CURSOR_GLYPH_HOTSPOT[cursorKind];
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
    ctx.translate(-cursorHotspot.x * scale, -cursorHotspot.y * scale);
    ctx.scale(scale, scale);
    drawCursorGlyph(ctx, cursorKind);
    ctx.restore();
  } else {
    ctx.save();
    ctx.translate(-cursorHotspot.x * scale, -cursorHotspot.y * scale);
    ctx.scale(scale, scale);
    drawCursorGlyph(ctx, cursorKind);
    ctx.restore();
  }

  ctx.restore();
}

export function occludeCapturedCursorArtifact(
  ctx: CanvasRenderingContext2D,
  point: { x: number; y: number },
  state: CursorResolvedState,
  options: {
    sourceCanvas: HTMLCanvasElement;
    stageSize: { width: number; height: number };
    contentScale?: number;
  },
): void {
  if (!state.visible) return;

  const rawContentScale = options.contentScale ?? 1;
  const safeContentScale = Math.max(0.1, Math.min(8, Number.isFinite(rawContentScale) ? rawContentScale : 1));
  // Over-cover pointer glyph + OS cursor antialias fringe to avoid visible remnants.
  const radius = Math.max(18, 16 * state.scale * safeContentScale);
  const diameter = Math.max(2, Math.round(radius * 2));
  const destX = point.x - diameter / 2;
  const destY = point.y - diameter / 2;

  const stageWidth = Math.max(1, options.stageSize.width);
  const stageHeight = Math.max(1, options.stageSize.height);
  const source = options.sourceCanvas;
  const sourceScaleX = source.width / stageWidth;
  const sourceScaleY = source.height / stageHeight;

  const candidates = [
    { dx: 2.6, dy: 0.8 },
    { dx: -2.6, dy: 0.8 },
    { dx: 2.6, dy: -0.8 },
    { dx: -2.6, dy: -0.8 },
    { dx: 0, dy: 2.8 },
    { dx: 0, dy: -2.8 },
    { dx: 2.1, dy: 2.1 },
    { dx: -2.1, dy: 2.1 },
    { dx: 2.1, dy: -2.1 },
    { dx: -2.1, dy: -2.1 },
  ];

  const sourceW = source.width;
  const sourceH = source.height;

  for (const candidate of candidates) {
    const sourceRectX = destX + candidate.dx * radius;
    const sourceRectY = destY + candidate.dy * radius;

    const sx = Math.max(0, Math.min(sourceW - diameter * sourceScaleX, sourceRectX * sourceScaleX));
    const sy = Math.max(0, Math.min(sourceH - diameter * sourceScaleY, sourceRectY * sourceScaleY));

    const isSameArea = Math.abs(sx - destX * sourceScaleX) < 0.5 && Math.abs(sy - destY * sourceScaleY) < 0.5;
    if (isSameArea) continue;

    ctx.save();
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    ctx.clip();
    ctx.filter = 'blur(0.7px)';
    ctx.drawImage(
      source,
      sx,
      sy,
      diameter * sourceScaleX,
      diameter * sourceScaleY,
      destX,
      destY,
      diameter,
      diameter,
    );
    ctx.restore();
    return;
  }

  // Last fallback: softly neutralize local pointer pixels if no valid donor patch found.
  ctx.save();
  ctx.beginPath();
  ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.16)';
  ctx.fillRect(destX, destY, diameter, diameter);
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
    cursorKind: 'arrow',
  };
}
