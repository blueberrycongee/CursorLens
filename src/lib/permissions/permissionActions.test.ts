import { describe, expect, it } from "vitest";
import {
  resolvePermissionActionMode,
  shouldRequestPermissionAccess,
  type PermissionActionMode,
} from "./permissionActions";
import type { CapturePermissionItem } from "./capturePermissions";

function item(overrides?: Partial<CapturePermissionItem>): CapturePermissionItem {
  return {
    key: "screen",
    status: "not-determined",
    requiredForRecording: true,
    canOpenSettings: true,
    settingsTarget: "screen-capture",
    ...overrides,
  };
}

describe("permissionActions", () => {
  it("requests access only for requestable not-determined permissions", () => {
    expect(shouldRequestPermissionAccess(item())).toBe(true);
    expect(shouldRequestPermissionAccess(item({ key: "input-monitoring", status: "not-determined", settingsTarget: "input-monitoring" }))).toBe(false);
    expect(shouldRequestPermissionAccess(item({ status: "denied" }))).toBe(false);
  });

  it("resolves action modes by permission status and capability", () => {
    const cases: Array<{ mode: PermissionActionMode; source: CapturePermissionItem }> = [
      { mode: "granted", source: item({ status: "granted" }) },
      { mode: "request", source: item({ status: "not-determined" }) },
      { mode: "open-settings", source: item({ status: "denied" }) },
      { mode: "manual-check", source: item({ canOpenSettings: false, settingsTarget: undefined }) },
    ];

    for (const entry of cases) {
      expect(resolvePermissionActionMode(entry.source)).toBe(entry.mode);
    }
  });
});
