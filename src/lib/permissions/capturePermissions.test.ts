import { describe, expect, it } from 'vitest';
import {
  getPermissionItem,
  isPermissionBlocked,
  isPermissionGranted,
  resolveRecordingPermissionReadiness,
  type CapturePermissionSnapshot,
} from './capturePermissions';

function snapshot(overrides?: Partial<CapturePermissionSnapshot>): CapturePermissionSnapshot {
  return {
    platform: 'darwin',
    checkedAtMs: 1,
    canOpenSystemSettings: true,
    items: [
      {
        key: 'screen',
        status: 'granted',
        requiredForRecording: true,
        canOpenSettings: true,
        settingsTarget: 'screen-capture',
      },
      {
        key: 'microphone',
        status: 'denied',
        requiredForRecording: false,
        canOpenSettings: true,
        settingsTarget: 'microphone',
      },
    ],
    ...overrides,
  };
}

describe('capturePermissions', () => {
  it('marks granted status as granted', () => {
    expect(isPermissionGranted('granted')).toBe(true);
    expect(isPermissionGranted('unknown')).toBe(false);
  });

  it('treats denied and restricted as blocked', () => {
    expect(isPermissionBlocked('denied')).toBe(true);
    expect(isPermissionBlocked('restricted')).toBe(true);
    expect(isPermissionBlocked('not-determined')).toBe(false);
  });

  it('resolves recording readiness from required permissions only', () => {
    const readyResult = resolveRecordingPermissionReadiness(snapshot());
    expect(readyResult.ready).toBe(true);
    expect(readyResult.missingRequired).toHaveLength(0);

    const blockedResult = resolveRecordingPermissionReadiness(
      snapshot({
        items: [
          {
            key: 'screen',
            status: 'denied',
            requiredForRecording: true,
            canOpenSettings: true,
            settingsTarget: 'screen-capture',
          },
          {
            key: 'microphone',
            status: 'denied',
            requiredForRecording: false,
            canOpenSettings: true,
            settingsTarget: 'microphone',
          },
        ],
      }),
    );
    expect(blockedResult.ready).toBe(false);
    expect(blockedResult.missingRequired).toHaveLength(1);
    expect(blockedResult.missingRequired[0]?.key).toBe('screen');
  });

  it('looks up permission items by key', () => {
    const item = getPermissionItem(snapshot(), 'microphone');
    expect(item?.status).toBe('denied');
  });
});

