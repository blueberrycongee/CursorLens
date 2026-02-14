const VIDEO_EXTENSIONS = new Set(['webm', 'mp4', 'mov', 'm4v', 'mkv', 'avi']);
const VIDEO_FILE_PATTERN = /^(recording-\d+)\.([a-z0-9]+)$/i;
const SIDECAR_PATTERN = /^(recording-\d+)\.(cursor|analysis)\.json$/i;

export interface RecordingArtifactEntry {
  name: string;
  size: number;
  mtimeMs: number;
}

export interface RecordingCleanupPolicy {
  maxTotalBytes: number;
  targetTotalBytes: number;
  maxVideoAgeMs: number;
  minKeepVideoGroups: number;
  orphanSidecarAgeMs: number;
}

export interface RecordingCleanupPlan {
  filesToDelete: string[];
  managedTotalBytes: number;
  managedGroupCount: number;
  estimatedBytesFreed: number;
}

type ManagedKind = 'video' | 'cursor-sidecar' | 'analysis-sidecar';

interface ManagedArtifact {
  key: string;
  kind: ManagedKind;
}

interface RecordingGroup {
  key: string;
  files: RecordingArtifactEntry[];
  hasVideo: boolean;
  totalBytes: number;
  latestMtimeMs: number;
}

export const DEFAULT_RECORDING_CLEANUP_POLICY: RecordingCleanupPolicy = {
  maxTotalBytes: 8 * 1024 * 1024 * 1024,
  targetTotalBytes: Math.floor(8 * 1024 * 1024 * 1024 * 0.8),
  maxVideoAgeMs: 30 * 24 * 60 * 60 * 1000,
  minKeepVideoGroups: 20,
  orphanSidecarAgeMs: 3 * 24 * 60 * 60 * 1000,
};

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function normalizePolicy(input?: Partial<RecordingCleanupPolicy>): RecordingCleanupPolicy {
  const merged = {
    ...DEFAULT_RECORDING_CLEANUP_POLICY,
    ...input,
  };
  const maxTotalBytes = clampInteger(merged.maxTotalBytes, 1, 512 * 1024 * 1024 * 1024);
  const targetTotalBytes = clampInteger(
    Math.min(merged.targetTotalBytes, maxTotalBytes),
    0,
    maxTotalBytes,
  );
  const maxVideoAgeMs = clampInteger(merged.maxVideoAgeMs, 0, 10 * 365 * 24 * 60 * 60 * 1000);
  const minKeepVideoGroups = clampInteger(merged.minKeepVideoGroups, 1, 1_000);
  const orphanSidecarAgeMs = clampInteger(merged.orphanSidecarAgeMs, 0, 365 * 24 * 60 * 60 * 1000);

  return {
    maxTotalBytes,
    targetTotalBytes,
    maxVideoAgeMs,
    minKeepVideoGroups,
    orphanSidecarAgeMs,
  };
}

function parseManagedArtifactName(fileName: string): ManagedArtifact | null {
  const sidecarMatch = SIDECAR_PATTERN.exec(fileName);
  if (sidecarMatch) {
    const sidecarKind = String(sidecarMatch[2] ?? '').toLowerCase();
    return {
      key: sidecarMatch[1],
      kind: sidecarKind === 'analysis' ? 'analysis-sidecar' : 'cursor-sidecar',
    };
  }

  const videoMatch = VIDEO_FILE_PATTERN.exec(fileName);
  if (!videoMatch) return null;
  const extension = videoMatch[2].toLowerCase();
  if (!VIDEO_EXTENSIONS.has(extension)) return null;

  return { key: videoMatch[1], kind: 'video' };
}

function toValidEntry(entry: RecordingArtifactEntry): RecordingArtifactEntry | null {
  if (typeof entry.name !== 'string' || entry.name.trim().length === 0) return null;
  const size = Number(entry.size);
  const mtimeMs = Number(entry.mtimeMs);
  if (!Number.isFinite(size) || size < 0) return null;
  if (!Number.isFinite(mtimeMs) || mtimeMs < 0) return null;

  return {
    name: entry.name.trim(),
    size: Math.floor(size),
    mtimeMs,
  };
}

