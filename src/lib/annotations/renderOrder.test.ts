import { describe, expect, it } from "vitest";
import { getRenderableAnnotations, isAnnotationActiveAtTime } from "./renderOrder";
import type { AnnotationRegion } from "@/components/video-editor/types";

let annotationCounter = 0;

function makeAnnotation(partial: Partial<AnnotationRegion>): AnnotationRegion {
  return {
    id: partial.id ?? `annotation-${annotationCounter++}`,
    type: partial.type ?? "text",
    content: partial.content ?? "",
    position: partial.position ?? { x: 10, y: 10 },
    size: partial.size ?? { width: 20, height: 10 },
    style: partial.style ?? {
      color: "#fff",
      backgroundColor: "transparent",
      fontSize: 20,
      fontFamily: "Inter",
      fontWeight: "400",
      fontStyle: "normal",
      textDecoration: "none",
      textAlign: "center",
    },
    startMs: partial.startMs ?? 0,
    endMs: partial.endMs ?? 1000,
    zIndex: partial.zIndex ?? 0,
    createdAt: partial.createdAt ?? Date.now(),
    ...partial,
  };
}

describe("annotation render order", () => {
  it("only includes annotations active at the current time", () => {
    const active = makeAnnotation({ id: "active", startMs: 100, endMs: 300 });
    const inactive = makeAnnotation({ id: "inactive", startMs: 400, endMs: 500 });

    const result = getRenderableAnnotations([active, inactive], 200);
    expect(result.map((item) => item.id)).toEqual(["active"]);
  });

  it("sorts by z-index and preserves source order for identical z-index values", () => {
    const a = makeAnnotation({ id: "a", zIndex: 3 });
    const b = makeAnnotation({ id: "b", zIndex: 1 });
    const c = makeAnnotation({ id: "c", zIndex: 3 });

    const result = getRenderableAnnotations([a, b, c], 100);
    expect(result.map((item) => item.id)).toEqual(["b", "a", "c"]);
  });

  it("handles invalid time ranges defensively", () => {
    const invalid = makeAnnotation({ id: "invalid", startMs: Number.NaN, endMs: 100 });
    expect(isAnnotationActiveAtTime(invalid, 50)).toBe(false);
    expect(getRenderableAnnotations([invalid], 50)).toEqual([]);
  });
});
