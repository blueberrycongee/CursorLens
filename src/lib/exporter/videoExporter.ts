import type { ExportConfig, ExportProgress, ExportResult } from './types';
import { VideoFileDecoder } from './videoDecoder';
import { FrameRenderer } from './frameRenderer';
import { VideoMuxer } from './muxer';
import type { ZoomRegion, CropRegion, TrimRegion, AnnotationRegion, AudioEditRegion } from '@/components/video-editor/types';
import type { SubtitleCue } from '@/lib/analysis/types';
import { frameDurationUs, frameIndexToTimestampUs, normalizeFrameRate } from './frameClock';
import type { CursorStyleConfig, CursorTrack } from '@/lib/cursor';
import { getAudioEditGainMultiplierAtTime, normalizeAudioEditRegions } from '@/lib/audio/audioEditRegions';
import { ALL_FORMATS, AudioBufferSink, BlobSource, Input, UrlSource, type InputAudioTrack } from 'mediabunny';

interface VideoExporterConfig extends ExportConfig {
  videoUrl: string;
  wallpaper: string;
  zoomRegions: ZoomRegion[];
  trimRegions?: TrimRegion[];
  showShadow: boolean;
  shadowIntensity: number;
  showBlur: boolean;
  motionBlurEnabled?: boolean;
  borderRadius?: number;
  padding?: number;
  videoPadding?: number;
  cropRegion: CropRegion;
  annotationRegions?: AnnotationRegion[];
  subtitleCues?: SubtitleCue[];
  audioEditRegions?: AudioEditRegion[];
  previewWidth?: number;
  previewHeight?: number;
  cursorTrack?: CursorTrack | null;
  cursorStyle?: Partial<CursorStyleConfig>;
  onProgress?: (progress: ExportProgress) => void;
}

type TimeRangeMs = {
  startMs: number;
  endMs: number;
};

type AudioGainSegment = {
  startMs: number;
  endMs: number;
  gain: number;
};

const DEFAULT_AUDIO_GAIN = 1;
const MAX_AUDIO_GAIN = 2;
const EXPORT_WARNING_AUDIO_TRACK_UNAVAILABLE = 'editor.exportWarningAudioTrackUnavailable';

export function hasRecordedCursorSamples(track?: CursorTrack | null): boolean {
  if (!track?.samples?.length) return false;
  return track.samples.some((sample) =>
    Number.isFinite(sample.timeMs) && Number.isFinite(sample.x) && Number.isFinite(sample.y),
  );
}

export function getSeekToleranceSeconds(frameRate: number): number {
  const safeFrameRate = Number.isFinite(frameRate) && frameRate > 0 ? frameRate : 60;
  return Math.max(1 / (safeFrameRate * 2), 1 / 240);
}

export function shouldSeekToTime(currentTime: number, targetTime: number, frameRate: number): boolean {
  return Math.abs(currentTime - targetTime) > getSeekToleranceSeconds(frameRate);
}

export function estimateRemainingSeconds(currentFrame: number, totalFrames: number, elapsedMs: number): number {
  if (!Number.isFinite(currentFrame) || !Number.isFinite(totalFrames) || !Number.isFinite(elapsedMs)) {
    return 0;
  }
  if (currentFrame <= 0 || totalFrames <= currentFrame || elapsedMs <= 0) {
    return 0;
  }
  const msPerFrame = elapsedMs / currentFrame;
  return Math.max(0, Math.round(((totalFrames - currentFrame) * msPerFrame) / 1000));
}

export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timeout = globalThis.setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        globalThis.clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        globalThis.clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

export function clampAudioGain(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_AUDIO_GAIN;
  return Math.max(0, Math.min(MAX_AUDIO_GAIN, value as number));
}

export function buildAudioGainSegments(
  rangeStartMs: number,
  rangeEndMs: number,
  baseGain: number,
  audioEditRegions: AudioEditRegion[] | undefined,
): AudioGainSegment[] {
  const safeStart = Math.max(0, Math.min(rangeStartMs, rangeEndMs));
  const safeEnd = Math.max(safeStart, Math.max(rangeStartMs, rangeEndMs));
  if (safeEnd <= safeStart) {
    return [];
  }

  const normalizedBaseGain = clampAudioGain(baseGain);
  if (!audioEditRegions?.length) {
    return [{ startMs: safeStart, endMs: safeEnd, gain: normalizedBaseGain }];
  }

  const boundaries = new Set<number>([safeStart, safeEnd]);
  for (const region of audioEditRegions) {
    if (region.endMs <= safeStart || region.startMs >= safeEnd) {
      continue;
    }
    boundaries.add(Math.max(safeStart, region.startMs));
    boundaries.add(Math.min(safeEnd, region.endMs));
  }

  const sortedBoundaries = Array.from(boundaries).sort((left, right) => left - right);
  const segments: AudioGainSegment[] = [];

  for (let index = 0; index < sortedBoundaries.length - 1; index += 1) {
    const segmentStartMs = sortedBoundaries[index];
    const segmentEndMs = sortedBoundaries[index + 1];
    if (segmentEndMs <= segmentStartMs) {
      continue;
    }

    const midpointMs = segmentStartMs + (segmentEndMs - segmentStartMs) / 2;
    const regionMultiplier = getAudioEditGainMultiplierAtTime(midpointMs, audioEditRegions);
    segments.push({
      startMs: segmentStartMs,
      endMs: segmentEndMs,
      gain: clampAudioGain(normalizedBaseGain * regionMultiplier),
    });
  }

  return segments;
}

