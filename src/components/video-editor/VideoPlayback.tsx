import type React from "react";
import { useEffect, useRef, useImperativeHandle, forwardRef, useState, useMemo, useCallback } from "react";
import * as PIXI from 'pixi.js';
import { ZOOM_DEPTH_SCALES, type ZoomRegion, type ZoomFocus, type ZoomDepth } from "./types";
import { DEFAULT_FOCUS, SMOOTHING_FACTOR, MIN_DELTA } from "./videoPlayback/constants";
import { clamp01 } from "./videoPlayback/mathUtils";
import { findDominantRegion } from "./videoPlayback/zoomRegionUtils";
import { clampFocusToStage as clampFocusToStageUtil } from "./videoPlayback/focusUtils";
import { updateOverlayIndicator } from "./videoPlayback/overlayUtils";
import { layoutVideoContent as layoutVideoContentUtil } from "./videoPlayback/layoutUtils";
import { applyZoomTransform } from "./videoPlayback/zoomTransform";
import { createVideoEventHandlers } from "./videoPlayback/videoEventHandlers";

interface VideoPlaybackProps {
  videoPath: string;
  onDurationChange: (duration: number) => void;
  onTimeUpdate: (time: number) => void;
  onPlayStateChange: (playing: boolean) => void;
  onError: (error: string) => void;
  wallpaper?: string;
  zoomRegions: ZoomRegion[];
  selectedZoomId: string | null;
  onSelectZoom: (id: string | null) => void;
  onZoomFocusChange: (id: string, focus: ZoomFocus) => void;
  isPlaying: boolean;
  showShadow?: boolean;
}

export interface VideoPlaybackRef {
  video: HTMLVideoElement | null;
  app: PIXI.Application | null;
  videoSprite: PIXI.Sprite | null;
  videoContainer: PIXI.Container | null;
}

