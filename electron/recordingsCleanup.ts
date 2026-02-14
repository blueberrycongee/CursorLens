import fs from 'node:fs/promises';
import path from 'node:path';
import {
  createRecordingCleanupPolicy,
  planRecordingCleanup,
  recordingGroupKeyFromFileName,
  type RecordingArtifactEntry,
  type RecordingCleanupPolicy,
} from '../src/lib/recordingsCleanupPolicy';

const BYTES_PER_GB = 1024 * 1024 * 1024;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
let cleanupQueue: Promise<void> = Promise.resolve();

type CleanupReason = 'startup' | 'post-recording' | 'post-native-recording';

export type RecordingsCleanupOptions = {
  recordingsDir: string;
  excludePaths?: string[];
  reason: CleanupReason;
  policy?: Partial<RecordingCleanupPolicy>;
};

function parseNumber(value: string | undefined): number | undefined {
  if (!value || value.trim().length === 0) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function clampNumber(value: number | undefined, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Number(value)));
}

function resolvePolicyFromEnv(overrides?: Partial<RecordingCleanupPolicy>): RecordingCleanupPolicy {
  const maxGb = clampNumber(parseNumber(process.env.OPENSCREEN_RECORDINGS_MAX_GB), 8, 1, 512);
  const trimRatio = clampNumber(parseNumber(process.env.OPENSCREEN_RECORDINGS_TRIM_RATIO), 0.8, 0.25, 0.95);
  const maxDays = clampNumber(parseNumber(process.env.OPENSCREEN_RECORDINGS_MAX_DAYS), 30, 1, 3650);
  const minKeep = Math.round(clampNumber(parseNumber(process.env.OPENSCREEN_RECORDINGS_MIN_KEEP), 20, 1, 1_000));
  const orphanDays = clampNumber(parseNumber(process.env.OPENSCREEN_ORPHAN_CURSOR_DAYS), 3, 0, 365);

  const maxTotalBytes = Math.floor(maxGb * BYTES_PER_GB);
  const targetTotalBytes = Math.floor(maxTotalBytes * trimRatio);
  const maxVideoAgeMs = Math.floor(maxDays * MS_PER_DAY);
  const orphanSidecarAgeMs = Math.floor(orphanDays * MS_PER_DAY);

  return createRecordingCleanupPolicy({
    maxTotalBytes,
    targetTotalBytes,
    maxVideoAgeMs,
    minKeepVideoGroups: minKeep,
    orphanSidecarAgeMs,
    ...overrides,
  });
}

async function readRecordingEntries(recordingsDir: string): Promise<RecordingArtifactEntry[]> {
  const dirEntries = await fs.readdir(recordingsDir, { withFileTypes: true });
  const fileEntries = dirEntries.filter((entry) => entry.isFile());
  const stats = await Promise.all(
    fileEntries.map(async (entry) => {
      const fullPath = path.join(recordingsDir, entry.name);
      try {
        const stat = await fs.stat(fullPath);
        return {
          name: entry.name,
          size: stat.size,
          mtimeMs: stat.mtimeMs,
        } satisfies RecordingArtifactEntry;
      } catch {
        return null;
      }
    }),
  );

  return stats.filter((item): item is RecordingArtifactEntry => Boolean(item));
}

function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

async function executeCleanup(options: RecordingsCleanupOptions): Promise<void> {
  const normalizedDir = path.resolve(options.recordingsDir);
  const policy = resolvePolicyFromEnv(options.policy);
  const entries = await readRecordingEntries(normalizedDir);
  const plan = planRecordingCleanup(entries, { policy });
  if (plan.filesToDelete.length === 0) {
    return;
  }

  const excludedGroupKeys = new Set(
    (options.excludePaths ?? [])
      .map((filePath) => path.basename(filePath))
      .map((fileName) => recordingGroupKeyFromFileName(fileName))
      .filter((key): key is string => Boolean(key)),
  );

  let deletedCount = 0;
  let deletedBytes = 0;
  const entryByName = new Map(entries.map((entry) => [entry.name, entry]));
  for (const fileName of plan.filesToDelete) {
    const groupKey = recordingGroupKeyFromFileName(fileName);
    if (groupKey && excludedGroupKeys.has(groupKey)) {
      continue;
    }

    if (path.basename(fileName) !== fileName) {
      continue;
    }

    const fullPath = path.join(normalizedDir, fileName);
    try {
      await fs.rm(fullPath, { force: true });
      deletedCount += 1;
      deletedBytes += entryByName.get(fileName)?.size ?? 0;
    } catch (error) {
      console.warn('[recordings-cleanup] failed to remove file:', fileName, error);
    }
  }

  if (deletedCount > 0) {
    console.info(
      `[recordings-cleanup] reason=${options.reason} deleted=${deletedCount} freed=${formatMegabytes(deletedBytes)} managedGroups=${plan.managedGroupCount}`,
    );
  }
}

export function scheduleRecordingsCleanup(options: RecordingsCleanupOptions): void {
  cleanupQueue = cleanupQueue
    .then(() => executeCleanup(options))
    .catch((error) => {
      console.warn('[recordings-cleanup] cleanup run failed:', error);
    });
}