export function normalizeTrimRanges(trimRegions: TrimRegion[] | undefined, totalDurationMs: number): TimeRangeMs[] {
  if (!trimRegions?.length || !Number.isFinite(totalDurationMs) || totalDurationMs <= 0) {
    return [];
  }

  const sorted = trimRegions
    .map((region) => {
      const start = Number.isFinite(region.startMs) ? region.startMs : 0;
      const end = Number.isFinite(region.endMs) ? region.endMs : start;
      return {
        startMs: Math.max(0, Math.min(start, totalDurationMs)),
        endMs: Math.max(0, Math.min(end, totalDurationMs)),
      };
    })
    .filter((region) => region.endMs > region.startMs)
    .sort((a, b) => a.startMs - b.startMs);

  if (sorted.length === 0) {
    return [];
  }

  const merged: TimeRangeMs[] = [];
  for (const region of sorted) {
    const previous = merged[merged.length - 1];
    if (!previous || region.startMs > previous.endMs) {
      merged.push({ ...region });
      continue;
    }

    previous.endMs = Math.max(previous.endMs, region.endMs);
  }

  return merged;
}

export function buildKeptRanges(totalDurationMs: number, trimRegions: TrimRegion[] | undefined): TimeRangeMs[] {
  if (!Number.isFinite(totalDurationMs) || totalDurationMs <= 0) {
    return [];
  }

  const normalizedTrims = normalizeTrimRanges(trimRegions, totalDurationMs);
  if (normalizedTrims.length === 0) {
    return [{ startMs: 0, endMs: totalDurationMs }];
  }

  const kept: TimeRangeMs[] = [];
  let cursorMs = 0;

  for (const trim of normalizedTrims) {
    if (trim.startMs > cursorMs) {
      kept.push({ startMs: cursorMs, endMs: trim.startMs });
    }
    cursorMs = Math.max(cursorMs, trim.endMs);
  }

  if (cursorMs < totalDurationMs) {
    kept.push({ startMs: cursorMs, endMs: totalDurationMs });
  }

  return kept.filter((range) => range.endMs > range.startMs);
}

export class VideoExporter {
  private config: VideoExporterConfig;
  private decoder: VideoFileDecoder | null = null;
  private renderer: FrameRenderer | null = null;
  private encoder: VideoEncoder | null = null;
  private muxer: VideoMuxer | null = null;
  private cancelled = false;
  private encodeQueue = 0;
  private readonly MAX_ENCODE_QUEUE = 120;
  private videoDescription: Uint8Array | undefined;
  private videoColorSpace: VideoColorSpaceInit | undefined;
  private muxingChain: Promise<void> = Promise.resolve();
  private muxingError: Error | null = null;
  private chunkCount = 0;
  private readonly PLAYBACK_SEEK_THRESHOLD_SECONDS = 0.45;
  private readonly PLAYBACK_WAIT_TIMEOUT_MS = 900;
  private readonly FINALIZE_TIMEOUT_MS = 120_000;
  private exportStartedAtMs = 0;
  private progressTick = 0;
  private finalizingHeartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private finalizingCurrentFrame = 0;
  private finalizingTotalFrames = 0;
  private finalizingDetailKey: string | undefined;
  private lastRenderingFrameCount = 0;
  private lastThroughputLogAtMs = 0;
  private seekCount = 0;
  private samplingMode: 'playback' | 'seek-only' = 'seek-only';
  private maxObservedTimingDriftMs = 0;
  private sourceDurationMs = 0;
  private sourceTrimRanges: TimeRangeMs[] = [];
  private sourceAudioEditRegions: AudioEditRegion[] = [];
  private sourceAudioInput: Input | null = null;
  private sourceAudioTrack: InputAudioTrack | null = null;
  private readonly warnings = new Set<string>();

