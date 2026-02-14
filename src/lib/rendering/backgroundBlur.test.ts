import { describe, expect, it } from "vitest";
import { getExportBackgroundFilter, getPreviewBackgroundFilter } from "./backgroundBlur";

describe("background blur helpers", () => {
  it("returns no filter when blur is disabled", () => {
    expect(getPreviewBackgroundFilter(false)).toBe("none");
    expect(getExportBackgroundFilter({ showBlur: false, outputWidth: 1920, previewWidth: 1280 })).toBe("none");
  });

  it("returns a stable preview blur filter", () => {
    expect(getPreviewBackgroundFilter(true)).toBe("blur(2px)");
  });

  it("scales export blur when exporting wider than preview", () => {
    expect(getExportBackgroundFilter({ showBlur: true, outputWidth: 1920, previewWidth: 960 })).toBe("blur(4px)");
  });
});
