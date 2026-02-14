import type { ZoomRegion } from "@/components/video-editor/types";
import type { AspectRatio } from "@/utils/aspectRatioUtils";

export type ZoomRegionsByAspect = Partial<Record<AspectRatio, ZoomRegion[]>>;
export type SelectedZoomIdByAspect = Partial<Record<AspectRatio, string | null>>;

const EMPTY_ZOOM_REGIONS: ZoomRegion[] = [];

export function getZoomRegionsForAspect(
  regionsByAspect: ZoomRegionsByAspect,
  aspectRatio: AspectRatio,
): ZoomRegion[] {
  return regionsByAspect[aspectRatio] ?? EMPTY_ZOOM_REGIONS;
}

export function setZoomRegionsForAspect(
  regionsByAspect: ZoomRegionsByAspect,
  aspectRatio: AspectRatio,
  zoomRegions: ZoomRegion[],
): ZoomRegionsByAspect {
  const previous = regionsByAspect[aspectRatio];
  if (previous === zoomRegions) {
    return regionsByAspect;
  }
  return {
    ...regionsByAspect,
    [aspectRatio]: zoomRegions,
  };
}

export function getSelectedZoomIdForAspect(
  selectedByAspect: SelectedZoomIdByAspect,
  aspectRatio: AspectRatio,
): string | null {
  return selectedByAspect[aspectRatio] ?? null;
}

export function setSelectedZoomIdForAspect(
  selectedByAspect: SelectedZoomIdByAspect,
  aspectRatio: AspectRatio,
  selectedZoomId: string | null,
): SelectedZoomIdByAspect {
  const previous = selectedByAspect[aspectRatio] ?? null;
  if (previous === selectedZoomId) {
    return selectedByAspect;
  }
  return {
    ...selectedByAspect,
    [aspectRatio]: selectedZoomId,
  };
}

export function clearStaleSelectedZoomIdForAspect(
  selectedByAspect: SelectedZoomIdByAspect,
  regionsByAspect: ZoomRegionsByAspect,
  aspectRatio: AspectRatio,
): SelectedZoomIdByAspect {
  const selectedZoomId = selectedByAspect[aspectRatio] ?? null;
  if (!selectedZoomId) {
    return selectedByAspect;
  }

  const regions = getZoomRegionsForAspect(regionsByAspect, aspectRatio);
  if (regions.some((region) => region.id === selectedZoomId)) {
    return selectedByAspect;
  }

  return setSelectedZoomIdForAspect(selectedByAspect, aspectRatio, null);
}
