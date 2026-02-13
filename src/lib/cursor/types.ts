import type { ZoomFocus, ZoomRegion } from '@/components/video-editor/types';

export type CursorKind = 'arrow' | 'ibeam';

export interface CursorSample {
  timeMs: number;
  x: number; // normalized 0..1 relative to original capture frame
  y: number; // normalized 0..1 relative to original capture frame
  click?: boolean;
  visible?: boolean;
  cursorKind?: CursorKind;
}

export interface CursorTrack {
  samples: CursorSample[];
  source?: 'recorded' | 'synthetic';
  space?: {
    mode?: 'source-display' | 'virtual-desktop';
    displayId?: string;
    bounds?: { x: number; y: number; width: number; height: number };
  };
  stats?: {
    sampleCount?: number;
    clickCount?: number;
  };
  capture?: {
    sourceId?: string;
    width?: number;
    height?: number;
  };
}

export interface CursorStyleConfig {
  enabled: boolean;
  size: number;
  highlight: number;
  ripple: number;
  shadow: number;
  smoothingMs: number;
  offsetX: number;
  offsetY: number;
  timeOffsetMs: number;
}

export interface CursorResolveParams {
  timeMs: number;
  track?: CursorTrack | null;
  zoomRegions?: ZoomRegion[];
  fallbackFocus?: ZoomFocus;
  style?: Partial<CursorStyleConfig>;
}

export interface CursorResolvedState {
  visible: boolean;
  x: number;
  y: number;
  scale: number;
  highlightAlpha: number;
  rippleScale: number;
  rippleAlpha: number;
  cursorKind: CursorKind;
}

export interface ProjectedCursorPoint {
  x: number;
  y: number;
  inViewport: boolean;
}

export const DEFAULT_CURSOR_STYLE: CursorStyleConfig = {
  enabled: true,
  size: 1.8,
  highlight: 0.75,
  ripple: 0.7,
  shadow: 0.45,
  smoothingMs: 0,
  offsetX: 0,
  offsetY: 0,
  timeOffsetMs: 0,
};