  constructor(config: VideoExporterConfig) {
    const audioGain = clampAudioGain(config.audioGain);
    this.config = {
      ...config,
      audioEnabled: config.audioEnabled !== false,
      audioGain,
      frameRate: normalizeFrameRate(config.frameRate),
    };
  }

  private getSourceTrimRanges(totalDurationMs: number): TimeRangeMs[] {
    if (
      this.sourceDurationMs > 0
      && Math.abs(totalDurationMs - this.sourceDurationMs) < 0.5
    ) {
      return this.sourceTrimRanges;
    }

    return normalizeTrimRanges(this.config.trimRegions, totalDurationMs);
  }

  private getEffectiveDuration(totalDuration: number): number {
    const totalDurationMs = Math.max(0, totalDuration * 1000);
    if (totalDurationMs <= 0) {
      return 0;
    }

    const trimRanges = this.getSourceTrimRanges(totalDurationMs);
    const trimmedMs = trimRanges.reduce((sum, region) => sum + (region.endMs - region.startMs), 0);
    return Math.max(0, (totalDurationMs - trimmedMs) / 1000);
  }

  private mapEffectiveToSourceTime(effectiveTimeMs: number): number {
    if (this.sourceDurationMs <= 0) {
      return Math.max(0, effectiveTimeMs);
    }

    let sourceTimeMs = effectiveTimeMs;

    for (const trim of this.sourceTrimRanges) {
      if (sourceTimeMs < trim.startMs) {
        break;
      }

      const trimDuration = trim.endMs - trim.startMs;
      sourceTimeMs += trimDuration;
    }

    return Math.max(0, Math.min(sourceTimeMs, this.sourceDurationMs));
  }

  private async openSourceInputFromUrl(): Promise<Input> {
    return new Input({
      formats: ALL_FORMATS,
      source: new UrlSource(this.config.videoUrl),
    });
  }

  private async openSourceInputFromBlob(): Promise<Input> {
    const response = await fetch(this.config.videoUrl);
    if (!response.ok && response.status !== 0) {
      throw new Error(`Failed to fetch source media for audio extraction (status ${response.status})`);
    }

    const blob = await response.blob();
    return new Input({
      formats: ALL_FORMATS,
      source: new BlobSource(blob),
    });
  }

  private disposeSourceAudioInput(): void {
    if (this.sourceAudioInput) {
      try {
        this.sourceAudioInput.dispose();
      } catch (error) {
        console.warn('Error disposing source audio input:', error);
      }
    }

    this.sourceAudioInput = null;
    this.sourceAudioTrack = null;
  }

  private async resolveSourceAudioTrack(): Promise<boolean> {
    this.disposeSourceAudioInput();
    if (this.config.audioEnabled === false) {
      return false;
    }

    try {
      const input = await this.openSourceInputFromUrl();
      const audioTrack = await input.getPrimaryAudioTrack();
      if (audioTrack) {
        this.sourceAudioInput = input;
        this.sourceAudioTrack = audioTrack;
        return true;
      }
      input.dispose();
    } catch (urlError) {
      console.warn('[VideoExporter] Unable to read source audio via UrlSource. Retrying with BlobSource.', urlError);
    }

    try {
      const input = await this.openSourceInputFromBlob();
      const audioTrack = await input.getPrimaryAudioTrack();
      if (audioTrack) {
        this.sourceAudioInput = input;
        this.sourceAudioTrack = audioTrack;
        return true;
      }
      input.dispose();
      return false;
    } catch (blobError) {
      console.warn('[VideoExporter] Audio track extraction failed; continuing with video-only export.', blobError);
      this.disposeSourceAudioInput();
      return false;
    }
  }

  private addWarning(warningKey: string): void {
    if (!warningKey) return;
    this.warnings.add(warningKey);
  }

  private getWarnings(): string[] | undefined {
    if (this.warnings.size === 0) return undefined;
    return Array.from(this.warnings);
  }

  private createAudioSlice(
    sourceBuffer: AudioBuffer,
    startFrame: number,
    endFrame: number,
    gain: number,
  ): AudioBuffer | null {
    const safeStart = Math.max(0, Math.min(startFrame, sourceBuffer.length));
    const safeEnd = Math.max(safeStart, Math.min(endFrame, sourceBuffer.length));
    const frameCount = safeEnd - safeStart;

    if (frameCount <= 0) {
      return null;
    }

    const sliced = new AudioBuffer({
      length: frameCount,
      numberOfChannels: sourceBuffer.numberOfChannels,
      sampleRate: sourceBuffer.sampleRate,
    });

    for (let channel = 0; channel < sourceBuffer.numberOfChannels; channel += 1) {
      const source = sourceBuffer.getChannelData(channel);
      const target = sliced.getChannelData(channel);

      if (gain === 1) {
        target.set(source.subarray(safeStart, safeEnd));
        continue;
      }

      for (let i = 0; i < frameCount; i += 1) {
        target[i] = source[safeStart + i] * gain;
      }
    }

    return sliced;
  }

