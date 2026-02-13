import { describe, expect, it } from 'vitest';
import { DEFAULT_CURSOR_STYLE, type CursorTrack } from './types';
import {
  drawCompositedCursor,
  normalizePointerSample,
  occludeCapturedCursorArtifact,
  projectCursorToViewport,
  resolveCursorState,
} from './cursorComposer';

describe('cursorComposer', () => {
  it('interpolates and smooths recorded cursor track', () => {
    const track: CursorTrack = {
      source: 'recorded',
      samples: [
        { timeMs: 0, x: 0.1, y: 0.1, visible: true },
        { timeMs: 100, x: 0.2, y: 0.2, visible: true },
        { timeMs: 200, x: 0.4, y: 0.4, visible: true },
      ],
    };

    const state = resolveCursorState({
      timeMs: 100,
      track,
      style: { ...DEFAULT_CURSOR_STYLE, smoothingMs: 0 },
    });

    expect(state.visible).toBe(true);
    expect(state.x).toBeCloseTo(0.2, 2);
    expect(state.y).toBeCloseTo(0.2, 2);
    expect(state.cursorKind).toBe('arrow');
  });

  it('resolves ibeam cursor kind from recorded samples', () => {
    const track: CursorTrack = {
      source: 'recorded',
      samples: [
        { timeMs: 0, x: 0.2, y: 0.2, visible: true, cursorKind: 'arrow' },
        { timeMs: 120, x: 0.3, y: 0.3, visible: true, cursorKind: 'ibeam' },
      ],
    };

    const state = resolveCursorState({
      timeMs: 100,
      track,
      style: { ...DEFAULT_CURSOR_STYLE, smoothingMs: 0 },
    });

    expect(state.cursorKind).toBe('ibeam');
  });

  it('uses fallback focus when no cursor track exists', () => {
    const state = resolveCursorState({
      timeMs: 100,
      track: { samples: [] },
      zoomRegions: [],
      fallbackFocus: { cx: 0.62, cy: 0.34 },
    });

    expect(state.x).toBeCloseTo(0.62, 3);
    expect(state.y).toBeCloseTo(0.34, 3);
    expect(state.visible).toBe(false);
  });

  it('projects normalized point through crop and camera transform', () => {
    const projected = projectCursorToViewport({
      normalizedX: 0.5,
      normalizedY: 0.5,
      cropRegion: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
      baseOffset: { x: 100, y: 50 },
      maskRect: { width: 800, height: 400 },
      cameraScale: { x: 1.2, y: 1.2 },
      cameraPosition: { x: -40, y: 20 },
      stageSize: { width: 1280, height: 720 },
    });

    expect(projected.x).toBeCloseTo(560, 2);
    expect(projected.y).toBeCloseTo(320, 2);
    expect(projected.inViewport).toBe(true);
  });

  it('normalizes pointer samples to 0..1', () => {
    const sample = normalizePointerSample(16, 960, 540, 1920, 1080, true);
    expect(sample.x).toBe(0.5);
    expect(sample.y).toBe(0.5);
    expect(sample.click).toBe(true);
  });

  it('supports time offset alignment for cursor track', () => {
    const track: CursorTrack = {
      source: 'recorded',
      samples: [
        { timeMs: 0, x: 0.1, y: 0.1, visible: true },
        { timeMs: 100, x: 0.5, y: 0.5, visible: true },
      ],
    };

    const withoutOffset = resolveCursorState({
      timeMs: 0,
      track,
      style: { ...DEFAULT_CURSOR_STYLE, smoothingMs: 0, timeOffsetMs: 0 },
    });
    const withOffset = resolveCursorState({
      timeMs: 0,
      track,
      style: { ...DEFAULT_CURSOR_STYLE, smoothingMs: 0, timeOffsetMs: 100 },
    });

    expect(withoutOffset.x).toBeCloseTo(0.1, 3);
    expect(withOffset.x).toBeCloseTo(0.5, 3);
  });

  it('auto-hides static cursor after inactivity window', () => {
    const track: CursorTrack = {
      source: 'recorded',
      samples: [
        { timeMs: 0, x: 0.42, y: 0.42, visible: true },
        { timeMs: 120, x: 0.42, y: 0.42, visible: true },
      ],
    };

    const hiddenState = resolveCursorState({
      timeMs: 280,
      track,
      style: {
        ...DEFAULT_CURSOR_STYLE,
        smoothingMs: 0,
        autoHideStatic: true,
        staticHideDelayMs: 100,
        staticHideFadeMs: 120,
      },
    });

    expect(hiddenState.visible).toBe(false);
    expect(hiddenState.highlightAlpha).toBeCloseTo(0, 3);
  });

  it('keeps cursor visible when track remains active', () => {
    const track: CursorTrack = {
      source: 'recorded',
      samples: [
        { timeMs: 0, x: 0.1, y: 0.1, visible: true },
        { timeMs: 120, x: 0.25, y: 0.2, visible: true },
        { timeMs: 260, x: 0.4, y: 0.35, visible: true },
      ],
    };

    const state = resolveCursorState({
      timeMs: 280,
      track,
      style: {
        ...DEFAULT_CURSOR_STYLE,
        smoothingMs: 0,
        autoHideStatic: true,
        staticHideDelayMs: 180,
        staticHideFadeMs: 120,
      },
    });

    expect(state.visible).toBe(true);
    expect(state.highlightAlpha).toBeGreaterThan(0.05);
  });

  it('loops cursor back toward start near the end of the track', () => {
    const track: CursorTrack = {
      source: 'recorded',
      samples: [
        { timeMs: 0, x: 0.12, y: 0.2, visible: true, cursorKind: 'arrow' },
        { timeMs: 1000, x: 0.9, y: 0.8, visible: true, cursorKind: 'ibeam' },
      ],
    };

    const state = resolveCursorState({
      timeMs: 1000,
      track,
      style: {
        ...DEFAULT_CURSOR_STYLE,
        smoothingMs: 0,
        loopCursorPosition: true,
        loopBlendMs: 400,
      },
    });

    expect(state.x).toBeCloseTo(0.12, 3);
    expect(state.y).toBeCloseTo(0.2, 3);
    expect(state.cursorKind).toBe('arrow');
  });

  it('applies cursor offset before drawing glyph', () => {
    const translateCalls: Array<{ x: number; y: number }> = [];
    const context = {
      save: () => {},
      restore: () => {},
      translate: (x: number, y: number) => {
        translateCalls.push({ x, y });
      },
      scale: () => {},
      beginPath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      closePath: () => {},
      fill: () => {},
      stroke: () => {},
      arc: () => {},
      set globalAlpha(_: number) {},
      set fillStyle(_: string | CanvasGradient | CanvasPattern) {},
      set strokeStyle(_: string | CanvasGradient | CanvasPattern) {},
      set lineWidth(_: number) {},
      set shadowColor(_: string) {},
      set shadowBlur(_: number) {},
      set shadowOffsetX(_: number) {},
      set shadowOffsetY(_: number) {},
    } as unknown as CanvasRenderingContext2D;

    drawCompositedCursor(
      context,
      { x: 100, y: 60 },
      {
        visible: true,
        x: 0.5,
        y: 0.5,
        scale: 1,
        highlightAlpha: 0,
        rippleScale: 1,
        rippleAlpha: 0,
        cursorKind: 'arrow',
      },
      { ...DEFAULT_CURSOR_STYLE, offsetX: 12, offsetY: -6, shadow: 0 },
    );

    expect(translateCalls[0]).toEqual({ x: 112, y: 54 });
  });

  it('scales cursor glyph with zoom content scale', () => {
    const scaleCalls: Array<{ x: number; y: number }> = [];
    const context = {
      save: () => {},
      restore: () => {},
      translate: () => {},
      scale: (x: number, y: number) => {
        scaleCalls.push({ x, y });
      },
      beginPath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      closePath: () => {},
      fill: () => {},
      stroke: () => {},
      arc: () => {},
      set globalAlpha(_: number) {},
      set fillStyle(_: string | CanvasGradient | CanvasPattern) {},
      set strokeStyle(_: string | CanvasGradient | CanvasPattern) {},
      set lineWidth(_: number) {},
      set shadowColor(_: string) {},
      set shadowBlur(_: number) {},
      set shadowOffsetX(_: number) {},
      set shadowOffsetY(_: number) {},
    } as unknown as CanvasRenderingContext2D;

    drawCompositedCursor(
      context,
      { x: 100, y: 60 },
      {
        visible: true,
        x: 0.5,
        y: 0.5,
        scale: 1,
        highlightAlpha: 0,
        rippleScale: 1,
        rippleAlpha: 0,
        cursorKind: 'arrow',
      },
      { ...DEFAULT_CURSOR_STYLE, shadow: 0 },
      2,
    );

    expect(scaleCalls[0]).toEqual({ x: 2, y: 2 });
  });

  it('draws ibeam glyph with center hotspot alignment', () => {
    const translateCalls: Array<{ x: number; y: number }> = [];
    const moveCalls: Array<{ x: number; y: number }> = [];
    const context = {
      save: () => {},
      restore: () => {},
      translate: (x: number, y: number) => {
        translateCalls.push({ x, y });
      },
      scale: () => {},
      beginPath: () => {},
      moveTo: (x: number, y: number) => {
        moveCalls.push({ x, y });
      },
      lineTo: () => {},
      closePath: () => {},
      fill: () => {},
      stroke: () => {},
      arc: () => {},
      set globalAlpha(_: number) {},
      set fillStyle(_: string | CanvasGradient | CanvasPattern) {},
      set strokeStyle(_: string | CanvasGradient | CanvasPattern) {},
      set lineWidth(_: number) {},
      set lineCap(_: CanvasLineCap) {},
      set lineJoin(_: CanvasLineJoin) {},
      set shadowColor(_: string) {},
      set shadowBlur(_: number) {},
      set shadowOffsetX(_: number) {},
      set shadowOffsetY(_: number) {},
    } as unknown as CanvasRenderingContext2D;

    drawCompositedCursor(
      context,
      { x: 100, y: 60 },
      {
        visible: true,
        x: 0.5,
        y: 0.5,
        scale: 1,
        highlightAlpha: 0,
        rippleScale: 1,
        rippleAlpha: 0,
        cursorKind: 'ibeam',
      },
      { ...DEFAULT_CURSOR_STYLE, shadow: 0 },
    );

    expect(translateCalls[0]).toEqual({ x: 100, y: 60 });
    expect(translateCalls[1].x).toBeCloseTo(0, 6);
    expect(translateCalls[1].y).toBeCloseTo(0, 6);
    expect(moveCalls[0]).toEqual({ x: 0, y: -10 });
  });

  it('occludes captured cursor artifact by sampling nearby pixels', () => {
    let drawImageCalls = 0;
    const context = {
      save: () => {},
      restore: () => {},
      beginPath: () => {},
      arc: () => {},
      clip: () => {},
      drawImage: () => {
        drawImageCalls += 1;
      },
    } as unknown as CanvasRenderingContext2D;

    const sourceCanvas = {
      width: 1920,
      height: 1080,
    } as HTMLCanvasElement;

    occludeCapturedCursorArtifact(
      context,
      { x: 300, y: 180 },
      {
        visible: true,
        x: 0.4,
        y: 0.5,
        scale: 1,
        highlightAlpha: 0,
        rippleScale: 1,
        rippleAlpha: 0,
        cursorKind: 'arrow',
      },
      {
        sourceCanvas,
        stageSize: { width: 1280, height: 720 },
        contentScale: 1,
      },
    );

    expect(drawImageCalls).toBe(1);
  });
});