function groupManagedArtifacts(entries: RecordingArtifactEntry[]): RecordingGroup[] {
  const byKey = new Map<string, RecordingGroup>();

  for (const entry of entries) {
    const managed = parseManagedArtifactName(entry.name);
    if (!managed) continue;

    const existing = byKey.get(managed.key);
    const group = existing ?? {
      key: managed.key,
      files: [],
      hasVideo: false,
      totalBytes: 0,
      latestMtimeMs: 0,
    };

    group.files.push(entry);
    group.hasVideo ||= managed.kind === 'video';
    group.totalBytes += entry.size;
    group.latestMtimeMs = Math.max(group.latestMtimeMs, entry.mtimeMs);
    byKey.set(managed.key, group);
  }

  return Array.from(byKey.values());
}

export function recordingGroupKeyFromFileName(fileName: string): string | null {
  const managed = parseManagedArtifactName(fileName);
  return managed?.key ?? null;
}

export function isManagedRecordingArtifactName(fileName: string): boolean {
  return parseManagedArtifactName(fileName) !== null;
}

export function createRecordingCleanupPolicy(input?: Partial<RecordingCleanupPolicy>): RecordingCleanupPolicy {
  return normalizePolicy(input);
}

export function planRecordingCleanup(
  entries: RecordingArtifactEntry[],
  options?: {
    nowMs?: number;
    policy?: Partial<RecordingCleanupPolicy>;
  },
): RecordingCleanupPlan {
  const normalizedEntries = entries
    .map(toValidEntry)
    .filter((entry): entry is RecordingArtifactEntry => Boolean(entry));
  const policy = normalizePolicy(options?.policy);
  const nowMs = Number.isFinite(options?.nowMs) ? Number(options?.nowMs) : Date.now();
  const groups = groupManagedArtifacts(normalizedEntries);
  const managedTotalBytes = groups.reduce((sum, group) => sum + group.totalBytes, 0);

  const groupsByNewest = groups.slice().sort((left, right) => right.latestMtimeMs - left.latestMtimeMs);
  const videoGroupsByNewest = groupsByNewest.filter((group) => group.hasVideo);
  const protectedVideoKeys = new Set(
    videoGroupsByNewest
      .slice(0, policy.minKeepVideoGroups)
      .map((group) => group.key),
  );

  const deletedKeys = new Set<string>();

  const ageThreshold = nowMs - policy.maxVideoAgeMs;
  for (const group of videoGroupsByNewest) {
    if (group.latestMtimeMs >= ageThreshold) continue;
    if (protectedVideoKeys.has(group.key)) continue;
    deletedKeys.add(group.key);
  }

  const remainingVideoGroups = videoGroupsByNewest
    .filter((group) => !deletedKeys.has(group.key))
    .sort((left, right) => left.latestMtimeMs - right.latestMtimeMs);

  let remainingVideoBytes = remainingVideoGroups.reduce((sum, group) => sum + group.totalBytes, 0);
  if (remainingVideoBytes > policy.maxTotalBytes) {
    for (const group of remainingVideoGroups) {
      if (remainingVideoBytes <= policy.targetTotalBytes) break;
      if (protectedVideoKeys.has(group.key)) continue;
      if (deletedKeys.has(group.key)) continue;
      deletedKeys.add(group.key);
      remainingVideoBytes -= group.totalBytes;
    }
  }

  const orphanThreshold = nowMs - policy.orphanSidecarAgeMs;
  for (const group of groupsByNewest) {
    if (group.hasVideo) continue;
    if (group.latestMtimeMs > orphanThreshold) continue;
    deletedKeys.add(group.key);
  }

  const filesToDelete: string[] = [];
  let estimatedBytesFreed = 0;
  for (const group of groupsByNewest) {
    if (!deletedKeys.has(group.key)) continue;
    for (const file of group.files) {
      filesToDelete.push(file.name);
      estimatedBytesFreed += file.size;
    }
  }

  filesToDelete.sort((left, right) => left.localeCompare(right));

  return {
    filesToDelete,
    managedTotalBytes,
    managedGroupCount: groups.length,
    estimatedBytesFreed,
  };
}
