import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { mockTextureConstructor, mockVideoSourceConstructor } = vi.hoisted(() => ({
  mockTextureConstructor: vi.fn(),
  mockVideoSourceConstructor: vi.fn(),
}));

vi.mock("pixi.js", () => {
  class MockApplication {}
  class MockContainer {
    addChild(): void {}
  }
  class MockSprite {
    texture: unknown;

    constructor(texture: unknown) {
      this.texture = texture;
    }
  }
  class MockGraphics {}
  class MockBlurFilter {}

  class MockVideoSource {
    options: unknown;
    autoUpdate = false;
    constructor(options: unknown) {
      this.options = options;
      mockVideoSourceConstructor(options);
    }
  }

  class MockTexture {
    source: unknown;
    constructor(options: { source?: unknown } = {}) {
      this.source = options.source;
      mockTextureConstructor(options);
    }
    static from = vi.fn((input: unknown) => new MockTexture({ source: input }));
  }

  return {
    Application: MockApplication,
    Container: MockContainer,
    Sprite: MockSprite,
    Graphics: MockGraphics,
    BlurFilter: MockBlurFilter,
    Texture: MockTexture,
    VideoSource: MockVideoSource,
  };
});

import { FrameRenderer } from "./frameRenderer";

describe("frameRenderer video texture setup", () => {
  let originalHtmlVideoElement: unknown;

  beforeAll(() => {
    originalHtmlVideoElement = (globalThis as typeof globalThis & { HTMLVideoElement?: unknown }).HTMLVideoElement;
    (globalThis as typeof globalThis & { HTMLVideoElement?: unknown }).HTMLVideoElement = class MockHTMLVideoElement {};
  });

  afterAll(() => {
    (globalThis as typeof globalThis & { HTMLVideoElement?: unknown }).HTMLVideoElement = originalHtmlVideoElement;
  });

  beforeEach(() => {
    mockTextureConstructor.mockClear();
    mockVideoSourceConstructor.mockClear();
  });

  it("creates VideoSource with autoplay disabled before source construction", () => {
    const renderer = new FrameRenderer({
      width: 1280,
      height: 720,
      wallpaper: "#000000",
      zoomRegions: [],
      showShadow: false,
      shadowIntensity: 0,
      showBlur: false,
      cropRegion: { x: 0, y: 0, width: 1, height: 1 },
      videoWidth: 1280,
      videoHeight: 720,
    }) as unknown as {
      createTextureFromVideoSource: (source: HTMLVideoElement | VideoFrame) => unknown;
    };

    const VideoElementCtor = (globalThis as typeof globalThis & { HTMLVideoElement: new () => HTMLVideoElement }).HTMLVideoElement;
    const videoElement = new VideoElementCtor();
    Object.assign(videoElement, {
      defaultMuted: false,
      muted: false,
      volume: 1,
      paused: true,
      currentTime: 0,
    });

    renderer.createTextureFromVideoSource(videoElement);

    expect(mockVideoSourceConstructor).toHaveBeenCalledTimes(1);
    expect(mockVideoSourceConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        resource: videoElement,
        autoPlay: false,
        autoLoad: true,
        muted: true,
      }),
    );
    expect(videoElement.defaultMuted).toBe(true);
    expect(videoElement.muted).toBe(true);
    expect(videoElement.volume).toBe(0);
    expect(mockTextureConstructor).toHaveBeenCalledTimes(1);
  });
});
