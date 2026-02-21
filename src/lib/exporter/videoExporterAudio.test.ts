import { describe, expect, it } from 'vitest';
import { VideoExporter } from './videoExporter';

// Lightweight AudioBuffer polyfill for Node (no Web Audio API available)
class FakeAudioBuffer {
  readonly numberOfChannels: number;
  readonly length: number;
  readonly sampleRate: number;
  private channels: Float32Array[];

  constructor(opts: { length: number; numberOfChannels: number; sampleRate: number }) {
    this.length = opts.length;
    this.numberOfChannels = opts.numberOfChannels;
    this.sampleRate = opts.sampleRate;
    this.channels = Array.from({ length: opts.numberOfChannels }, () => new Float32Array(opts.length));
  }

  getChannelData(channel: number): Float32Array {
    return this.channels[channel];
  }
}

// Patch global so `new AudioBuffer(...)` inside createAudioSlice works
(globalThis as any).AudioBuffer = FakeAudioBuffer;

function makeExporter(): any {
  return new VideoExporter({
    videoUrl: 'file:///tmp/mock.webm',
    width: 1920,
    height: 1080,
    frameRate: 60,
    bitrate: 20_000_000,
    wallpaper: '#000',
    zoomRegions: [],
    cropRegion: { x: 0, y: 0, width: 1, height: 1 },
    showShadow: false,
    shadowIntensity: 0,
    showBlur: false,
  }) as any;
}

function filledBuffer(length: number, channels: number, sampleRate: number, fillValue = 0.5): any {
  const buf = new FakeAudioBuffer({ length, numberOfChannels: channels, sampleRate });
  for (let ch = 0; ch < channels; ch++) {
    buf.getChannelData(ch).fill(fillValue);
  }
  return buf;
}

describe('VideoExporter createAudioSlice', () => {
  it('copies the correct sample range', () => {
    const exporter = makeExporter();
    const src = filledBuffer(100, 1, 44100);
    // Write a recognisable pattern
    const data = src.getChannelData(0);
    for (let i = 0; i < 100; i++) data[i] = i / 100;

    const result = exporter.createAudioSlice(src, 10, 20, 1, 1);

    expect(result).not.toBeNull();
    expect(result!.length).toBe(10);
    const out = result!.getChannelData(0);
    for (let i = 0; i < 10; i++) {
      expect(out[i]).toBeCloseTo((10 + i) / 100, 6);
    }
  });

  it('copies without processing when gain=1 and limiter is near 1', () => {
    const exporter = makeExporter();
    const src = filledBuffer(50, 1, 44100, 0.7);

    const result = exporter.createAudioSlice(src, 0, 50, 1, 1);

    expect(result).not.toBeNull();
    const out = result!.getChannelData(0);
    expect(out[0]).toBeCloseTo(0.7, 6);
    expect(out[49]).toBeCloseTo(0.7, 6);
  });

  it('applies gain multiplier', () => {
    const exporter = makeExporter();
    const src = filledBuffer(10, 1, 44100, 0.4);

    const result = exporter.createAudioSlice(src, 0, 10, 2, 1);

    expect(result).not.toBeNull();
    const out = result!.getChannelData(0);
    for (let i = 0; i < 10; i++) {
      expect(out[i]).toBeCloseTo(0.8, 6);
    }
  });

  it('clamps samples to limiter threshold', () => {
    const exporter = makeExporter();
    const src = filledBuffer(10, 1, 44100, 0.9);

    // gain=2 → scaled=1.8, limiter=0.95 → clamped to 0.95
    const result = exporter.createAudioSlice(src, 0, 10, 2, 0.95);

    expect(result).not.toBeNull();
    const out = result!.getChannelData(0);
    for (let i = 0; i < 10; i++) {
      expect(out[i]).toBeCloseTo(0.95, 6);
    }
  });

  it('clamps negative samples symmetrically', () => {
    const exporter = makeExporter();
    const src = filledBuffer(5, 1, 44100, -0.9);

    const result = exporter.createAudioSlice(src, 0, 5, 2, 0.95);

    expect(result).not.toBeNull();
    const out = result!.getChannelData(0);
    for (let i = 0; i < 5; i++) {
      expect(out[i]).toBeCloseTo(-0.95, 6);
    }
  });

  it('returns null for empty range (startFrame >= endFrame)', () => {
    const exporter = makeExporter();
    const src = filledBuffer(100, 1, 44100);

    expect(exporter.createAudioSlice(src, 50, 50, 1, 1)).toBeNull();
    expect(exporter.createAudioSlice(src, 60, 40, 1, 1)).toBeNull();
  });

  it('clamps out-of-bounds startFrame and endFrame', () => {
    const exporter = makeExporter();
    const src = filledBuffer(20, 1, 44100, 0.3);

    // startFrame=-5 clamped to 0, endFrame=30 clamped to 20
    const result = exporter.createAudioSlice(src, -5, 30, 1, 1);

    expect(result).not.toBeNull();
    expect(result!.length).toBe(20);
  });

  it('handles multiple channels correctly', () => {
    const exporter = makeExporter();
    const src = new FakeAudioBuffer({ length: 10, numberOfChannels: 2, sampleRate: 48000 }) as any;
    src.getChannelData(0).fill(0.2);
    src.getChannelData(1).fill(0.6);

    const result = exporter.createAudioSlice(src, 0, 10, 1, 1);

    expect(result).not.toBeNull();
    expect(result!.numberOfChannels).toBe(2);
    expect(result!.getChannelData(0)[0]).toBeCloseTo(0.2, 6);
    expect(result!.getChannelData(1)[0]).toBeCloseTo(0.6, 6);
  });
});
