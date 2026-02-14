import { app } from 'electron';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { TranscriptWord } from '../../src/lib/analysis/types';

type HelperSuccessPayload = {
  success: true;
  locale: string;
  text: string;
  words: TranscriptWord[];
};

type HelperErrorPayload = {
  success: false;
  code?: string;
  message?: string;
};

type HelperPayload = HelperSuccessPayload | HelperErrorPayload;

type HelperRunOptions = {
  helperPath: string;
  inputPath: string;
  outputPath: string;
  locale: string;
  timeoutMs: number;
  segmentStartMs?: number;
  segmentDurationMs?: number;
};

type HelperRunOutcome = {
  exitCode: number | null;
  timedOut: boolean;
  stderr: string;
  payload?: HelperPayload;
};

type TranscriptSegment = {
  startMs: number;
  durationMs: number;
};

export type VideoTranscriptionResult = {
  success: boolean;
  code?: string;
  message?: string;
  locale?: string;
  text?: string;
  words?: TranscriptWord[];
};

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1_000;
const SEGMENTED_TRANSCRIPTION_THRESHOLD_MS = 6 * 60 * 1_000;
const SEGMENT_LENGTH_MS = 90 * 1_000;
const SEGMENT_OVERLAP_MS = 1_800;

function msToClock(ms: number): string {
  const safeMs = Math.max(0, Math.round(ms));
  const totalSeconds = Math.floor(safeMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function resolveSegmentTimeoutMs(segmentDurationMs: number, timeoutHintMs?: number): number {
  const hinted = Number.isFinite(timeoutHintMs) ? Number(timeoutHintMs) : DEFAULT_TIMEOUT_MS;
  const scaled = Math.round(segmentDurationMs * 2.2);
  return Math.max(45_000, Math.min(Math.max(hinted, 75_000), Math.max(120_000, scaled)));
}

function buildSegmentPlan(durationMs: number): TranscriptSegment[] {
  const normalizedDurationMs = Math.max(0, Math.round(durationMs));
  if (normalizedDurationMs <= 0) {
    return [];
  }

  const segments: TranscriptSegment[] = [];
  let startMs = 0;
  while (startMs < normalizedDurationMs) {
    const durationMs = Math.min(SEGMENT_LENGTH_MS, normalizedDurationMs - startMs);
    segments.push({ startMs, durationMs });
    if (startMs + durationMs >= normalizedDurationMs) {
      break;
    }
    startMs += Math.max(1, durationMs - SEGMENT_OVERLAP_MS);
  }
  return segments;
}

function normalizeTranscriptWords(input: TranscriptWord[] | undefined): TranscriptWord[] {
  if (!Array.isArray(input)) return [];

  return input
    .map((word) => {
      const text = String(word.text ?? '').trim();
      const startMs = Number(word.startMs);
      const endMs = Number(word.endMs);
      const confidence = Number(word.confidence);
      if (!text || !Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
        return null;
      }
      const normalized: TranscriptWord = {
        text,
        startMs: Math.max(0, Math.round(startMs)),
        endMs: Math.max(0, Math.round(endMs)),
      };
      if (Number.isFinite(confidence)) {
        normalized.confidence = confidence;
      }
      return normalized;
    })
    .filter((word): word is TranscriptWord => word !== null)
    .sort((left, right) => left.startMs - right.startMs);
}

function parseHelperPayload(raw: string): HelperPayload {
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  if (parsed.success === true) {
    return {
      success: true,
      locale: String(parsed.locale ?? ''),
      text: String(parsed.text ?? ''),
      words: normalizeTranscriptWords(parsed.words as TranscriptWord[] | undefined),
    };
  }

  return {
    success: false,
    code: typeof parsed.code === 'string' ? parsed.code : undefined,
    message: typeof parsed.message === 'string' ? parsed.message : 'Unknown transcription error',
  };
}

function describeOutcomeFailure(outcome: HelperRunOutcome, timeoutMs: number): VideoTranscriptionResult {
  if (outcome.payload && !outcome.payload.success) {
    return {
      success: false,
      code: outcome.payload.code,
      message: outcome.payload.message,
    };
  }

  if (outcome.timedOut) {
    return {
      success: false,
      code: 'transcription_timeout',
      message: `Speech transcription timed out after ${Math.round(timeoutMs / 1000)} seconds.`,
    };
  }

  const exitCodeSuffix = outcome.exitCode === null ? 'unknown' : String(outcome.exitCode);
  const stderr = outcome.stderr.trim();
  return {
    success: false,
    code: 'transcriber_execution_failed',
    message: stderr.length > 0
      ? `speech-transcriber exited with code ${exitCodeSuffix}: ${stderr}`
      : `speech-transcriber exited with code ${exitCodeSuffix}.`,
  };
}

function buildTranscriptText(words: TranscriptWord[]): string {
  return words.map((word) => word.text).join(' ').trim();
}

function offsetWords(words: TranscriptWord[], offsetMs: number): TranscriptWord[] {
  const roundedOffset = Math.max(0, Math.round(offsetMs));
  return words.map((word) => ({
    ...word,
    startMs: Math.max(0, Math.round(word.startMs + roundedOffset)),
    endMs: Math.max(0, Math.round(word.endMs + roundedOffset)),
  }));
}

function filterLeadingOverlap(words: TranscriptWord[], segment: TranscriptSegment, segmentIndex: number): TranscriptWord[] {
  if (segmentIndex <= 0) return words;
  const cutoffMs = segment.startMs + Math.floor(SEGMENT_OVERLAP_MS * 0.65);
  return words.filter((word) => word.startMs >= cutoffMs);
}

async function ensureHelperBinary(): Promise<string> {
  const helperPath = app.isPackaged
    ? path.join(process.resourcesPath, 'native', 'speech-transcriber')
    : path.join(app.getAppPath(), 'electron', 'native', 'bin', 'speech-transcriber');

  try {
    await fs.access(helperPath);
    return helperPath;
  } catch {
    if (app.isPackaged) {
      throw new Error(`Native speech transcriber helper missing: ${helperPath}`);
    }
  }

  const projectRoot = app.getAppPath();
  const sourcePath = path.join(projectRoot, 'electron', 'native', 'macos', 'speech-transcriber.swift');
  await fs.mkdir(path.dirname(helperPath), { recursive: true });

  await new Promise<void>((resolve, reject) => {
    const compile = spawn('xcrun', [
      'swiftc',
      '-parse-as-library',
      '-O',
      sourcePath,
      '-framework', 'Foundation',
      '-framework', 'AVFoundation',
      '-framework', 'Speech',
      '-o', helperPath,
    ], {
      cwd: projectRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    compile.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });

    compile.on('error', (error) => {
      reject(error);
    });

    compile.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(stderr.trim() || `swiftc failed with code ${code ?? 'unknown'}`));
      }
    });
  });

  await fs.chmod(helperPath, 0o755);
  return helperPath;
}