const VideoPlayback = forwardRef<VideoPlaybackRef, VideoPlaybackProps>(({
  videoPath,
  onDurationChange,
  onTimeUpdate,
  onPlayStateChange,
  onError,
  wallpaper,
  zoomRegions,
  selectedZoomId,
  onSelectZoom,
  onZoomFocusChange,
  isPlaying,
  showShadow,
}, ref) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<PIXI.Application | null>(null);
  const videoSpriteRef = useRef<PIXI.Sprite | null>(null);
  const videoContainerRef = useRef<PIXI.Container | null>(null);
  const timeUpdateAnimationRef = useRef<number | null>(null);
  const [pixiReady, setPixiReady] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const focusIndicatorRef = useRef<HTMLDivElement | null>(null);
  const currentTimeRef = useRef(0);
  const zoomRegionsRef = useRef<ZoomRegion[]>([]);
  const selectedZoomIdRef = useRef<string | null>(null);
  const animationStateRef = useRef({ scale: 1, focusX: DEFAULT_FOCUS.cx, focusY: DEFAULT_FOCUS.cy });
  const blurFilterRef = useRef<PIXI.BlurFilter | null>(null);
  const isDraggingFocusRef = useRef(false);
  const stageSizeRef = useRef({ width: 0, height: 0 });
  const videoSizeRef = useRef({ width: 0, height: 0 });
  const baseScaleRef = useRef(1);
  const baseOffsetRef = useRef({ x: 0, y: 0 });
  const maskGraphicsRef = useRef<PIXI.Graphics | null>(null);
  const isPlayingRef = useRef(isPlaying);
  const isSeekingRef = useRef(false);

  const clampFocusToStage = useCallback((focus: ZoomFocus, depth: ZoomDepth) => {
    return clampFocusToStageUtil(focus, depth, stageSizeRef.current);
  }, []);

  const updateOverlayForRegion = useCallback((region: ZoomRegion | null, focusOverride?: ZoomFocus) => {
    const overlayEl = overlayRef.current;
    const indicatorEl = focusIndicatorRef.current;
    
    if (!overlayEl || !indicatorEl) {
      return;
    }

    // Update stage size from overlay dimensions
    const stageWidth = overlayEl.clientWidth;
    const stageHeight = overlayEl.clientHeight;
    if (stageWidth && stageHeight) {
      stageSizeRef.current = { width: stageWidth, height: stageHeight };
    }

    updateOverlayIndicator({
      overlayEl,
      indicatorEl,
      region,
      focusOverride,
      videoSize: videoSizeRef.current,
      baseScale: baseScaleRef.current,
      isPlaying: isPlayingRef.current,
    });
  }, []);

  const layoutVideoContent = useCallback(() => {
    const container = containerRef.current;
    const app = appRef.current;
    const videoSprite = videoSpriteRef.current;
    const maskGraphics = maskGraphicsRef.current;
    const videoElement = videoRef.current;

    if (!container || !app || !videoSprite || !maskGraphics || !videoElement) {
      return;
    }

    const result = layoutVideoContentUtil({
      container,
      app,
      videoSprite,
      maskGraphics,
      videoElement,
    });

    if (result) {
      stageSizeRef.current = result.stageSize;
      videoSizeRef.current = result.videoSize;
      baseScaleRef.current = result.baseScale;
      baseOffsetRef.current = result.baseOffset;

      const selectedId = selectedZoomIdRef.current;
      const activeRegion = selectedId
        ? zoomRegionsRef.current.find((region) => region.id === selectedId) ?? null
        : null;

      updateOverlayForRegion(activeRegion);
    }
  }, [updateOverlayForRegion]);

  const selectedZoom = useMemo(() => {
    if (!selectedZoomId) return null;
    return zoomRegions.find((region) => region.id === selectedZoomId) ?? null;
  }, [zoomRegions, selectedZoomId]);

  useImperativeHandle(ref, () => ({
    video: videoRef.current,
    app: appRef.current,
    videoSprite: videoSpriteRef.current,
    videoContainer: videoContainerRef.current,
  }));

  const updateFocusFromClientPoint = (clientX: number, clientY: number) => {
    const overlayEl = overlayRef.current;
    if (!overlayEl) return;

    const regionId = selectedZoomIdRef.current;
    if (!regionId) return;

    const region = zoomRegionsRef.current.find((r) => r.id === regionId);
    if (!region) return;

    const rect = overlayEl.getBoundingClientRect();
    const stageWidth = rect.width;
    const stageHeight = rect.height;

    if (!stageWidth || !stageHeight) {
      return;
    }

    stageSizeRef.current = { width: stageWidth, height: stageHeight };

    const localX = clientX - rect.left;
    const localY = clientY - rect.top;

    const unclampedFocus: ZoomFocus = {
      cx: clamp01(localX / stageWidth),
      cy: clamp01(localY / stageHeight),
    };
    const clampedFocus = clampFocusToStage(unclampedFocus, region.depth);

    onZoomFocusChange(region.id, clampedFocus);
    updateOverlayForRegion({ ...region, focus: clampedFocus }, clampedFocus);
  };

  const handleOverlayPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (isPlayingRef.current) return;
    const regionId = selectedZoomIdRef.current;
    if (!regionId) return;
    const region = zoomRegionsRef.current.find((r) => r.id === regionId);
    if (!region) return;
    onSelectZoom(region.id);
    event.preventDefault();
    isDraggingFocusRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    updateFocusFromClientPoint(event.clientX, event.clientY);
  };

  const handleOverlayPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingFocusRef.current) return;
    event.preventDefault();
    updateFocusFromClientPoint(event.clientX, event.clientY);
  };

  const endFocusDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingFocusRef.current) return;
    isDraggingFocusRef.current = false;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // ignore release errors when pointer capture is already cleared
    }
  };

  const handleOverlayPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    endFocusDrag(event);
  };

  const handleOverlayPointerLeave = (event: React.PointerEvent<HTMLDivElement>) => {
    endFocusDrag(event);
  };

  useEffect(() => {
    zoomRegionsRef.current = zoomRegions;
  }, [zoomRegions]);

  useEffect(() => {
    selectedZoomIdRef.current = selectedZoomId;
  }, [selectedZoomId]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    if (!pixiReady || !videoReady) return;
    layoutVideoContent();
  }, [pixiReady, videoReady, layoutVideoContent]);

  useEffect(() => {
    if (!pixiReady || !videoReady) return;
    const container = containerRef.current;
    if (!container) return;

    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver(() => {
      layoutVideoContent();
    });

    observer.observe(container);
    return () => {
      observer.disconnect();
    };
  }, [pixiReady, videoReady, layoutVideoContent]);

  useEffect(() => {
    if (!pixiReady || !videoReady) return;
    updateOverlayForRegion(selectedZoom);
  }, [selectedZoom, pixiReady, videoReady, updateOverlayForRegion]);

  useEffect(() => {
    const overlayEl = overlayRef.current;
    if (!overlayEl) return;
    if (!selectedZoom) {
      overlayEl.style.cursor = 'default';
      overlayEl.style.pointerEvents = 'none';
      return;
    }
    overlayEl.style.cursor = isPlaying ? 'not-allowed' : 'grab';
    overlayEl.style.pointerEvents = isPlaying ? 'none' : 'auto';
  }, [selectedZoom, isPlaying]);

  // Initialize PixiJS application
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let mounted = true;
    let app: PIXI.Application | null = null;

    // Initialize the app
    (async () => {
      app = new PIXI.Application();
      
      await app.init({
        width: container.clientWidth,
        height: container.clientHeight,
        backgroundAlpha: 0,
        antialias: true,
        resolution: window.devicePixelRatio || 1,
        autoDensity: true,
      });

      if (!mounted) {
        app.destroy(true, { children: true, texture: true, textureSource: true });
        return;
      }

      appRef.current = app;
      container.appendChild(app.canvas);

      const videoContainer = new PIXI.Container();
      videoContainerRef.current = videoContainer;
      app.stage.addChild(videoContainer);
      
      setPixiReady(true);
    })();

    return () => {
      mounted = false;
      setPixiReady(false);
      if (app && app.renderer) {
        app.destroy(true, { children: true, texture: true, textureSource: true });
      }
      appRef.current = null;
      videoContainerRef.current = null;
      videoSpriteRef.current = null;
    };
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    video.currentTime = 0;
  }, [videoPath]);

  useEffect(() => {
    if (!pixiReady || !videoReady) return;

    const video = videoRef.current;
    const app = appRef.current;
    const videoContainer = videoContainerRef.current;
    
    if (!video || !app || !videoContainer) return;
    if (video.videoWidth === 0 || video.videoHeight === 0) return;
    
    const source = PIXI.VideoSource.from(video);
    const videoTexture = PIXI.Texture.from(source);
    
    const videoSprite = new PIXI.Sprite(videoTexture);
    videoSpriteRef.current = videoSprite;
    
    const maskGraphics = new PIXI.Graphics();
    videoContainer.addChild(videoSprite);
    videoContainer.addChild(maskGraphics);
    videoContainer.mask = maskGraphics;
    maskGraphicsRef.current = maskGraphics;

    animationStateRef.current = {
      scale: 1,
      focusX: DEFAULT_FOCUS.cx,
      focusY: DEFAULT_FOCUS.cy,
    };

    const blurFilter = new PIXI.BlurFilter();
    blurFilter.quality = 3;
    blurFilter.resolution = app.renderer.resolution;
    blurFilter.blur = 0;
    videoContainer.filters = [blurFilter];
    blurFilterRef.current = blurFilter;
    
    layoutVideoContent();
    video.pause();

    const { handlePlay, handlePause, handleSeeked, handleSeeking } = createVideoEventHandlers({
      video,
      isSeekingRef,
      isPlayingRef,
      currentTimeRef,
      timeUpdateAnimationRef,
      onPlayStateChange,
      onTimeUpdate,
    });
    
    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);
    video.addEventListener('ended', handlePause);
    video.addEventListener('seeked', handleSeeked);
    video.addEventListener('seeking', handleSeeking);
    
    return () => {
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('ended', handlePause);
      video.removeEventListener('seeked', handleSeeked);
      video.removeEventListener('seeking', handleSeeking);
      
      if (timeUpdateAnimationRef.current) {
        cancelAnimationFrame(timeUpdateAnimationRef.current);
      }
      
      if (videoSprite) {
        videoContainer.removeChild(videoSprite);
        videoSprite.destroy();
      }
      if (maskGraphics) {
        videoContainer.removeChild(maskGraphics);
        maskGraphics.destroy();
      }
      videoContainer.mask = null;
      maskGraphicsRef.current = null;
      if (blurFilterRef.current) {
        videoContainer.filters = [];
        blurFilterRef.current.destroy();
        blurFilterRef.current = null;
      }
      videoTexture.destroy(true);
      
      videoSpriteRef.current = null;
    };
  }, [pixiReady, videoReady, onTimeUpdate, updateOverlayForRegion]);

  useEffect(() => {
    if (!pixiReady || !videoReady) return;

    const app = appRef.current;
    const videoSprite = videoSpriteRef.current;
    const videoContainer = videoContainerRef.current;
    if (!app || !videoSprite || !videoContainer) return;

    const applyTransform = (motionIntensity: number) => {
      const maskGraphics = maskGraphicsRef.current;
      if (!maskGraphics) return;

      const state = animationStateRef.current;

      applyZoomTransform({
        videoSprite,
        maskGraphics,
        blurFilter: blurFilterRef.current,
        stageSize: stageSizeRef.current,
        videoSize: videoSizeRef.current,
        baseScale: baseScaleRef.current,
        baseOffset: baseOffsetRef.current,
        zoomScale: state.scale,
        focusX: state.focusX,
        focusY: state.focusY,
        motionIntensity,
        isPlaying: isPlayingRef.current,
      });
    };

    const ticker = () => {
      const { region, strength } = findDominantRegion(zoomRegionsRef.current, currentTimeRef.current);
      
      const defaultFocus = DEFAULT_FOCUS;
      let targetScaleFactor = 1;
      let targetFocus = defaultFocus;

      if (region && strength > 0) {
        const zoomScale = ZOOM_DEPTH_SCALES[region.depth];
        const regionFocus = clampFocusToStage(region.focus, region.depth);
        
        // Interpolate scale and focus based on region strength
        targetScaleFactor = 1 + (zoomScale - 1) * strength;
        targetFocus = {
          cx: defaultFocus.cx + (regionFocus.cx - defaultFocus.cx) * strength,
          cy: defaultFocus.cy + (regionFocus.cy - defaultFocus.cy) * strength,
        };
      }

      const state = animationStateRef.current;

      const prevScale = state.scale;
      const prevFocusX = state.focusX;
      const prevFocusY = state.focusY;

      const scaleDelta = targetScaleFactor - state.scale;
      const focusXDelta = targetFocus.cx - state.focusX;
      const focusYDelta = targetFocus.cy - state.focusY;

      let nextScale = prevScale;
      let nextFocusX = prevFocusX;
      let nextFocusY = prevFocusY;

      if (Math.abs(scaleDelta) > MIN_DELTA) {
        nextScale = prevScale + scaleDelta * SMOOTHING_FACTOR;
      } else {
        nextScale = targetScaleFactor;
      }

      if (Math.abs(focusXDelta) > MIN_DELTA) {
        nextFocusX = prevFocusX + focusXDelta * SMOOTHING_FACTOR;
      } else {
        nextFocusX = targetFocus.cx;
      }

      if (Math.abs(focusYDelta) > MIN_DELTA) {
        nextFocusY = prevFocusY + focusYDelta * SMOOTHING_FACTOR;
      } else {
        nextFocusY = targetFocus.cy;
      }

      state.scale = nextScale;
      state.focusX = nextFocusX;
      state.focusY = nextFocusY;

      const motionIntensity = Math.max(
        Math.abs(nextScale - prevScale),
        Math.abs(nextFocusX - prevFocusX),
        Math.abs(nextFocusY - prevFocusY)
      );

      applyTransform(motionIntensity);
    };

    app.ticker.add(ticker);
    return () => {
      app.ticker.remove(ticker);
    };
  }, [pixiReady, videoReady, clampFocusToStage]);

  const handleLoadedMetadata = (e: React.SyntheticEvent<HTMLVideoElement, Event>) => {
    const video = e.currentTarget;
    onDurationChange(video.duration);
    video.currentTime = 0;
    video.pause();
    currentTimeRef.current = 0;
    setVideoReady(true);
  };

  const isImageUrl = wallpaper?.startsWith('/wallpapers/') || wallpaper?.startsWith('http');
  const backgroundStyle = isImageUrl 
    ? { backgroundImage: `url(${wallpaper || '/wallpapers/wallpaper1.jpg'})` }
    : { background: wallpaper || '/wallpapers/wallpaper1.jpg' };

  return (
    <div
      className="relative aspect-video rounded-sm overflow-hidden bg-cover bg-center"
      style={{ ...backgroundStyle, width: '100%' }}
    >
      <div
        ref={containerRef}
        className="absolute inset-0"
        style={{
          filter: showShadow
            ? 'drop-shadow(0 8px 32px rgba(0,0,0,0.55)) drop-shadow(0 2px 8px rgba(0,0,0,0.25))'
            : 'none',
        }}
      />
      <div
        ref={overlayRef}
        className="absolute inset-0 select-none"
        style={{ pointerEvents: 'none' }}
        onPointerDown={handleOverlayPointerDown}
        onPointerMove={handleOverlayPointerMove}
        onPointerUp={handleOverlayPointerUp}
        onPointerLeave={handleOverlayPointerLeave}
      >
        <div
          ref={focusIndicatorRef}
          className="absolute rounded-md border border-sky-400/80 bg-sky-400/20 shadow-[0_0_0_1px_rgba(56,189,248,0.35)]"
          style={{ display: 'none', pointerEvents: 'none' }}
        />
      </div>
      <video
        ref={videoRef}
        src={videoPath}
        className="hidden"
        preload="metadata"
        playsInline
        onLoadedMetadata={handleLoadedMetadata}
        onDurationChange={e => {
          onDurationChange(e.currentTarget.duration);
        }}
        onError={() => onError('Failed to load video')}
      />
    </div>
  );
});

VideoPlayback.displayName = 'VideoPlayback';

export default VideoPlayback;
