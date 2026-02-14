import { describe, expect, it } from "vitest";

import type { ZoomRegion } from "@/components/video-editor/types";

import {
  clearStaleSelectedZoomIdForAspect,
  getSelectedZoomIdForAspect,
  getZoomRegionsForAspect,
  setSelectedZoomIdForAspect,
  setZoomRegionsForAspect,
  type SelectedZoomIdByAspect,
  type ZoomRegionsByAspect,
} from "./aspectZoomState";

function createZoomRegion(id: string): ZoomRegion {
  return {
    id,
    startMs: 0,
    endMs: 500,
    depth: 3,
    focus: { cx: 0.5, cy: 0.5 },
  };
}

describe("aspectZoomState", () => {
  it("returns empty regions and null selected id for missing aspect state", () => {
    const regionsByAspect: ZoomRegionsByAspect = {};
    const selectedByAspect: SelectedZoomIdByAspect = {};

    expect(getZoomRegionsForAspect(regionsByAspect, "1:1")).toEqual([]);
    expect(getSelectedZoomIdForAspect(selectedByAspect, "1:1")).toBeNull();
  });

  it("writes zoom regions only for the targeted aspect", () => {
    const widescreen = [createZoomRegion("zoom-a")];
    const vertical = [createZoomRegion("zoom-b")];
    const regionsByAspect = setZoomRegionsForAspect({}, "16:9", widescreen);
    const next = setZoomRegionsForAspect(regionsByAspect, "9:16", vertical);

    expect(getZoomRegionsForAspect(next, "16:9")).toBe(widescreen);
    expect(getZoomRegionsForAspect(next, "9:16")).toBe(vertical);
  });

  it("keeps state reference when selected id does not change", () => {
    const selectedByAspect: SelectedZoomIdByAspect = { "16:9": "zoom-1" };
    const next = setSelectedZoomIdForAspect(selectedByAspect, "16:9", "zoom-1");
    expect(next).toBe(selectedByAspect);
  });

  it("clears stale selected ids per aspect without touching other aspects", () => {
    const selectedByAspect: SelectedZoomIdByAspect = {
      "16:9": "missing-zoom",
      "9:16": "zoom-v",
    };
    const regionsByAspect: ZoomRegionsByAspect = {
      "16:9": [createZoomRegion("zoom-w")],
      "9:16": [createZoomRegion("zoom-v")],
    };

    const next = clearStaleSelectedZoomIdForAspect(selectedByAspect, regionsByAspect, "16:9");
    expect(next["16:9"]).toBeNull();
    expect(next["9:16"]).toBe("zoom-v");
  });
});
