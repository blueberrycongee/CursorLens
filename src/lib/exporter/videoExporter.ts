import type { ExportConfig, ExportProgress, ExportResult } from './types';
import { VideoFileDecoder } from './videoDecoder';
import { FrameRenderer } from './frameRenderer';
import { VideoMuxer } from './muxer';
import type { ZoomRegion, CropRegion, TrimRegion, AnnotationRegion } from '@/components/video-editor/types';
import { frameDurationUs, frameIndexToTimestampUs, normalizeFrameRate } from './frameClock';

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
  previewWidth?: number;
  previewHeight?: number;
  onProgress?: (progress: ExportProgress) => void;
}

export function getSeekToleranceSeconds(frameRate: number): number {
  const safeFrameRate = Number.isFinite(frameRate) && frameRate > 0 ? frameRate : 60;
  return Math.max(1 / (safeFrameRate * 2), 1 / 240);
}

export function shouldSeekToTime(currentTime: number, targetTime: number, frameRate: number): boolean {
  return Math.abs(currentTime - targetTime) > getSeekToleranceSeconds(frameRate);
}

export class VideoExporter {
  private config: VideoExporterConfig;
  private decoder: VideoFileDecoder | null = null;
  private renderer: FrameRenderer | null = null;
  private encoder: VideoEncoder | null = null;
  private muxer: VideoMuxer | null = null;
  private cancelled = false;
  private encodeQueue = 0;
  // Increased queue size for better throughput with hardware encoding
  private readonly MAX_ENCODE_QUEUE = 120;
  private videoDescription: Uint8Array | undefined;
  private videoColorSpace: VideoColorSpaceInit | undefined;
  // Track muxing promises for parallel processing
  private muxingPromises: Promise<void>[] = [];
  private muxingError: Error | null = null;
  private chunkCount = 0;
  private readonly PLAYBACK_SEEK_THRESHOLD_SECONDS = 0.45;
  private readonly PLAYBACK_WAIT_TIMEOUT_MS = 900;

  constructor(config: VideoExporterConfig) {
    this.config = {
      ...config,
      frameRate: normalizeFrameRate(config.frameRate),
    };
  }

  // Calculate the total duration excluding trim regions (in seconds)
  private getEffectiveDuration(totalDuration: number): number {
    const trimRegions = this.config.trimRegions || [];
    const totalTrimDuration = trimRegions.reduce((sum, region) => {
      return sum + (region.endMs - region.startMs) / 1000;
    }, 0);
    return totalDuration - totalTrimDuration;
  }

  private mapEffectiveToSourceTime(effectiveTimeMs: number): number {
    const trimRegions = this.config.trimRegions || [];
    // Sort trim regions by start time
    const sortedTrims = [...trimRegions].sort((a, b) => a.startMs - b.startMs);

    let sourceTimeMs = effectiveTimeMs;

    for (const trim of sortedTrims) {
      // If the source time hasn't reached this trim region yet, we're done
      if (sourceTimeMs < trim.startMs) {
        break;
      }

      // Add the duration of this trim region to the source time
      const trimDuration = trim.endMs - trim.startMs;
      sourceTimeMs += trimDuration;
    }

    return sourceTimeMs;
  }

  async export(): Promise<ExportResult> {
    try {
      this.cleanup();
      this.cancelled = false;
      this.muxingError = null;

      // Initialize decoder and load video
      this.decoder = new VideoFileDecoder();
      const videoInfo = await this.decoder.loadVideo(this.config.videoUrl);

      // Initialize frame renderer
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
        previewWidth: this.config.previewWidth,
        previewHeight: this.config.previewHeight,
      });
      await this.renderer.initialize();

      // Initialize video encoder
      await this.initializeEncoder();

      // Initialize muxer
      this.muxer = new VideoMuxer(this.config, false);
      await this.muxer.initialize();

      // Get the video element for frame extraction
      const videoElement = this.decoder.getVideoElement();
      if (!videoElement) {
        throw new Error('Video element not available');
      }

      // Calculate effective duration and frame count (excluding trim regions)
      const effectiveDuration = this.getEffectiveDuration(videoInfo.duration);
      const totalFrames = Math.ceil(effectiveDuration * this.config.frameRate);
      
      console.log('[VideoExporter] Original duration:', videoInfo.duration, 's');
      console.log('[VideoExporter] Effective duration:', effectiveDuration, 's');
      console.log('[VideoExporter] Total frames to export:', totalFrames);

