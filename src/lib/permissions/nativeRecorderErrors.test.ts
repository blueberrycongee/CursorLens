import { describe, expect, it } from "vitest";
import { resolveNativeRecorderStartFailureMessage } from "./nativeRecorderErrors";

describe("resolveNativeRecorderStartFailureMessage", () => {
  it("maps permission_denied to explicit guidance", () => {
    const message = resolveNativeRecorderStartFailureMessage({
      code: "permission_denied",
    });

    expect(message).toContain("Screen Recording permission is not granted");
  });

  it("treats localized permission-like stream failures as permission guidance", () => {
    const message = resolveNativeRecorderStartFailureMessage({
      code: "stream_start_failed",
      fallbackMessage: "录屏权限被拒绝，请到系统设置中开启",
    });

    expect(message).toContain("Screen Recording permission is not granted");
  });

  it("preserves stream_start_failed diagnostics for non-permission failures", () => {
    const message = resolveNativeRecorderStartFailureMessage({
      code: "stream_start_failed",
      fallbackMessage: "The operation couldn’t be completed. (SCStreamErrorDomain error 3901)",
      sourceId: "screen:1:0",
    });

    expect(message).toContain("Failed to start screen capture.");
    expect(message).toContain("SCStreamErrorDomain error 3901");
  });

  it("uses window-specific guidance for source_not_found", () => {
    const message = resolveNativeRecorderStartFailureMessage({
      code: "source_not_found",
      sourceId: "window:123",
    });

    expect(message).toContain("window source is invalid");
  });
});

