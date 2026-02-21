import { describe, expect, it, vi } from 'vitest';
import { VideoFileDecoder } from './videoDecoder';

function createMockVideo() {
  const listeners: Record<string, Function[]> = {};
  return {
    defaultMuted: false,
    muted: false,
    volume: 1,
    preload: '' as string,
    playsInline: false,
    paused: true,
    setAttribute: vi.fn(),
    addEventListener(event: string, handler: Function) {
      (listeners[event] ??= []).push(handler);
    },
    removeEventListener(event: string, handler: Function) {
      const arr = listeners[event];
      if (arr) listeners[event] = arr.filter((h) => h !== handler);
    },
    pause: vi.fn(),
    _emit(event: string) {
      for (const h of listeners[event] ?? []) h();
    },
    _listenerCount(event: string) {
      return (listeners[event] ?? []).length;
    },
  };
}

describe('VideoFileDecoder silent defences', () => {
  describe('applySilentDefaults', () => {
    it('sets muted, volume, preload and inline attributes', () => {
      const decoder = new VideoFileDecoder() as any;
      const video = createMockVideo();

      decoder.applySilentDefaults(video);

      expect(video.muted).toBe(true);
      expect(video.volume).toBe(0);
      expect(video.defaultMuted).toBe(true);
      expect(video.preload).toBe('metadata');
      expect(video.playsInline).toBe(true);
      expect(video.setAttribute).toHaveBeenCalledWith('muted', '');
      expect(video.setAttribute).toHaveBeenCalledWith('playsinline', '');
    });

    it('overrides a previously audible video element', () => {
      const decoder = new VideoFileDecoder() as any;
      const video = createMockVideo();
      video.muted = false;
      video.volume = 0.8;
      video.defaultMuted = false;

      decoder.applySilentDefaults(video);

      expect(video.muted).toBe(true);
      expect(video.volume).toBe(0);
      expect(video.defaultMuted).toBe(true);
    });
  });

  describe('setupSilentPlaybackGuard', () => {
    it('pauses and mutes on play event', () => {
      const decoder = new VideoFileDecoder() as any;
      const video = createMockVideo();

      decoder.setupSilentPlaybackGuard(video);
      video._emit('play');

      expect(video.pause).toHaveBeenCalledOnce();
      expect(video.muted).toBe(true);
      expect(video.volume).toBe(0);
      expect(video.defaultMuted).toBe(true);
    });

    it('intercepts multiple play events', () => {
      const decoder = new VideoFileDecoder() as any;
      const video = createMockVideo();

      decoder.setupSilentPlaybackGuard(video);
      video._emit('play');
      video._emit('play');
      video._emit('play');

      expect(video.pause).toHaveBeenCalledTimes(3);
    });

    it('stores a teardown function', () => {
      const decoder = new VideoFileDecoder() as any;
      const video = createMockVideo();

      decoder.setupSilentPlaybackGuard(video);

      expect(typeof decoder.silentGuardTeardown).toBe('function');
    });
  });

  describe('destroy', () => {
    it('calls silentGuardTeardown and nullifies it', () => {
      const decoder = new VideoFileDecoder() as any;
      const video = createMockVideo();

      decoder.videoElement = video;
      decoder.setupSilentPlaybackGuard(video);

      const playListenersBefore = video._listenerCount('play');
      decoder.destroy();

      expect(video._listenerCount('play')).toBeLessThan(playListenersBefore);
      expect(decoder.silentGuardTeardown).toBeNull();
      expect(decoder.videoElement).toBeNull();
    });

    it('is safe to call when no video element exists', () => {
      const decoder = new VideoFileDecoder() as any;
      decoder.videoElement = null;
      expect(() => decoder.destroy()).not.toThrow();
    });
  });
});
