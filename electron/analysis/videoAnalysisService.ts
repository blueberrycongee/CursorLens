import fs from 'node:fs/promises';
import path from 'node:path';
import {
  type AnalysisJobStatus,
  AnalysisJobQueue,
} from '../../src/lib/analysis/analysisQueue';
import {
  buildVideoAnalysisResult,
  type BuildVideoAnalysisInput,
} from '../../src/lib/analysis/videoAnalysisPipeline';
import type { VideoAnalysisResult } from '../../src/lib/analysis/types';
import { transcribeVideoFile } from '../native/transcriber';

export interface StartVideoAnalysisInput {
  videoPath: string;
  locale: string;
  durationMs: number;
  videoWidth: number;
  subtitleWidthRatio?: number;
}

const ANALYSIS_SIDECAR_SUFFIX = '.analysis.json';

function validateVideoPath(videoPath: string): string {
  const normalized = String(videoPath ?? '').trim();
  if (!normalized) {
    throw new Error('Video path is required.');
  }
  return normalized;
}

export function resolveAnalysisSidecarPath(videoPath: string): string {
  const parsed = path.parse(videoPath);
  return path.join(parsed.dir, `${parsed.name}${ANALYSIS_SIDECAR_SUFFIX}`);
}

export async function readAnalysisSidecar(videoPath: string): Promise<VideoAnalysisResult | null> {
  const sidecarPath = resolveAnalysisSidecarPath(videoPath);
  try {
    const raw = await fs.readFile(sidecarPath, 'utf-8');
    const parsed = JSON.parse(raw) as { analysis?: VideoAnalysisResult } | VideoAnalysisResult;
    const analysis = (parsed as { analysis?: VideoAnalysisResult }).analysis ?? (parsed as VideoAnalysisResult);
    if (!analysis || !analysis.transcript || !Array.isArray(analysis.subtitleCues) || !Array.isArray(analysis.roughCutSuggestions)) {
      return null;
    }
    return analysis;
  } catch {
    return null;
  }
}

async function writeAnalysisSidecar(videoPath: string, analysis: VideoAnalysisResult): Promise<void> {
  const sidecarPath = resolveAnalysisSidecarPath(videoPath);
  const payload = JSON.stringify(
    {
      version: 1,
      analysis,
    },
    null,
    2,
  );
  await fs.writeFile(sidecarPath, payload, 'utf-8');
}

function formatTranscriptionFailure(args: {
  code?: string;
  message?: string;
}): string {
  const code = String(args.code || '').trim();
  const message = String(args.message || '').trim();
  switch (code) {
    case 'speech_permission_denied':
      return 'Speech recognition permission denied. Open System Settings > Privacy & Security > Speech Recognition, allow CursorLens, then retry.';
    case 'recognizer_unavailable':
      return 'Speech recognizer is currently unavailable. Please retry later.';
    case 'transcription_timeout':
      return message || 'Speech transcription timed out. Please retry.';
    case 'no_speech_detected':
      return 'No speech was detected in this recording.';
    case 'transcription_failed':
    case 'audio_export_failed':
    case 'transcriber_execution_failed':
      return message || `Transcription failed (${code || 'unknown'}).`;
    default:
      return message || 'Automatic transcription failed.';
  }
}

export class VideoAnalysisService {
  private queue = new AnalysisJobQueue<StartVideoAnalysisInput, VideoAnalysisResult>();

  start(input: StartVideoAnalysisInput): { jobId: string } {
    const normalizedInput: StartVideoAnalysisInput = {
      ...input,
      videoPath: validateVideoPath(input.videoPath),
      locale: String(input.locale || 'en-US'),
      durationMs: Math.max(0, Math.round(Number(input.durationMs) || 0)),
      videoWidth: Math.max(320, Math.round(Number(input.videoWidth) || 1920)),
      subtitleWidthRatio: Number.isFinite(input.subtitleWidthRatio) ? Number(input.subtitleWidthRatio) : 0.82,
    };

    const { id, promise } = this.queue.enqueueWithId(normalizedInput, async (jobInput) => {
      const transcription = await transcribeVideoFile({
        inputPath: jobInput.videoPath,
        locale: jobInput.locale,
        durationMs: jobInput.durationMs,
      });

      if (!transcription.success || !transcription.words?.length) {
        throw new Error(formatTranscriptionFailure({
          code: transcription.code,
          message: transcription.message,
        }));
      }

      const pipelineConfig: BuildVideoAnalysisInput = {
        durationMs: jobInput.durationMs,
        videoWidth: jobInput.videoWidth,
        subtitleWidthRatio: Number.isFinite(jobInput.subtitleWidthRatio)
          ? Number(jobInput.subtitleWidthRatio)
          : 0.82,
        locale: jobInput.locale,
      };
      const analysis = buildVideoAnalysisResult(transcription.words, pipelineConfig);
      await writeAnalysisSidecar(jobInput.videoPath, analysis);
      return analysis;
    });

    void promise.catch(() => {
      // Job failure is tracked in queue status and consumed through IPC polling.
    });

    return { jobId: id };
  }

  getStatus(jobId: string): AnalysisJobStatus | null {
    return this.queue.getStatus(jobId) ?? null;
  }

  getResult(jobId: string): VideoAnalysisResult | null {
    return this.queue.getResult(jobId) ?? null;
  }
}
