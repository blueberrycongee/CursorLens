export type CapturePermissionStatus =
  | 'granted'
  | 'denied'
  | 'restricted'
  | 'not-determined'
  | 'unknown'
  | 'manual-check';

export type CapturePermissionKey =
  | 'screen'
  | 'camera'
  | 'microphone'
  | 'accessibility'
  | 'input-monitoring';

export type PermissionSettingsTarget =
  | 'screen-capture'
  | 'camera'
  | 'microphone'
  | 'accessibility'
  | 'input-monitoring';

export interface CapturePermissionItem {
  key: CapturePermissionKey;
  status: CapturePermissionStatus;
  requiredForRecording: boolean;
  canOpenSettings: boolean;
  settingsTarget?: PermissionSettingsTarget;
}

export interface CapturePermissionSnapshot {
  platform: string;
  checkedAtMs: number;
  canOpenSystemSettings: boolean;
  items: CapturePermissionItem[];
}

export function isPermissionGranted(status: CapturePermissionStatus): boolean {
  return status === 'granted';
}

export function isPermissionBlocked(status: CapturePermissionStatus): boolean {
  return status === 'denied' || status === 'restricted';
}

export function getPermissionItem(
  snapshot: CapturePermissionSnapshot,
  key: CapturePermissionKey,
): CapturePermissionItem | undefined {
  return snapshot.items.find((item) => item.key === key);
}

export function resolveRecordingPermissionReadiness(snapshot: CapturePermissionSnapshot): {
  ready: boolean;
  missingRequired: CapturePermissionItem[];
} {
  const missingRequired = snapshot.items.filter(
    (item) => item.requiredForRecording && !isPermissionGranted(item.status),
  );

  return {
    ready: missingRequired.length === 0,
    missingRequired,
  };
}

