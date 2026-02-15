import type { ExportAudioProcessingConfig } from "@/lib/exporter/types";

const DEFAULT_AUDIO_PROCESSING: Required<ExportAudioProcessingConfig> = {
  normalizeLoudness: true,
  targetLufs: -16,
  limiterDb: -1,
  maxBoostDb: 12,
  maxCutDb: 12,
};

export type NormalizedExportAudioProcessingConfig = {
  normalizeLoudness: boolean;
  targetLufs: number;
  limiterDb: number;
  limiterLinear: number;
  maxBoostDb: number;
  maxCutDb: number;
};

export type AudioEnergyStats = {
  sampleCount: number;
  sumSquares: number;
  peakAbs: number;
};

export type AudioNormalizationResolution = {
  measuredLufs: number | null;
  normalizationGain: number;
  limiterCompensationGain: number;
  appliedGain: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function dbToLinear(db: number): number {
  if (!Number.isFinite(db)) return 1;
  return Math.pow(10, db / 20);
}

export function linearToDb(linear: number): number {
  if (!Number.isFinite(linear) || linear <= 0) return Number.NEGATIVE_INFINITY;
  return 20 * Math.log10(linear);
}

export function normalizeExportAudioProcessingConfig(
  input?: ExportAudioProcessingConfig,
): NormalizedExportAudioProcessingConfig {
  const normalizeLoudness = input?.normalizeLoudness !== false;
  const targetLufs = clamp(
    Number.isFinite(input?.targetLufs) ? Number(input?.targetLufs) : DEFAULT_AUDIO_PROCESSING.targetLufs,
    -32,
    -8,
  );
  const limiterDb = clamp(
    Number.isFinite(input?.limiterDb) ? Number(input?.limiterDb) : DEFAULT_AUDIO_PROCESSING.limiterDb,
    -12,
    -0.1,
  );
  const maxBoostDb = clamp(
    Number.isFinite(input?.maxBoostDb) ? Number(input?.maxBoostDb) : DEFAULT_AUDIO_PROCESSING.maxBoostDb,
    0,
    24,
  );
  const maxCutDb = clamp(
    Number.isFinite(input?.maxCutDb) ? Number(input?.maxCutDb) : DEFAULT_AUDIO_PROCESSING.maxCutDb,
    0,
    24,
  );

  return {
    normalizeLoudness,
    targetLufs,
    limiterDb,
    limiterLinear: dbToLinear(limiterDb),
    maxBoostDb,
    maxCutDb,
  };
}

export function resolveExportAudioNormalizationGain(args: {
  stats: AudioEnergyStats;
  processing: NormalizedExportAudioProcessingConfig;
}): AudioNormalizationResolution {
  const { stats, processing } = args;
  if (
    !processing.normalizeLoudness
    || stats.sampleCount <= 0
    || !Number.isFinite(stats.sumSquares)
    || stats.sumSquares <= 0
  ) {
    return {
      measuredLufs: null,
      normalizationGain: 1,
      limiterCompensationGain: 1,
      appliedGain: 1,
    };
  }

  const rms = Math.sqrt(stats.sumSquares / stats.sampleCount);
  const measuredLufs = linearToDb(rms);
  if (!Number.isFinite(measuredLufs)) {
    return {
      measuredLufs: null,
      normalizationGain: 1,
      limiterCompensationGain: 1,
      appliedGain: 1,
    };
  }

  const targetDeltaDb = processing.targetLufs - measuredLufs;
  const clampedDeltaDb = clamp(targetDeltaDb, -processing.maxCutDb, processing.maxBoostDb);
  const normalizationGain = dbToLinear(clampedDeltaDb);

  let limiterCompensationGain = 1;
  const predictedPeak = Math.max(0, stats.peakAbs) * normalizationGain;
  if (predictedPeak > processing.limiterLinear && predictedPeak > 0) {
    limiterCompensationGain = processing.limiterLinear / predictedPeak;
  }

  return {
    measuredLufs,
    normalizationGain,
    limiterCompensationGain,
    appliedGain: normalizationGain * limiterCompensationGain,
  };
}
