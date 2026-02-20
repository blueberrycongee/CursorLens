import { isPermissionGranted, type CapturePermissionItem } from "./capturePermissions";

export type PermissionActionMode = "granted" | "request" | "open-settings" | "manual-check";

export function shouldRequestPermissionAccess(item: CapturePermissionItem): boolean {
  if (!item.canOpenSettings || !item.settingsTarget) return false;
  if (item.key === "input-monitoring") return false;
  return item.status === "not-determined";
}

export function resolvePermissionActionMode(item: CapturePermissionItem): PermissionActionMode {
  if (isPermissionGranted(item.status)) return "granted";
  if (shouldRequestPermissionAccess(item)) return "request";
  if (item.canOpenSettings && item.settingsTarget) return "open-settings";
  return "manual-check";
}
