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

export type VideoTranscriptionResult = {
  success: boolean;
  code?: string;
  message?: string;
  locale?: string;
  text?: string;
  words?: TranscriptWord[];
};

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

export async function transcribeVideoFile(args: {
  inputPath: string;
  locale: string;
  timeoutMs?: number;
}): Promise<VideoTranscriptionResult> {
  if (process.platform !== 'darwin') {
    return {
      success: false,
      code: 'unsupported_platform',
      message: 'Automatic subtitle transcription is currently supported on macOS only.',
    };
  }

  const helperPath = await ensureHelperBinary();
  const outputPath = path.join(os.tmpdir(), `cursorlens-transcription-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  const timeoutMs = Math.max(10_000, Math.round(args.timeoutMs ?? 5 * 60 * 1000));

  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(helperPath, [
        '--input', args.inputPath,
        '--output', outputPath,
        '--locale', args.locale,
      ], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stderr = '';
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
        child.kill('SIGTERM');
      }, timeoutMs);

      child.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });

      child.on('exit', (code) => {
        clearTimeout(timeout);
        if (code === 0) {
          resolve();
          return;
        }
        reject(new Error(stderr.trim() || `speech-transcriber exited with code ${code ?? 'unknown'}`));
      });
    });

    const payloadRaw = await fs.readFile(outputPath, 'utf-8');
    const payload = parseHelperPayload(payloadRaw);

    if (!payload.success) {
      return {
        success: false,
        code: payload.code,
        message: payload.message,
      };
    }

    return {
      success: true,
      locale: payload.locale,
      text: payload.text,
      words: payload.words,
    };
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