async function runHelper(options: HelperRunOptions): Promise<HelperRunOutcome> {
  const args = [
    '--input', options.inputPath,
    '--output', options.outputPath,
    '--locale', options.locale,
  ];

  if (Number.isFinite(options.segmentStartMs)) {
    args.push('--start-ms', String(Math.max(0, Math.round(Number(options.segmentStartMs)))));
  }
  if (Number.isFinite(options.segmentDurationMs)) {
    args.push('--duration-ms', String(Math.max(1, Math.round(Number(options.segmentDurationMs)))));
  }

  let timedOut = false;
  let stderr = '';
  let exitCode: number | null = null;

  await new Promise<void>((resolve, reject) => {
    const child = spawn(options.helperPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stderr.on('data', (chunk) => {
      const line = String(chunk);
      stderr += line;
      console.error(`[speech-transcriber] ${line.trim()}`);
    });

    child.stdout.on('data', (chunk) => {
      const line = String(chunk).trim();
      if (line) {
        console.log(`[speech-transcriber] ${line}`);
      }
    });

    const timeout = globalThis.setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, options.timeoutMs);

    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.on('exit', (code) => {
      clearTimeout(timeout);
      exitCode = code;
      resolve();
    });
  });

  let payload: HelperPayload | undefined;
  try {
    const payloadRaw = await fs.readFile(options.outputPath, 'utf-8');
    payload = parseHelperPayload(payloadRaw);
  } catch {
    payload = undefined;
  }

  return {
    exitCode,
    timedOut,
    stderr,
    payload,
  };
}