      let frameIndex = 0;
      if (typeof videoElement.requestVideoFrameCallback === 'function') {
        frameIndex = await this.exportFramesWithPlaybackSampling(videoElement, totalFrames);
        if (frameIndex < totalFrames && !this.cancelled) {
          console.warn(
            `[VideoExporter] Playback sampling ended at frame ${frameIndex}/${totalFrames}; falling back to seek mode for the remainder.`,
          );
          frameIndex = await this.exportFramesBySeeking(videoElement, totalFrames, frameIndex);
        }
      } else {
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

      // Finalize encoding
      if (this.encoder && this.encoder.state === 'configured') {
        await this.encoder.flush();
      }

      // Wait for all muxing operations to complete
      const muxResults = await Promise.allSettled(this.muxingPromises);
      if (this.muxingError) {
        throw this.muxingError;
      }
      const firstRejected = muxResults.find((result) => result.status === 'rejected') as PromiseRejectedResult | undefined;
      if (firstRejected) {
        const reason = firstRejected.reason;
        throw reason instanceof Error ? reason : new Error(String(reason));
      }

      // Finalize muxer and get output blob
      const blob = await this.muxer!.finalize();

      return { success: true, blob };
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

  private updateProgress(currentFrame: number, totalFrames: number): void {
    if (!this.config.onProgress) return;

    this.config.onProgress({
      currentFrame,
      totalFrames,
      percentage: totalFrames > 0 ? (currentFrame / totalFrames) * 100 : 100,
      estimatedTimeRemaining: 0,
    });
  }

  private getKeyFrameIntervalFrames(): number {
    return Math.max(1, Math.round(this.config.frameRate * 2.5));
  }

  private async renderAndEncodeFrame(
    videoElement: HTMLVideoElement,
    frameIndex: number,
    totalFrames: number,
    sourceTimeMs: number,
  ): Promise<void> {
    const timestamp = frameIndexToTimestampUs(frameIndex, this.config.frameRate);
    const duration = frameDurationUs(frameIndex, this.config.frameRate);

    const videoFrame = new VideoFrame(videoElement, { timestamp });
    await this.renderer!.renderFrame(videoFrame, Math.round(sourceTimeMs * 1000));
    videoFrame.close();

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
      const sourceTimeMs = this.getSourceTimeMsForFrame(frameIndex);
      await this.seekVideoTo(videoElement, sourceTimeMs / 1000);
      await this.renderAndEncodeFrame(videoElement, frameIndex, totalFrames, sourceTimeMs);
      frameIndex++;
    }

    return frameIndex;
  }

  private async waitForVideoTime(
    videoElement: HTMLVideoElement,
    targetTimeSeconds: number,
    toleranceSeconds: number,
  ): Promise<void> {
    if (videoElement.currentTime + toleranceSeconds >= targetTimeSeconds) {
      return;
    }

    if (typeof videoElement.requestVideoFrameCallback === 'function') {
      await new Promise<void>((resolve) => {
        let settled = false;
        const timeout = window.setTimeout(() => {
          if (!settled) {
            settled = true;
            resolve();
          }
        }, this.PLAYBACK_WAIT_TIMEOUT_MS);

        const check = (_now: number, metadata: VideoFrameCallbackMetadata) => {
          const mediaTime = Number.isFinite(metadata.mediaTime) ? metadata.mediaTime : videoElement.currentTime;
          if (
            mediaTime + toleranceSeconds >= targetTimeSeconds
            || videoElement.paused
            || videoElement.ended
          ) {
            if (!settled) {
              settled = true;
              window.clearTimeout(timeout);
              resolve();
            }
            return;
          }

          videoElement.requestVideoFrameCallback(check);
        };

        videoElement.requestVideoFrameCallback(check);
      });
      return;
    }

    while (
      videoElement.currentTime + toleranceSeconds < targetTimeSeconds
      && !videoElement.paused
      && !videoElement.ended
    ) {
      await new Promise((resolve) => window.setTimeout(resolve, 4));
    }
  }

