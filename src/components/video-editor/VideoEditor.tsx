

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Toaster } from "@/components/ui/sonner";

import VideoPlayback, { VideoPlaybackRef } from "./VideoPlayback";
import PlaybackControls from "./PlaybackControls";
import TimelineEditor from "./timeline/TimelineEditor";
import { SettingsPanel } from "./SettingsPanel";
import type { Span } from "dnd-timeline";
import {
  DEFAULT_ZOOM_DEPTH,
  clampFocusToDepth,
  type ZoomDepth,
  type ZoomFocus,
  type ZoomRegion,
} from "./types";

const WALLPAPER_COUNT = 12;
const WALLPAPER_PATHS = Array.from({ length: WALLPAPER_COUNT }, (_, i) => `/wallpapers/wallpaper${i + 1}.jpg`);

export default function VideoEditor() {
  const [videoPath, setVideoPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [wallpaper, setWallpaper] = useState<string>(WALLPAPER_PATHS[0]);
  const [showShadow, setShowShadow] = useState(false);
  const [zoomRegions, setZoomRegions] = useState<ZoomRegion[]>([]);
  const [selectedZoomId, setSelectedZoomId] = useState<string | null>(null);

  const videoPlaybackRef = useRef<VideoPlaybackRef>(null);
  const nextZoomIdRef = useRef(1);

  useEffect(() => {
    async function loadVideo() {
      try {
        const result = await window.electronAPI.getRecordedVideoPath();
        if (result.success && result.path) {
          setVideoPath(`file://${result.path}`);
        } else {
          setError(result.message || 'Failed to load video');
        }
      } catch (err) {
        setError('Error loading video: ' + String(err));
      } finally {
        setLoading(false);
      }
    }
    loadVideo();
  }, []);

  function togglePlayPause() {
    const video = videoPlaybackRef.current?.video;
    console.log('🎮 Toggle play/pause:', { hasVideo: !!video, isPlaying, action: isPlaying ? 'pause' : 'play' });
    if (!video) return;
    
    if (isPlaying) {
      video.pause();
    } else {
      video.play().catch(err => console.error('❌ Video play failed:', err));
    }
  }

  function handleSeek(time: number) {
    const video = videoPlaybackRef.current?.video;
    if (!video) return;
    video.currentTime = time;
  }

  const handleSelectZoom = useCallback((id: string | null) => {
    setSelectedZoomId(id);
  }, []);

  const handleZoomAdded = useCallback((span: Span) => {
    const id = `zoom-${nextZoomIdRef.current++}`;
    const newRegion: ZoomRegion = {
      id,
      startMs: Math.round(span.start),
      endMs: Math.round(span.end),
      depth: DEFAULT_ZOOM_DEPTH,
      focus: { cx: 0.5, cy: 0.5 },
    };
    console.log('➕ Zoom region added:', newRegion);
    setZoomRegions((prev) => [...prev, newRegion]);
    setSelectedZoomId(id);
  }, []);

  const handleZoomSpanChange = useCallback((id: string, span: Span) => {
    console.log('⏱️ Zoom span changed:', { id, start: Math.round(span.start), end: Math.round(span.end) });
    setZoomRegions((prev) =>
      prev.map((region) =>
        region.id === id
          ? {
              ...region,
              startMs: Math.round(span.start),
              endMs: Math.round(span.end),
            }
          : region,
      ),
    );
  }, []);

  const handleZoomFocusChange = useCallback((id: string, focus: ZoomFocus) => {
    setZoomRegions((prev) =>
      prev.map((region) =>
        region.id === id
          ? {
              ...region,
              focus: clampFocusToDepth(focus, region.depth),
            }
          : region,
      ),
    );
  }, []);

  const handleZoomDepthChange = useCallback((depth: ZoomDepth) => {
    if (!selectedZoomId) return;
    setZoomRegions((prev) =>
      prev.map((region) =>
        region.id === selectedZoomId
          ? {
              ...region,
              depth,
              focus: clampFocusToDepth(region.focus, depth),
            }
          : region,
      ),
    );
  }, [selectedZoomId]);

  const handleZoomDelete = useCallback((id: string) => {
    console.log('🗑️ Zoom region deleted:', id);
    setZoomRegions((prev) => prev.filter((region) => region.id !== id));
    if (selectedZoomId === id) {
      setSelectedZoomId(null);
    }
  }, [selectedZoomId]);

  const selectedZoom = useMemo(() => {
    if (!selectedZoomId) return null;
    return zoomRegions.find((region) => region.id === selectedZoomId) ?? null;
  }, [selectedZoomId, zoomRegions]);

  useEffect(() => {
    if (selectedZoomId && !zoomRegions.some((region) => region.id === selectedZoomId)) {
      setSelectedZoomId(null);
    }
  }, [selectedZoomId, zoomRegions]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="text-foreground">Loading video...</div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="text-destructive">{error}</div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-background p-8 gap-8">
      <Toaster position="top-center" />
      <div className="flex flex-col flex-[7] min-w-0 gap-8">
        <div className="flex flex-col gap-6 flex-1">
          {videoPath && (
            <>
              <div className="flex justify-center w-full">
                <VideoPlayback
                  ref={videoPlaybackRef}
                  videoPath={videoPath}
                  onDurationChange={setDuration}
                  onTimeUpdate={setCurrentTime}
                  onPlayStateChange={setIsPlaying}
                  onError={setError}
                  wallpaper={wallpaper}
                  zoomRegions={zoomRegions}
                  selectedZoomId={selectedZoomId}
                  onSelectZoom={handleSelectZoom}
                  onZoomFocusChange={handleZoomFocusChange}
                  isPlaying={isPlaying}
                  showShadow={showShadow}
                />
              </div>
              <PlaybackControls
                isPlaying={isPlaying}
                currentTime={currentTime}
                duration={duration}
                onTogglePlayPause={togglePlayPause}
                onSeek={handleSeek}
              />
            </>
          )}
        </div>
        <TimelineEditor
          videoDuration={duration}
          currentTime={currentTime}
          onSeek={handleSeek}
          zoomRegions={zoomRegions}
          onZoomAdded={handleZoomAdded}
          onZoomSpanChange={handleZoomSpanChange}
          onZoomDelete={handleZoomDelete}
          selectedZoomId={selectedZoomId}
          onSelectZoom={handleSelectZoom}
        />
      </div>
      <SettingsPanel
        selected={wallpaper}
        onWallpaperChange={setWallpaper}
        selectedZoomDepth={selectedZoom?.depth}
        onZoomDepthChange={handleZoomDepthChange}
        selectedZoomId={selectedZoomId}
        onZoomDelete={handleZoomDelete}
        showShadow={showShadow}
        onShadowChange={setShowShadow}
      />
    </div>
  );
}