async function transcribeSingleRange(args: {
  helperPath: string;
  inputPath: string;
  locale: string;
  timeoutMs: number;
  segmentStartMs?: number;
  segmentDurationMs?: number;
}): Promise<VideoTranscriptionResult> {
  const outputPath = path.join(
    os.tmpdir(),
    `cursorlens-transcription-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
  );

  try {
    const outcome = await runHelper({
      helperPath: args.helperPath,
      inputPath: args.inputPath,
      outputPath,
      locale: args.locale,
      timeoutMs: args.timeoutMs,
      segmentStartMs: args.segmentStartMs,
      segmentDurationMs: args.segmentDurationMs,
    });

    if (outcome.payload?.success) {
      return {
        success: true,
        locale: outcome.payload.locale,
        text: outcome.payload.text,
        words: outcome.payload.words,
      };
    }

    return describeOutcomeFailure(outcome, args.timeoutMs);
  } catch (error) {
    return {
      success: false,
      code: 'transcriber_execution_failed',
      message: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await fs.rm(outputPath, { force: true }).catch(() => undefined);
  }
}

export async function transcribeVideoFile(args: {
  inputPath: string;
  locale: string;
  timeoutMs?: number;
  durationMs?: number;
}): Promise<VideoTranscriptionResult> {
  if (process.platform !== 'darwin') {
    return {
      success: false,
      code: 'unsupported_platform',
      message: 'Automatic subtitle transcription is currently supported on macOS only.',
    };
  }

  const helperPath = await ensureHelperBinary();
  const timeoutMs = Math.max(10_000, Math.round(args.timeoutMs ?? DEFAULT_TIMEOUT_MS));
  const requestedDurationMs = Number.isFinite(args.durationMs)
    ? Math.max(0, Math.round(Number(args.durationMs)))
    : 0;

  if (requestedDurationMs < SEGMENTED_TRANSCRIPTION_THRESHOLD_MS) {
    const result = await transcribeSingleRange({
      helperPath,
      inputPath: args.inputPath,
      locale: args.locale,
      timeoutMs,
    });
    if (!result.success) {
      return result;
    }
    const normalizedWords = normalizeTranscriptWords(result.words);
    return {
      success: normalizedWords.length > 0,
      code: normalizedWords.length > 0 ? undefined : 'no_speech_detected',
      message: normalizedWords.length > 0 ? undefined : 'No transcript words were generated.',
      locale: result.locale,
      text: buildTranscriptText(normalizedWords),
      words: normalizedWords,
    };
  }

  const segments = buildSegmentPlan(requestedDurationMs);
  if (segments.length === 0) {
    return {
      success: false,
      code: 'invalid_duration',
      message: 'Invalid video duration for transcription.',
    };
  }

  const mergedWords: TranscriptWord[] = [];
  let resolvedLocale = args.locale;

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const segmentTimeoutMs = resolveSegmentTimeoutMs(segment.durationMs, timeoutMs);
    const segmentResult = await transcribeSingleRange({
      helperPath,
      inputPath: args.inputPath,
      locale: args.locale,
      timeoutMs: segmentTimeoutMs,
      segmentStartMs: segment.startMs,
      segmentDurationMs: segment.durationMs,
    });

    if (!segmentResult.success) {
      return {
        success: false,
        code: segmentResult.code ?? 'transcription_segment_failed',
        message: `Subtitle transcription failed on segment ${index + 1}/${segments.length} (${msToClock(segment.startMs)} - ${msToClock(segment.startMs + segment.durationMs)}): ${segmentResult.message ?? 'Unknown transcription error.'}`,
      };
    }

    if (segmentResult.locale) {
      resolvedLocale = segmentResult.locale;
    }

    const offsetSegmentWords = offsetWords(normalizeTranscriptWords(segmentResult.words), segment.startMs);
    const dedupedSegmentWords = filterLeadingOverlap(offsetSegmentWords, segment, index);
    mergedWords.push(...dedupedSegmentWords);
  }

  const normalizedMergedWords = normalizeTranscriptWords(mergedWords);
  if (normalizedMergedWords.length === 0) {
    return {
      success: false,
      code: 'no_speech_detected',
      message: 'No transcript words were generated.',
    };
  }

  return {
    success: true,
    locale: resolvedLocale,
    text: buildTranscriptText(normalizedMergedWords),
    words: normalizedMergedWords,
  };
}
