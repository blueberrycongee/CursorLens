import type React from 'react';
import type { TrimRegion } from '../types';

interface VideoEventHandlersParams {
  video: HTMLVideoElement;
  isSeekingRef: React.MutableRefObject<boolean>;
  isPlayingRef: React.MutableRefObject<boolean>;
  allowPlaybackRef: React.MutableRefObject<boolean>;
  currentTimeRef: React.MutableRefObject<number>;
  timeUpdateAnimationRef: React.MutableRefObject<number | null>;
  onPlayStateChange: (playing: boolean) => void;
  onTimeUpdate: (time: number) => void;
  trimRegionsRef: React.MutableRefObject<TrimRegion[]>;
}

export function createVideoEventHandlers(params: VideoEventHandlersParams) {
  const {
    video,
    isSeekingRef,
    isPlayingRef,
    allowPlaybackRef,
    currentTimeRef,
    timeUpdateAnimationRef,
    onPlayStateChange,
    onTimeUpdate,
    trimRegionsRef,
  } = params;

  const UI_TIME_UPDATE_INTERVAL_MS = 1000 / 30;
  let lastUiUpdateAt = 0;

  const emitTime = (timeValue: number, force = false) => {
    currentTimeRef.current = timeValue * 1000;
    const now = performance.now();
    if (force || now - lastUiUpdateAt >= UI_TIME_UPDATE_INTERVAL_MS) {
      lastUiUpdateAt = now;
      onTimeUpdate(timeValue);
    }
  };

  // Helper function to check if current time is within a trim region
  const findActiveTrimRegion = (currentTimeMs: number): TrimRegion | null => {
    const trimRegions = trimRegionsRef.current;
    return trimRegions.find(
      (region) => currentTimeMs >= region.startMs && currentTimeMs < region.endMs
    ) || null;
  };

  function updateTime() {
    if (!video) return;
    
    const currentTimeMs = video.currentTime * 1000;
    const activeTrimRegion = findActiveTrimRegion(currentTimeMs);
    
    // If we're in a trim region during playback, skip to the end of it
    if (activeTrimRegion && !video.paused && !video.ended) {
      const skipToTime = activeTrimRegion.endMs / 1000;
      
      // If the skip would take us past the video duration, pause instead
      if (skipToTime >= video.duration) {
        video.pause();
      } else {
        video.currentTime = skipToTime;
        emitTime(skipToTime, true);
      }
    } else {
      emitTime(video.currentTime);
    }
    
    if (!video.paused && !video.ended) {
      timeUpdateAnimationRef.current = requestAnimationFrame(updateTime);
    }
  }

  const handlePlay = () => {
    if (isSeekingRef.current) {
      video.pause();
      return;
    }

    if (!allowPlaybackRef.current) {
      video.pause();
      return;
    }

    isPlayingRef.current = true;
    onPlayStateChange(true);
    if (timeUpdateAnimationRef.current) {
      cancelAnimationFrame(timeUpdateAnimationRef.current);
    }
    timeUpdateAnimationRef.current = requestAnimationFrame(updateTime);
  };

    const handlePause = () => {
    isPlayingRef.current = false;
    onPlayStateChange(false);
    if (timeUpdateAnimationRef.current) {
      cancelAnimationFrame(timeUpdateAnimationRef.current);
      timeUpdateAnimationRef.current = null;
    }
    emitTime(video.currentTime, true);
  };

  const handleSeeked = () => {
    isSeekingRef.current = false;

    const currentTimeMs = video.currentTime * 1000;
    const activeTrimRegion = findActiveTrimRegion(currentTimeMs);
    
    // If we seeked into a trim region while playing, skip to the end
    if (activeTrimRegion && isPlayingRef.current && !video.paused) {
      const skipToTime = activeTrimRegion.endMs / 1000;
      
      if (skipToTime >= video.duration) {
        video.pause();
      } else {
        video.currentTime = skipToTime;
        emitTime(skipToTime, true);
      }
    } else {
      if (!isPlayingRef.current && !video.paused) {
        video.pause();
      }
      emitTime(video.currentTime, true);
    }
  };

  const handleSeeking = () => {
    isSeekingRef.current = true;

    if (!isPlayingRef.current && !video.paused) {
      video.pause();
    }
    emitTime(video.currentTime, true);
  };

  return {
    handlePlay,
    handlePause,
    handleSeeked,
    handleSeeking,
  };
}