  private async exportAudioTrack(): Promise<void> {
    if (!this.sourceAudioTrack || !this.muxer || this.sourceDurationMs <= 0 || this.cancelled) {
      return;
    }

    const baseGain = clampAudioGain(this.config.audioGain);
    const keptRanges = buildKeptRanges(this.sourceDurationMs, this.config.trimRegions);
    if (keptRanges.length === 0) {
      return;
    }

    const sink = new AudioBufferSink(this.sourceAudioTrack);

    for (const range of keptRanges) {
      if (this.cancelled) {
        break;
      }

      const startSeconds = range.startMs / 1000;
      const endSeconds = range.endMs / 1000;
      const decodeStartSeconds = Math.max(0, startSeconds - 0.1);

      for await (const wrapped of sink.buffers(decodeStartSeconds, endSeconds)) {
        if (this.cancelled) {
          return;
        }

        const sourceBuffer = wrapped.buffer;
        const bufferStartMs = wrapped.timestamp * 1000;
        const bufferEndMs = bufferStartMs + wrapped.duration * 1000;
        const clipStartMs = Math.max(bufferStartMs, range.startMs);
        const clipEndMs = Math.min(bufferEndMs, range.endMs);

        if (clipEndMs <= clipStartMs) {
          continue;
        }

        const gainSegments = buildAudioGainSegments(
          clipStartMs,
          clipEndMs,
          baseGain,
          this.sourceAudioEditRegions,
        );
        const sampleRate = sourceBuffer.sampleRate;

        for (const segment of gainSegments) {
          const startFrame = Math.floor(((segment.startMs - bufferStartMs) / 1000) * sampleRate);
          const endFrame = Math.ceil(((segment.endMs - bufferStartMs) / 1000) * sampleRate);
          const slice = this.createAudioSlice(sourceBuffer, startFrame, endFrame, segment.gain);

          if (!slice) {
            continue;
          }

          await this.muxer.addAudioBuffer(slice);
        }
      }
    }
  }

