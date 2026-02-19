export interface DecodedVideoInfo {
  width: number;
  height: number;
  duration: number; // in seconds
  frameRate: number;
  codec: string;
}

function isExportAudioDebugEnabled(): boolean {
  try {
    return globalThis.localStorage?.getItem('cursorlens.exportDebugAudio') === '1';
  } catch {
    return false;
  }
}

export class VideoFileDecoder {
  private info: DecodedVideoInfo | null = null;
  private videoElement: HTMLVideoElement | null = null;
  private debugTeardown: (() => void) | null = null;
  private silentGuardTeardown: (() => void) | null = null;

  private applySilentDefaults(video: HTMLVideoElement): void {
    video.defaultMuted = true;
    video.muted = true;
    video.volume = 0;
    video.preload = 'metadata';
    video.playsInline = true;
    video.setAttribute('muted', '');
    video.setAttribute('playsinline', '');
  }

  private setupSilentPlaybackGuard(video: HTMLVideoElement): void {
    const onPlay = () => {
      // Export must stay silent and seek-driven. Any play() call is treated as unexpected.
      video.defaultMuted = true;
      video.muted = true;
      video.volume = 0;
      video.pause();
      console.warn('[VideoFileDecoder] Blocked unexpected play() during export; forcing paused silent mode.');
    };

    video.addEventListener('play', onPlay);
    this.silentGuardTeardown = () => {
      video.removeEventListener('play', onPlay);
    };
  }

  private setupDebugListeners(video: HTMLVideoElement): void {
    if (!isExportAudioDebugEnabled()) {
      this.debugTeardown = null;
      return;
    }

    const logState = (eventName: string) => {
      console.log('[ExportAudioDebug][VideoElement]', eventName, {
        currentTime: Number(video.currentTime?.toFixed?.(4) ?? video.currentTime ?? 0),
        paused: video.paused,
        ended: video.ended,
        muted: video.muted,
        volume: video.volume,
        readyState: video.readyState,
      });
    };

    const onPlay = () => logState('play');
    const onPause = () => logState('pause');
    const onSeeking = () => logState('seeking');
    const onSeeked = () => logState('seeked');
    const onVolumeChange = () => logState('volumechange');

    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('seeking', onSeeking);
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('volumechange', onVolumeChange);
    logState('created');

    this.debugTeardown = () => {
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('seeking', onSeeking);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('volumechange', onVolumeChange);
    };
  }

  async loadVideo(videoUrl: string): Promise<DecodedVideoInfo> {
    this.videoElement = document.createElement('video');
    this.applySilentDefaults(this.videoElement);
    this.videoElement.src = videoUrl;
    this.setupSilentPlaybackGuard(this.videoElement);
    this.setupDebugListeners(this.videoElement);

    return new Promise((resolve, reject) => {
      this.videoElement!.addEventListener('loadedmetadata', () => {
        const video = this.videoElement!;
        
        this.info = {
          width: video.videoWidth,
          height: video.videoHeight,
          duration: video.duration,
          frameRate: 60,
          codec: 'avc1.640033',
        };

        resolve(this.info);
      });

      this.videoElement!.addEventListener('error', (e) => {
        reject(new Error(`Failed to load video: ${e}`));
      });
    });
  }

  /**
   * Get video element for seeking
   */
  getVideoElement(): HTMLVideoElement | null {
    return this.videoElement;
  }

  getInfo(): DecodedVideoInfo | null {
    return this.info;
  }

  destroy(): void {
    if (this.videoElement) {
      this.debugTeardown?.();
      this.debugTeardown = null;
      this.silentGuardTeardown?.();
      this.silentGuardTeardown = null;
      this.videoElement.pause();
      this.videoElement.src = '';
      this.videoElement = null;
    }
  }
}
