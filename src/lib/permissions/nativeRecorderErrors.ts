type NativeRecorderStartFailureInput = {
  code?: string;
  fallbackMessage?: string;
  sourceId?: string;
};

const SCREEN_RECORDING_PERMISSION_GUIDANCE =
  "Screen Recording permission is not granted. Open System Settings > Privacy & Security > Screen Recording, allow CursorLens, then relaunch the app.";

const MICROPHONE_PERMISSION_GUIDANCE =
  "Microphone permission is not granted. Open System Settings > Privacy & Security > Microphone, allow CursorLens, then relaunch the app.";

const PERMISSION_SIGNAL_TERMS = [
  "permission",
  "not authorized",
  "denied",
  "not permitted",
  "unauthorized",
  "没有权限",
  "無權限",
  "无权限",
  "未授权",
  "未授權",
  "拒绝",
  "拒絕",
  "不允许",
  "不允許",
  "屏幕录制",
  "螢幕錄製",
  "screen recording",
];

function normalizeMessage(raw?: string): string | undefined {
  if (typeof raw !== "string") return undefined;
  const normalized = raw.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function hasPermissionSignal(message?: string): boolean {
  if (!message) return false;
  const normalized = message.toLowerCase();
  return PERMISSION_SIGNAL_TERMS.some((term) => normalized.includes(term.toLowerCase()));
}

function appendDetails(prefix: string, details?: string): string {
  if (!details) return prefix;
  const trimmed = details.replace(/\s+/g, " ").trim();
  if (!trimmed) return prefix;
  return `${prefix} Details: ${trimmed}`;
}

export function resolveNativeRecorderStartFailureMessage(
  input: NativeRecorderStartFailureInput,
): string {
  const fallbackMessage = normalizeMessage(input.fallbackMessage);
  const isWindowSource = typeof input.sourceId === "string" && input.sourceId.startsWith("window:");

  switch (input.code) {
    case "permission_denied":
      return SCREEN_RECORDING_PERMISSION_GUIDANCE;
    case "microphone_permission_denied":
      return MICROPHONE_PERMISSION_GUIDANCE;
    case "microphone_unavailable":
      return "No available microphone input was found. Connect/enable a microphone and try again.";
    case "window_not_found":
      return "The selected window is no longer available (it may be minimized, closed, or moved to another Space). Keep the window on-screen and try again.";
    case "window_capture_denied":
      return "macOS blocked capture for this window (protected/secure content). Select a different window that allows capture.";
    case "source_not_found":
      return isWindowSource
        ? "The selected window source is invalid. Re-select the window and try again."
        : "The selected capture source is invalid. Re-select a source and try again.";
    case "stream_start_failed":
      if (hasPermissionSignal(fallbackMessage)) {
        return SCREEN_RECORDING_PERMISSION_GUIDANCE;
      }
      return isWindowSource
        ? appendDetails("Failed to start capture for the selected window. Keep the window visible and try again.", fallbackMessage)
        : appendDetails("Failed to start screen capture.", fallbackMessage);
    default:
      return fallbackMessage ?? "Failed to start native screen recorder.";
  }
}