  async export(): Promise<ExportResult> {
    try {
      this.cleanup();
      this.cancelled = false;
      this.muxingError = null;
      this.exportStartedAtMs = Date.now();
      this.progressTick = 0;
      this.lastRenderingFrameCount = 0;
      this.lastThroughputLogAtMs = this.exportStartedAtMs;
      this.seekCount = 0;
      this.maxObservedTimingDriftMs = 0;
      this.samplingMode = 'seek-only';
      this.sourceDurationMs = 0;
      this.sourceAudioEditRegions = [];
      this.warnings.clear();

      this.decoder = new VideoFileDecoder();
      const videoInfo = await this.decoder.loadVideo(this.config.videoUrl);
      this.sourceDurationMs = Math.max(0, videoInfo.duration * 1000);
      this.sourceTrimRanges = normalizeTrimRanges(this.config.trimRegions, this.sourceDurationMs);
      this.sourceAudioEditRegions = normalizeAudioEditRegions(this.config.audioEditRegions, this.sourceDurationMs);
      const hasSourceAudio = await this.resolveSourceAudioTrack();
      if (this.config.audioEnabled && !hasSourceAudio) {
        this.addWarning(EXPORT_WARNING_AUDIO_TRACK_UNAVAILABLE);
      }

      this.renderer = new FrameRenderer({
        width: this.config.width,
        height: this.config.height,
        wallpaper: this.config.wallpaper,
        zoomRegions: this.config.zoomRegions,
        showShadow: this.config.showShadow,
        shadowIntensity: this.config.shadowIntensity,
        showBlur: this.config.showBlur,
        motionBlurEnabled: this.config.motionBlurEnabled,
        borderRadius: this.config.borderRadius,
        padding: this.config.padding,
        cropRegion: this.config.cropRegion,
        videoWidth: videoInfo.width,
        videoHeight: videoInfo.height,
        annotationRegions: this.config.annotationRegions,
        subtitleCues: this.config.subtitleCues,
        previewWidth: this.config.previewWidth,
        previewHeight: this.config.previewHeight,
        cursorTrack: this.config.cursorTrack,
        cursorStyle: this.config.cursorStyle,
      });
      await this.renderer.initialize();

      await this.initializeEncoder();

      this.muxer = new VideoMuxer(this.config, hasSourceAudio);
      await this.muxer.initialize();

      const videoElement = this.decoder.getVideoElement();
      if (!videoElement) {
        throw new Error('Video element not available');
      }

      const effectiveDuration = this.getEffectiveDuration(videoInfo.duration);
      const totalFrames = Math.ceil(effectiveDuration * this.config.frameRate);

      console.log('[VideoExporter] Original duration:', videoInfo.duration, 's');
      console.log('[VideoExporter] Effective duration:', effectiveDuration, 's');
      console.log('[VideoExporter] Total frames to export:', totalFrames);

      let frameIndex = 0;
      const shouldUsePlaybackSampling = typeof videoElement.requestVideoFrameCallback === 'function'
        && !hasRecordedCursorSamples(this.config.cursorTrack);
      if (shouldUsePlaybackSampling) {
        this.samplingMode = 'playback';
        frameIndex = await this.exportFramesWithPlaybackSampling(videoElement, totalFrames);
        if (frameIndex < totalFrames && !this.cancelled) {
          console.warn(
            `[VideoExporter] Playback sampling ended at frame ${frameIndex}/${totalFrames}; falling back to seek mode for the remainder.`,
          );
          this.samplingMode = 'seek-only';
          frameIndex = await this.exportFramesBySeeking(videoElement, totalFrames, frameIndex);
        }
      } else {
        this.samplingMode = 'seek-only';
        frameIndex = await this.exportFramesBySeeking(videoElement, totalFrames, frameIndex);
      }

      if (frameIndex < totalFrames && !this.cancelled) {
        throw new Error(`Export ended early: rendered ${frameIndex} of ${totalFrames} frames.`);
      }

      if (this.cancelled) {
        if (this.muxingError) {
          throw this.muxingError;
        }
        return { success: false, error: 'Export cancelled' };
      }

      this.startFinalizingHeartbeat(totalFrames, totalFrames, 'export.finalize.flush');

      if (this.encoder && this.encoder.state === 'configured') {
        await this.runFinalizingStep(
          'export.finalize.flush',
          withTimeout(this.encoder.flush(), this.FINALIZE_TIMEOUT_MS, 'encoder flush'),
        );
      }

      await this.runFinalizingStep(
        'export.finalize.mux',
        withTimeout(this.waitForMuxDrain(), this.FINALIZE_TIMEOUT_MS, 'mux drain'),
      );

      if (hasSourceAudio) {
        await this.runFinalizingStep(
          'export.finalize.audio',
          withTimeout(this.exportAudioTrack(), this.FINALIZE_TIMEOUT_MS, 'audio encode'),
        );
      }

      const blob = await this.runFinalizingStep(
        'export.finalize.package',
        withTimeout(this.muxer!.finalize(), this.FINALIZE_TIMEOUT_MS, 'mux finalize'),
      );
      this.stopFinalizingHeartbeat();

      const totalElapsedMs = Date.now() - this.exportStartedAtMs;
      console.log('[VideoExporter] Export complete', {
        totalFrames,
        totalElapsedMs,
        avgRenderFps: totalElapsedMs > 0 ? Number(((totalFrames * 1000) / totalElapsedMs).toFixed(2)) : 0,
        samplingMode: this.samplingMode,
        seekCount: this.seekCount,
        maxObservedTimingDriftMs: Number(this.maxObservedTimingDriftMs.toFixed(2)),
      });

      return { success: true, blob, warnings: this.getWarnings() };
    } catch (error) {
      console.error('Export error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      this.cleanup();
    }
  }

  private getSourceTimeMsForFrame(frameIndex: number): number {
    const timeStepMs = 1000 / this.config.frameRate;
    const effectiveTimeMs = frameIndex * timeStepMs;
    return this.mapEffectiveToSourceTime(effectiveTimeMs);
  }

  private updateProgress(
    currentFrame: number,
    totalFrames: number,
    phase: ExportProgress['phase'] = 'rendering',
    phaseDetailKey?: string,
    isHeartbeat = false,
  ): void {
    if (!this.config.onProgress) return;
    this.progressTick += 1;

    const now = Date.now();
    const elapsedMs = this.exportStartedAtMs > 0 ? Math.max(0, now - this.exportStartedAtMs) : 0;
    const estimatedTimeRemaining = phase === 'rendering'
      ? estimateRemainingSeconds(currentFrame, totalFrames, elapsedMs)
      : 0;

    this.config.onProgress({
      currentFrame,
      totalFrames,
      percentage: totalFrames > 0 ? (currentFrame / totalFrames) * 100 : 100,
      estimatedTimeRemaining,
      phase,
      phaseDetailKey,
      updatedAtMs: now,
      elapsedMs,
      activityTick: this.progressTick,
      isHeartbeat,
    });
  }

  private getKeyFrameIntervalFrames(): number {
    return Math.max(1, Math.round(this.config.frameRate * 2.5));
  }

  private startFinalizingHeartbeat(currentFrame: number, totalFrames: number, phaseDetailKey: string): void {
    this.stopFinalizingHeartbeat();
    this.finalizingCurrentFrame = currentFrame;
    this.finalizingTotalFrames = totalFrames;
    this.finalizingDetailKey = phaseDetailKey;
    this.updateProgress(currentFrame, totalFrames, 'finalizing', phaseDetailKey, false);

    this.finalizingHeartbeatTimer = globalThis.setInterval(() => {
      this.updateProgress(
        this.finalizingCurrentFrame,
        this.finalizingTotalFrames,
        'finalizing',
        this.finalizingDetailKey,
        true,
      );
    }, 1000);
  }

  private stopFinalizingHeartbeat(): void {
    if (this.finalizingHeartbeatTimer !== null) {
      globalThis.clearInterval(this.finalizingHeartbeatTimer);
      this.finalizingHeartbeatTimer = null;
    }
  }

  private async runFinalizingStep<T>(phaseDetailKey: string, operation: Promise<T>): Promise<T> {
    this.finalizingDetailKey = phaseDetailKey;
    this.updateProgress(this.finalizingCurrentFrame, this.finalizingTotalFrames, 'finalizing', phaseDetailKey, false);
    return operation;
  }

  private async renderAndEncodeFrame(
    videoElement: HTMLVideoElement,
    frameIndex: number,
    totalFrames: number,
    sampledFrameTimeMs: number,
    effectTimeMs = sampledFrameTimeMs,
  ): Promise<void> {
    const timestamp = frameIndexToTimestampUs(frameIndex, this.config.frameRate);
    const duration = frameDurationUs(frameIndex, this.config.frameRate);

    await this.renderer!.renderFrame(videoElement, Math.round(sampledFrameTimeMs * 1000), {
      effectTimeMs,
    });

    const canvas = this.renderer!.getCanvas();

    // @ts-ignore - colorSpace not in TypeScript definitions but works at runtime.
    const exportFrame = new VideoFrame(canvas, {
      timestamp,
      duration,
      colorSpace: {
        primaries: 'bt709',
        transfer: 'iec61966-2-1',
        matrix: 'rgb',
        fullRange: true,
      },
    });

    while (this.encodeQueue >= this.MAX_ENCODE_QUEUE && !this.cancelled) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    if (this.encoder && this.encoder.state === 'configured') {
      this.encodeQueue++;
      this.encoder.encode(exportFrame, { keyFrame: frameIndex % this.getKeyFrameIntervalFrames() === 0 });
    } else {
      console.warn(`[Frame ${frameIndex}] Encoder not ready! State: ${this.encoder?.state}`);
    }

    exportFrame.close();
    this.updateProgress(frameIndex + 1, totalFrames);

    const now = Date.now();
    if (now - this.lastThroughputLogAtMs >= 1000) {
      const frameDelta = frameIndex + 1 - this.lastRenderingFrameCount;
      const msDelta = now - this.lastThroughputLogAtMs;
      const renderFps = msDelta > 0 ? (frameDelta * 1000) / msDelta : 0;
      console.log('[VideoExporter] Throughput', {
        currentFrame: frameIndex + 1,
        totalFrames,
        renderFps: Number(renderFps.toFixed(2)),
        elapsedMs: now - this.exportStartedAtMs,
      });
      this.lastRenderingFrameCount = frameIndex + 1;
      this.lastThroughputLogAtMs = now;
    }
  }

  private async seekVideoTo(videoElement: HTMLVideoElement, targetTimeSeconds: number): Promise<void> {
    const safeDuration = Number.isFinite(videoElement.duration) ? videoElement.duration : targetTimeSeconds + 1;
    const epsilon = 1 / Math.max(this.config.frameRate, 30);
    const clampedTime = Math.max(0, Math.min(targetTimeSeconds, Math.max(0, safeDuration - epsilon)));

    if (!shouldSeekToTime(videoElement.currentTime, clampedTime, this.config.frameRate)) {
      await this.waitForVideoFrame(videoElement);
      return;
    }

    const seekedPromise = new Promise<void>((resolve) => {
      videoElement.addEventListener('seeked', () => resolve(), { once: true });
    });
    this.seekCount += 1;
    videoElement.currentTime = clampedTime;
    await seekedPromise;
    await this.waitForVideoFrame(videoElement);
  }

  private async exportFramesBySeeking(
    videoElement: HTMLVideoElement,
    totalFrames: number,
    startFrameIndex = 0,
  ): Promise<number> {
    let frameIndex = startFrameIndex;

    while (frameIndex < totalFrames && !this.cancelled) {
      const targetSourceTimeMs = this.getSourceTimeMsForFrame(frameIndex);
      await this.seekVideoTo(videoElement, targetSourceTimeMs / 1000);
      const sampledFrameTimeMs = Math.max(0, videoElement.currentTime * 1000);
      this.maxObservedTimingDriftMs = Math.max(
        this.maxObservedTimingDriftMs,
        Math.abs(sampledFrameTimeMs - targetSourceTimeMs),
      );
      await this.renderAndEncodeFrame(
        videoElement,
        frameIndex,
        totalFrames,
        sampledFrameTimeMs,
        targetSourceTimeMs,
      );
      frameIndex++;
    }

    return frameIndex;
  }

  private async exportFramesWithPlaybackSampling(videoElement: HTMLVideoElement, totalFrames: number): Promise<number> {
    let frameIndex = 0;
    const tolerance = getSeekToleranceSeconds(this.config.frameRate);
    const seekThreshold = Math.max(this.PLAYBACK_SEEK_THRESHOLD_SECONDS, 4 / this.config.frameRate);
    const playbackRate = 1;
    let staleTicks = 0;
    let previousMediaTime = -1;

    const previousMuted = videoElement.muted;
    const previousVolume = videoElement.volume;
    videoElement.pause();
    videoElement.currentTime = 0;
    videoElement.playbackRate = playbackRate;
    videoElement.muted = true;
    videoElement.volume = 0;
    await this.waitForVideoFrame(videoElement, 500);

    try {
      try {
        await videoElement.play();
      } catch (error) {
        console.warn('[VideoExporter] Unable to enter playback sampling mode, using seek mode instead.', error);
        return frameIndex;
      }

      while (frameIndex < totalFrames && !this.cancelled) {
        await this.waitForVideoFrame(videoElement, this.PLAYBACK_WAIT_TIMEOUT_MS);
        const mediaTime = videoElement.currentTime;

        let renderedInTick = 0;
        while (frameIndex < totalFrames && !this.cancelled) {
          const sourceTimeMs = this.getSourceTimeMsForFrame(frameIndex);
          const sourceTimeSeconds = sourceTimeMs / 1000;
          if (sourceTimeSeconds > mediaTime + tolerance) {
            break;
          }
          const sampledFrameTimeMs = Math.max(0, mediaTime * 1000);
          this.maxObservedTimingDriftMs = Math.max(
            this.maxObservedTimingDriftMs,
            Math.abs(sampledFrameTimeMs - sourceTimeMs),
          );
          await this.renderAndEncodeFrame(
            videoElement,
            frameIndex,
            totalFrames,
            sampledFrameTimeMs,
            sourceTimeMs,
          );
          frameIndex++;
          renderedInTick++;
        }

        if (frameIndex >= totalFrames || this.cancelled) {
          break;
        }

        const nextSourceTimeSeconds = this.getSourceTimeMsForFrame(frameIndex) / 1000;
        const drift = nextSourceTimeSeconds - mediaTime;

        if (!Number.isFinite(mediaTime) || drift > seekThreshold) {
          await this.seekVideoTo(videoElement, nextSourceTimeSeconds);
        }

        if (Math.abs(mediaTime - previousMediaTime) < tolerance * 0.5 && renderedInTick === 0) {
          staleTicks += 1;
        } else {
          staleTicks = 0;
        }

        if (staleTicks >= 3) {
          await this.seekVideoTo(videoElement, nextSourceTimeSeconds);
          staleTicks = 0;
        }
        previousMediaTime = mediaTime;

        if (videoElement.ended && renderedInTick === 0) {
          console.warn('[VideoExporter] Playback ended before all frames were sampled.');
          break;
        }
      }

      return frameIndex;
    } finally {
      videoElement.pause();
      videoElement.playbackRate = 1;
      videoElement.muted = previousMuted;
      videoElement.volume = previousVolume;
    }
  }

  private enqueueMuxOperation(task: () => Promise<void>): void {
    this.muxingChain = this.muxingChain.then(async () => {
      if (this.muxingError || this.cancelled) {
        return;
      }

      try {
        await task();
      } catch (error) {
        const normalized = error instanceof Error ? error : new Error(String(error));
        if (!this.muxingError) {
          this.muxingError = normalized;
        }
        this.cancelled = true;
      }
    });
  }

  private async waitForMuxDrain(): Promise<void> {
    await this.muxingChain;
    if (this.muxingError) {
      throw this.muxingError;
    }
  }

  private async initializeEncoder(): Promise<void> {
    this.encodeQueue = 0;
    this.muxingChain = Promise.resolve();
    this.muxingError = null;
    this.chunkCount = 0;
    let videoDescription: Uint8Array | undefined;

    this.encoder = new VideoEncoder({
      output: (chunk, meta) => {
        if (meta?.decoderConfig?.description && !videoDescription) {
          const desc = meta.decoderConfig.description;
          videoDescription = new Uint8Array(desc instanceof ArrayBuffer ? desc : (desc as any));
          this.videoDescription = videoDescription;
        }

        if (meta?.decoderConfig?.colorSpace && !this.videoColorSpace) {
          this.videoColorSpace = meta.decoderConfig.colorSpace;
        }

        const isFirstChunk = this.chunkCount === 0;
        this.chunkCount++;

        this.enqueueMuxOperation(async () => {
          if (isFirstChunk && this.videoDescription) {
            const colorSpace = this.videoColorSpace || {
              primaries: 'bt709',
              transfer: 'iec61966-2-1',
              matrix: 'rgb',
              fullRange: true,
            };

            const metadata: EncodedVideoChunkMetadata = {
              decoderConfig: {
                codec: this.config.codec || 'avc1.640033',
                codedWidth: this.config.width,
                codedHeight: this.config.height,
                description: this.videoDescription,
                colorSpace,
              },
            };

            await this.muxer!.addVideoChunk(chunk, metadata);
            return;
          }

          await this.muxer!.addVideoChunk(chunk, meta);
        });

        this.encodeQueue = Math.max(0, this.encodeQueue - 1);
      },
      error: (error) => {
        console.error('[VideoExporter] Encoder error:', error);
        const normalized = error instanceof Error ? error : new Error(String(error));
        if (!this.muxingError) {
          this.muxingError = normalized;
        }
        this.cancelled = true;
      },
    });

    const codec = this.config.codec || 'avc1.640033';

    const encoderConfig: VideoEncoderConfig = {
      codec,
      width: this.config.width,
      height: this.config.height,
      bitrate: this.config.bitrate,
      framerate: this.config.frameRate,
      latencyMode: 'quality',
      bitrateMode: 'variable',
      hardwareAcceleration: 'prefer-hardware',
    };

    const hardwareSupport = await VideoEncoder.isConfigSupported(encoderConfig);

    if (hardwareSupport.supported) {
      console.log('[VideoExporter] Using hardware acceleration');
      this.encoder.configure(encoderConfig);
    } else {
      console.log('[VideoExporter] Hardware not supported, using software encoding');
      encoderConfig.hardwareAcceleration = 'prefer-software';

      const softwareSupport = await VideoEncoder.isConfigSupported(encoderConfig);
      if (!softwareSupport.supported) {
        throw new Error('Video encoding not supported on this system');
      }

      this.encoder.configure(encoderConfig);
    }
  }

  cancel(): void {
    this.cancelled = true;
    this.cleanup();
  }

  private async waitForVideoFrame(videoElement: HTMLVideoElement, timeoutMs = 250): Promise<void> {
    if (typeof videoElement.requestVideoFrameCallback === 'function') {
      await new Promise<void>((resolve) => {
        let settled = false;
        const timeout = window.setTimeout(() => {
          if (!settled) {
            settled = true;
            resolve();
          }
        }, timeoutMs);

        videoElement.requestVideoFrameCallback(() => {
          if (!settled) {
            settled = true;
            window.clearTimeout(timeout);
            resolve();
          }
        });
      });
      return;
    }

    await new Promise((resolve) => window.setTimeout(resolve, 0));
  }

  private cleanup(): void {
    this.stopFinalizingHeartbeat();
    this.disposeSourceAudioInput();

    if (this.encoder) {
      try {
        if (this.encoder.state === 'configured') {
          this.encoder.close();
        }
      } catch (e) {
        console.warn('Error closing encoder:', e);
      }
      this.encoder = null;
    }

    if (this.decoder) {
      try {
        this.decoder.destroy();
      } catch (e) {
        console.warn('Error destroying decoder:', e);
      }
      this.decoder = null;
    }

    if (this.renderer) {
      try {
        this.renderer.destroy();
      } catch (e) {
        console.warn('Error destroying renderer:', e);
      }
      this.renderer = null;
    }

    this.muxer = null;
    this.encodeQueue = 0;
    this.muxingChain = Promise.resolve();
    this.muxingError = null;
    this.chunkCount = 0;
    this.exportStartedAtMs = 0;
    this.progressTick = 0;
    this.finalizingCurrentFrame = 0;
    this.finalizingTotalFrames = 0;
    this.finalizingDetailKey = undefined;
    this.lastRenderingFrameCount = 0;
    this.lastThroughputLogAtMs = 0;
    this.seekCount = 0;
    this.samplingMode = 'seek-only';
    this.videoDescription = undefined;
    this.videoColorSpace = undefined;
    this.sourceDurationMs = 0;
    this.sourceTrimRanges = [];
    this.warnings.clear();
  }
}
