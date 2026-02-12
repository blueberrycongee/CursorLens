export interface CaptureBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CapturePoint {
  x: number;
  y: number;
}

export interface CaptureDisplay {
  id: string | number;
  bounds: CaptureBounds;
}

export interface CaptureSourceRef {
  id?: string | null;
  display_id?: string | number | null;
}

export type CaptureBoundsMode = 'source-display' | 'virtual-desktop';

export interface CaptureBoundsResolution {
  bounds: CaptureBounds;
  mode: CaptureBoundsMode;
  displayId?: string;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function ensureBounds(bounds: CaptureBounds): CaptureBounds {
  return {
    x: Number.isFinite(bounds.x) ? bounds.x : 0,
    y: Number.isFinite(bounds.y) ? bounds.y : 0,
    width: Math.max(1, Number.isFinite(bounds.width) ? bounds.width : 1),
    height: Math.max(1, Number.isFinite(bounds.height) ? bounds.height : 1),
  };
}

function normalizeDisplayId(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function findDisplayContainingPoint(displays: CaptureDisplay[], point: CapturePoint): CaptureDisplay | null {
  for (const display of displays) {
    const bounds = ensureBounds(display.bounds);
    if (
      point.x >= bounds.x
      && point.x <= bounds.x + bounds.width
      && point.y >= bounds.y
      && point.y <= bounds.y + bounds.height
    ) {
      return display;
    }
  }
  return null;
}

function findNearestDisplay(displays: CaptureDisplay[], point: CapturePoint): CaptureDisplay | null {
  if (displays.length === 0) return null;
  const containing = findDisplayContainingPoint(displays, point);
  if (containing) return containing;

  let best: CaptureDisplay | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const display of displays) {
    const bounds = ensureBounds(display.bounds);
    const cx = bounds.x + bounds.width / 2;
    const cy = bounds.y + bounds.height / 2;
    const distance = Math.hypot(point.x - cx, point.y - cy);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = display;
    }
  }

  return best;
}

export function resolveVirtualDesktopBounds(displays: CaptureDisplay[]): CaptureBounds {
  if (displays.length === 0) {
    return { x: 0, y: 0, width: 1, height: 1 };
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const display of displays) {
    const bounds = ensureBounds(display.bounds);
    minX = Math.min(minX, bounds.x);
    minY = Math.min(minY, bounds.y);
    maxX = Math.max(maxX, bounds.x + bounds.width);
    maxY = Math.max(maxY, bounds.y + bounds.height);
  }

  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

export function resolveCursorBoundsForSource(args: {
  displays: CaptureDisplay[];
  source?: CaptureSourceRef | null;
  pointHint?: CapturePoint;
}): CaptureBoundsResolution {
  const displays = args.displays;
  const virtualBounds = resolveVirtualDesktopBounds(displays);
  const source = args.source;
  if (!source || displays.length === 0) {
    return { bounds: virtualBounds, mode: 'virtual-desktop' };
  }

  const displayId = normalizeDisplayId(source.display_id);
  if (displayId) {
    const matchedById = displays.find((display) => normalizeDisplayId(display.id) === displayId);
    if (matchedById) {
      return {
        bounds: ensureBounds(matchedById.bounds),
        mode: 'source-display',
        displayId,
      };
    }
  }

  const sourceId = source.id ?? '';
  const screenIdMatch = sourceId.match(/^screen:(\d+):/);
  if (screenIdMatch) {
    const sortedDisplays = displays
      .slice()
      .sort((a, b) => {
        const ax = ensureBounds(a.bounds).x;
        const bx = ensureBounds(b.bounds).x;
        if (ax !== bx) return ax - bx;
        const ay = ensureBounds(a.bounds).y;
        const by = ensureBounds(b.bounds).y;
        return ay - by;
      });

    const index = Number(screenIdMatch[1]);
    const matchedByIndex = sortedDisplays[index];
    if (matchedByIndex) {
      return {
        bounds: ensureBounds(matchedByIndex.bounds),
        mode: 'source-display',
        displayId: normalizeDisplayId(matchedByIndex.id) ?? undefined,
      };
    }
  }

  if (args.pointHint) {
    const nearest = findNearestDisplay(displays, args.pointHint);
    if (nearest) {
      return {
        bounds: ensureBounds(nearest.bounds),
        mode: 'source-display',
        displayId: normalizeDisplayId(nearest.id) ?? undefined,
      };
    }
  }

  return { bounds: virtualBounds, mode: 'virtual-desktop' };
}

export function normalizePointToBounds(point: CapturePoint, bounds: CaptureBounds): { x: number; y: number } {
  const safeBounds = ensureBounds(bounds);
  return {
    x: clamp01((point.x - safeBounds.x) / safeBounds.width),
    y: clamp01((point.y - safeBounds.y) / safeBounds.height),
  };
}