  private async exportFramesWithPlaybackSampling(videoElement: HTMLVideoElement, totalFrames: number): Promise<number> {
    let frameIndex = 0;
    const tolerance = getSeekToleranceSeconds(this.config.frameRate);
    const seekThreshold = Math.max(this.PLAYBACK_SEEK_THRESHOLD_SECONDS, 4 / this.config.frameRate);
    const playbackRate = this.config.frameRate > 90 ? 0.5 : this.config.frameRate > 60 ? 0.75 : 1;

    videoElement.pause();
    videoElement.currentTime = 0;
    videoElement.playbackRate = playbackRate;
    await this.waitForVideoFrame(videoElement, 500);

    try {
      await videoElement.play();
    } catch (error) {
      console.warn('[VideoExporter] Unable to enter playback sampling mode, using seek mode instead.', error);
      videoElement.playbackRate = 1;
      return frameIndex;
    }

    while (frameIndex < totalFrames && !this.cancelled) {
      const sourceTimeMs = this.getSourceTimeMsForFrame(frameIndex);
      const sourceTimeSeconds = sourceTimeMs / 1000;
      const drift = sourceTimeSeconds - videoElement.currentTime;

      if (!Number.isFinite(videoElement.currentTime) || Math.abs(drift) > seekThreshold) {
        videoElement.pause();
        await this.seekVideoTo(videoElement, sourceTimeSeconds);
        await this.renderAndEncodeFrame(videoElement, frameIndex, totalFrames, sourceTimeMs);
        frameIndex++;

        if (!this.cancelled && frameIndex < totalFrames) {
          await videoElement.play().catch(() => undefined);
        }
        continue;
      }

      await this.waitForVideoTime(videoElement, sourceTimeSeconds, tolerance);

      if (this.cancelled) {
        break;
      }

      videoElement.pause();
      await this.waitForVideoFrame(videoElement);
      await this.renderAndEncodeFrame(videoElement, frameIndex, totalFrames, sourceTimeMs);
      frameIndex++;

      if (!this.cancelled && frameIndex < totalFrames) {
        await videoElement.play().catch(() => undefined);
      }
    }

    videoElement.pause();
    videoElement.playbackRate = 1;
    return frameIndex;
  }

  private async initializeEncoder(): Promise<void> {
    this.encodeQueue = 0;
    this.muxingPromises = [];
    this.muxingError = null;
    this.chunkCount = 0;
    let videoDescription: Uint8Array | undefined;

    this.encoder = new VideoEncoder({
      output: (chunk, meta) => {
        // Capture decoder config metadata from encoder output
        if (meta?.decoderConfig?.description && !videoDescription) {
          const desc = meta.decoderConfig.description;
          videoDescription = new Uint8Array(desc instanceof ArrayBuffer ? desc : (desc as any));
          this.videoDescription = videoDescription;
        }
        // Capture colorSpace from encoder metadata if provided
        if (meta?.decoderConfig?.colorSpace && !this.videoColorSpace) {
          this.videoColorSpace = meta.decoderConfig.colorSpace;
        }

        // Stream chunk to muxer immediately (parallel processing)
        const isFirstChunk = this.chunkCount === 0;
        this.chunkCount++;

        const muxingPromise = (async () => {
          if (isFirstChunk && this.videoDescription) {
            // Add decoder config for the first chunk
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
          } else {
            await this.muxer!.addVideoChunk(chunk, meta);
          }
        })();

        this.muxingPromises.push(muxingPromise);
        void muxingPromise.catch((error) => {
          const normalized = error instanceof Error ? error : new Error(String(error));
          if (!this.muxingError) {
            this.muxingError = normalized;
          }
          this.cancelled = true;
        });
        this.encodeQueue--;
      },
      error: (error) => {
        console.error('[VideoExporter] Encoder error:', error);
        const normalized = error instanceof Error ? error : new Error(String(error));
        if (!this.muxingError) {
          this.muxingError = normalized;
        }
        // Stop export when encoding fails
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
      // Offline export prefers visual quality/temporal stability over low latency.
      latencyMode: 'quality',
      bitrateMode: 'variable',
      hardwareAcceleration: 'prefer-hardware',
    };

    // Check hardware support first
    const hardwareSupport = await VideoEncoder.isConfigSupported(encoderConfig);

    if (hardwareSupport.supported) {
      // Use hardware encoding
      console.log('[VideoExporter] Using hardware acceleration');
      this.encoder.configure(encoderConfig);
    } else {
      // Fall back to software encoding
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
    this.muxingPromises = [];
    this.muxingError = null;
    this.chunkCount = 0;
    this.videoDescription = undefined;
    this.videoColorSpace = undefined;
  }
}
