

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";

import VideoPlayback, { VideoPlaybackRef } from "./VideoPlayback";
import { PreviewAspectCropOverlay } from "./PreviewAspectCropOverlay";
import PlaybackControls from "./PlaybackControls";
import TimelineEditor from "./timeline/TimelineEditor";
import { SettingsPanel } from "./SettingsPanel";
import { ExportDialog } from "./ExportDialog";

import type { Span } from "dnd-timeline";
import {
  DEFAULT_ZOOM_DEPTH,
  clampFocusToDepth,
  DEFAULT_CROP_REGION,
  DEFAULT_ANNOTATION_POSITION,
  DEFAULT_ANNOTATION_SIZE,
  DEFAULT_ANNOTATION_STYLE,
  DEFAULT_FIGURE_DATA,
  type ZoomDepth,
  type ZoomFocus,
  type ZoomRegion,
  type TrimRegion,
  type AudioEditRegion,
  type AnnotationRegion,
  type CropRegion,
  type FigureData,
} from "./types";
import {
  VideoExporter,
  GifExporter,
  type ExportProgress,
  type ExportQuality,
  type ExportSettings,
  type ExportFormat,
  type GifFrameRate,
  type GifSizePreset,
  GIF_SIZE_PRESETS,
  calculateOutputDimensions,
  calculateMp4ExportPlan,
} from "@/lib/exporter";
import { ASPECT_RATIOS, type AspectRatio, getAspectRatioValue } from "@/utils/aspectRatioUtils";
import { getAssetPath } from "@/lib/assetPath";
import { useI18n } from "@/i18n";
import { DEFAULT_CURSOR_STYLE, type CursorStyleConfig, type CursorTrack, type CursorTrackEvent } from "@/lib/cursor";
import { cropRegionEquals, getCenteredAspectCropRegion, normalizeAspectCropRegion } from "@/lib/crop/aspectCrop";
import { generateAutoZoomDrafts } from "@/lib/autoEdit/screenStudioAutoZoom";
import type { RoughCutSuggestion, SubtitleCue } from "@/lib/analysis/types";
import { normalizeSubtitleCues } from "@/lib/analysis/subtitleTrack";
import { normalizeRoughCutSuggestions } from "@/lib/analysis/roughCutEngine";
import { applyRoughCutSuggestionsToAudioEdits } from "@/lib/analysis/roughCutApply";
import {
  clearStaleSelectedZoomIdForAspect,
  getSelectedZoomIdForAspect,
  getZoomRegionsForAspect,
  setSelectedZoomIdForAspect,
  setZoomRegionsForAspect,
  type SelectedZoomIdByAspect,
  type ZoomRegionsByAspect,
} from "@/lib/zoom/aspectZoomState";

const WALLPAPER_COUNT = 18;
const WALLPAPER_PATHS = Array.from({ length: WALLPAPER_COUNT }, (_, i) => `/wallpapers/wallpaper${i + 1}.jpg`);

function resolvePreviewFrameRate(sourceFrameRate?: number): number {
  if (!Number.isFinite(sourceFrameRate)) return 60;
  const normalized = Math.round(sourceFrameRate || 60);
  if (normalized < 30) return 30;
  // Keep editor preview capped to 60fps for consistent UI responsiveness.
  if (normalized > 60) return 60;
  return normalized;
}

function normalizeSelectedAspectRatios(selected: AspectRatio[]): AspectRatio[] {
  const selectedSet = new Set(selected);
  return ASPECT_RATIOS.filter((ratio) => selectedSet.has(ratio));
}

function resolveAspectCropRegion(
  regionsByAspect: Partial<Record<AspectRatio, CropRegion>>,
  ratio: AspectRatio,
  sourceAspectRatio: number,
): CropRegion {
  const targetAspectRatio = getAspectRatioValue(ratio);
  const region = regionsByAspect[ratio];
  if (!region) {
    return getCenteredAspectCropRegion(sourceAspectRatio, targetAspectRatio);
  }
  return normalizeAspectCropRegion(region, sourceAspectRatio, targetAspectRatio);
}

function fromFileUrl(input: string): string {
  if (!input) return input;
  if (!input.startsWith('file://')) return input;

  try {
    const parsed = new URL(input);
    return decodeURIComponent(parsed.pathname || '');
  } catch {
    return input.replace(/^file:\/\//, '');
  }
}

function normalizeCursorTrack(input: unknown): CursorTrack | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as {
    samples?: unknown[];
    events?: unknown[];
    source?: unknown;
    space?: unknown;
    stats?: unknown;
    capture?: unknown;
  };
  if (!Array.isArray(raw.samples) || raw.samples.length === 0) return null;

  const samples = raw.samples
    .map((sample) => {
      if (!sample || typeof sample !== "object") return null;
      const row = sample as {
        timeMs?: unknown;
        x?: unknown;
        y?: unknown;
        click?: unknown;
        visible?: unknown;
        cursorKind?: unknown;
      };
      const timeMs = Number(row.timeMs);
      const x = Number(row.x);
      const y = Number(row.y);
      if (!Number.isFinite(timeMs) || !Number.isFinite(x) || !Number.isFinite(y)) return null;
      const cursorKind: "arrow" | "ibeam" = row.cursorKind === "ibeam" ? "ibeam" : "arrow";
      return {
        timeMs: Math.max(0, Math.round(timeMs)),
        x: Math.min(1, Math.max(0, x)),
        y: Math.min(1, Math.max(0, y)),
        click: Boolean(row.click),
        visible: row.visible === false ? false : true,
        cursorKind,
      };
    })
    .filter((sample): sample is NonNullable<typeof sample> => Boolean(sample))
    .sort((a, b) => a.timeMs - b.timeMs);

  if (samples.length === 0) return null;
  const rawSpace = raw.space as { mode?: unknown; displayId?: unknown; bounds?: unknown } | undefined;
  const bounds = rawSpace?.bounds as { x?: unknown; y?: unknown; width?: unknown; height?: unknown } | undefined;
  const parsedSpace =
    bounds
      && Number.isFinite(Number(bounds.x))
      && Number.isFinite(Number(bounds.y))
      && Number.isFinite(Number(bounds.width))
      && Number.isFinite(Number(bounds.height))
      && Number(bounds.width) > 0
      && Number(bounds.height) > 0
      ? {
          mode: rawSpace?.mode === "source-display" ? "source-display" as const : "virtual-desktop" as const,
          displayId: typeof rawSpace?.displayId === "string" ? rawSpace.displayId : undefined,
          bounds: {
            x: Number(bounds.x),
            y: Number(bounds.y),
            width: Number(bounds.width),
            height: Number(bounds.height),
          },
        }
      : undefined;

  const rawStats = raw.stats as { sampleCount?: unknown; clickCount?: unknown } | undefined;
  const parsedStats = rawStats
    ? {
        sampleCount: Number.isFinite(Number(rawStats.sampleCount)) ? Math.max(0, Math.floor(Number(rawStats.sampleCount))) : undefined,
        clickCount: Number.isFinite(Number(rawStats.clickCount)) ? Math.max(0, Math.floor(Number(rawStats.clickCount))) : undefined,
      }
    : undefined;

  const rawCapture = raw.capture as { sourceId?: unknown; width?: unknown; height?: unknown } | undefined;
  const parsedCapture = rawCapture
    ? {
        sourceId: typeof rawCapture.sourceId === "string" ? rawCapture.sourceId : undefined,
        width: Number.isFinite(Number(rawCapture.width)) ? Math.max(2, Math.floor(Number(rawCapture.width))) : undefined,
        height: Number.isFinite(Number(rawCapture.height)) ? Math.max(2, Math.floor(Number(rawCapture.height))) : undefined,
      }
    : undefined;

  const parsedEvents = Array.isArray(raw.events)
    ? raw.events
      .map((event) => {
        if (!event || typeof event !== "object") return null;
        const row = event as {
          type?: unknown;
          startMs?: unknown;
          endMs?: unknown;
          point?: unknown;
          startPoint?: unknown;
          endPoint?: unknown;
          bounds?: unknown;
        };

        const eventType: CursorTrackEvent["type"] | null = row.type === "selection" ? "selection" : row.type === "click" ? "click" : null;
        const startMs = Number(row.startMs);
        const endMs = Number(row.endMs);
        const point = row.point as { x?: unknown; y?: unknown } | undefined;
        const pointX = Number(point?.x);
        const pointY = Number(point?.y);
        if (!eventType || !Number.isFinite(startMs) || !Number.isFinite(endMs) || !Number.isFinite(pointX) || !Number.isFinite(pointY)) {
          return null;
        }

        const normalizePoint = (source?: { x?: unknown; y?: unknown }) => {
          const x = Number(source?.x);
          const y = Number(source?.y);
          if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
          return {
            x: Math.min(1, Math.max(0, x)),
            y: Math.min(1, Math.max(0, y)),
          };
        };

        const bounds = row.bounds as {
          minX?: unknown;
          minY?: unknown;
          maxX?: unknown;
          maxY?: unknown;
        } | undefined;
        const minX = Number(bounds?.minX);
        const minY = Number(bounds?.minY);
        const maxX = Number(bounds?.maxX);
        const maxY = Number(bounds?.maxY);
        const parsedBounds = [minX, minY, maxX, maxY].every(Number.isFinite)
          ? {
            minX: Math.min(1, Math.max(0, minX)),
            minY: Math.min(1, Math.max(0, minY)),
            maxX: Math.max(Math.min(1, Math.max(0, minX)), Math.min(1, Math.max(0, maxX))),
            maxY: Math.max(Math.min(1, Math.max(0, minY)), Math.min(1, Math.max(0, maxY))),
            width: 0,
            height: 0,
          }
          : undefined;
        if (parsedBounds) {
          parsedBounds.width = parsedBounds.maxX - parsedBounds.minX;
          parsedBounds.height = parsedBounds.maxY - parsedBounds.minY;
        }

        const normalizedEvent: CursorTrackEvent = {
          type: eventType,
          startMs: Math.max(0, Math.round(startMs)),
          endMs: Math.max(Math.max(0, Math.round(startMs)), Math.round(endMs)),
          point: {
            x: Math.min(1, Math.max(0, pointX)),
            y: Math.min(1, Math.max(0, pointY)),
          },
        };
        const parsedStartPoint = normalizePoint(row.startPoint as { x?: unknown; y?: unknown } | undefined);
        if (parsedStartPoint) {
          normalizedEvent.startPoint = parsedStartPoint;
        }
        const parsedEndPoint = normalizePoint(row.endPoint as { x?: unknown; y?: unknown } | undefined);
        if (parsedEndPoint) {
          normalizedEvent.endPoint = parsedEndPoint;
        }
        if (parsedBounds) {
          normalizedEvent.bounds = parsedBounds;
        }
        return normalizedEvent;
      })
      .filter((event): event is NonNullable<typeof event> => Boolean(event))
      .sort((a, b) => a.startMs - b.startMs)
    : undefined;

  return {
    samples,
    events: parsedEvents,
    source: raw.source === "synthetic" ? "synthetic" : "recorded",
    space: parsedSpace,
    stats: parsedStats,
    capture: parsedCapture,
  };
}

export default function VideoEditor() {
  const { t, locale } = useI18n();
  const [videoPath, setVideoPath] = useState<string | null>(null);
  const [videoFilePath, setVideoFilePath] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [wallpaper, setWallpaper] = useState<string>(WALLPAPER_PATHS[0]);
  const [shadowIntensity, setShadowIntensity] = useState(0);
  const [showBlur, setShowBlur] = useState(false);
  const [motionBlurEnabled, setMotionBlurEnabled] = useState(false);
  const [borderRadius, setBorderRadius] = useState(0);
  const [padding, setPadding] = useState(50);
  const [sourceVideoDimensions, setSourceVideoDimensions] = useState<{ width: number; height: number } | null>(null);
  const [cropRegionsByAspect, setCropRegionsByAspect] = useState<Partial<Record<AspectRatio, CropRegion>>>({
    '16:9': DEFAULT_CROP_REGION,
  });
  const [zoomRegionsByAspect, setZoomRegionsByAspect] = useState<ZoomRegionsByAspect>({});
  const [selectedZoomIdByAspect, setSelectedZoomIdByAspect] = useState<SelectedZoomIdByAspect>({});
  const [trimRegions, setTrimRegions] = useState<TrimRegion[]>([]);
  const [audioEditRegions, setAudioEditRegions] = useState<AudioEditRegion[]>([]);
  const [selectedTrimId, setSelectedTrimId] = useState<string | null>(null);
  const [annotationRegions, setAnnotationRegions] = useState<AnnotationRegion[]>([]);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('16:9');
  const [exportAspectRatios, setExportAspectRatios] = useState<AspectRatio[]>(['16:9']);
  const [activeBatchExport, setActiveBatchExport] = useState<{
    current: number;
    total: number;
    aspectRatio: AspectRatio;
  } | null>(null);
  const [exportQuality, setExportQuality] = useState<ExportQuality>('source');
  const [exportFormat, setExportFormat] = useState<ExportFormat>('mp4');
  const [gifFrameRate, setGifFrameRate] = useState<GifFrameRate>(15);
  const [gifLoop, setGifLoop] = useState(true);
  const [gifSizePreset, setGifSizePreset] = useState<GifSizePreset>('medium');
  const [sourceFrameRate, setSourceFrameRate] = useState<number | undefined>(undefined);
  const [sourceHasAudio, setSourceHasAudio] = useState(true);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [audioGain, setAudioGain] = useState(1);
  const [cursorTrack, setCursorTrack] = useState<CursorTrack | null>(null);
  const [cursorStyle, setCursorStyle] = useState<CursorStyleConfig>(DEFAULT_CURSOR_STYLE);
  const [subtitleCues, setSubtitleCues] = useState<SubtitleCue[]>([]);
  const [roughCutSuggestions, setRoughCutSuggestions] = useState<RoughCutSuggestion[]>([]);
  const [analysisJobId, setAnalysisJobId] = useState<string | null>(null);
  const [analysisInProgress, setAnalysisInProgress] = useState(false);
  const analysisPollingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const videoPlaybackRef = useRef<VideoPlaybackRef>(null);
  const nextZoomIdRef = useRef(1);
  const nextTrimIdRef = useRef(1);
  const nextAnnotationIdRef = useRef(1);
  const nextAnnotationZIndexRef = useRef(1); // Track z-index for stacking order
  const exporterRef = useRef<{ cancel: () => void } | null>(null);
  const exportCancelledRef = useRef(false);
  const autoEditInitializedAspectsRef = useRef<Set<AspectRatio>>(new Set());
  const sourceAspectRatio = useMemo(() => {
    const fallback = 16 / 9;
    if (sourceVideoDimensions && sourceVideoDimensions.width > 0 && sourceVideoDimensions.height > 0) {
      return sourceVideoDimensions.width / sourceVideoDimensions.height;
    }
    const video = videoPlaybackRef.current?.video;
    if (video && video.videoWidth > 0 && video.videoHeight > 0) {
      return video.videoWidth / video.videoHeight;
    }
    return fallback;
  }, [sourceVideoDimensions]);
  const normalizedExportAspectRatios = useMemo(
    () => normalizeSelectedAspectRatios(exportAspectRatios),
    [exportAspectRatios],
  );
  const activeCropRegion = useMemo(
    () => resolveAspectCropRegion(cropRegionsByAspect, aspectRatio, sourceAspectRatio),
    [aspectRatio, cropRegionsByAspect, sourceAspectRatio],
  );
  const zoomRegions = useMemo(
    () => getZoomRegionsForAspect(zoomRegionsByAspect, aspectRatio),
    [zoomRegionsByAspect, aspectRatio],
  );
  const selectedZoomId = useMemo(
    () => getSelectedZoomIdForAspect(selectedZoomIdByAspect, aspectRatio),
    [selectedZoomIdByAspect, aspectRatio],
  );
  const showAspectCropOverlay = exportFormat === "mp4" && normalizedExportAspectRatios.includes(aspectRatio);

  const setZoomRegionsForActiveAspect = useCallback((updater: (regions: ZoomRegion[]) => ZoomRegion[]) => {
    setZoomRegionsByAspect((previous) => {
      const current = getZoomRegionsForAspect(previous, aspectRatio);
      const next = updater(current);
      return setZoomRegionsForAspect(previous, aspectRatio, next);
    });
  }, [aspectRatio]);

  const setSelectedZoomIdForActiveAspect = useCallback((nextSelectedZoomId: string | null) => {
    setSelectedZoomIdByAspect((previous) =>
      setSelectedZoomIdForAspect(previous, aspectRatio, nextSelectedZoomId),
    );
  }, [aspectRatio]);

  const setCropRegionForAspect = useCallback((ratio: AspectRatio, region: CropRegion) => {
    setCropRegionsByAspect((previous) => {
      const normalized = normalizeAspectCropRegion(region, sourceAspectRatio, getAspectRatioValue(ratio));
      const existing = previous[ratio];
      if (existing && cropRegionEquals(existing, normalized)) {
        return previous;
      }
      return {
        ...previous,
        [ratio]: normalized,
      };
    });
  }, [sourceAspectRatio]);

  const handleActiveCropRegionChange = useCallback((region: CropRegion) => {
    setCropRegionForAspect(aspectRatio, region);
  }, [aspectRatio, setCropRegionForAspect]);

  // Helper to convert file path to proper file:// URL
  const toFileUrl = (filePath: string): string => {
    if (!filePath) return filePath;
    if (filePath.startsWith("file://")) return filePath;

    // Normalize path separators to forward slashes
    const normalized = filePath.replace(/\\/g, '/');
    const encoded = encodeURI(normalized);
    
    // Check if it's a Windows absolute path (e.g., C:/Users/...)
    if (encoded.match(/^[a-zA-Z]:/)) {
      const fileUrl = `file:///${encoded}`;
      return fileUrl;
    }

    if (encoded.startsWith('/')) {
      // Unix-style absolute path
      return `file://${encoded}`;
    }

    // Relative paths or other URLs are returned as-is after encoding.
    return encoded;
  };

  useEffect(() => {
    async function loadVideo() {
      try {
        const result = await window.electronAPI.getCurrentVideoPath();
        
        if (result.success && result.path) {
          const videoUrl = toFileUrl(result.path);
          setVideoPath(videoUrl);
          setVideoFilePath(result.path);
          setSourceFrameRate(
            Number.isFinite(result.metadata?.frameRate) ? result.metadata?.frameRate : undefined,
          );
          const metadataWithCursor = result.metadata as {
            cursorTrack?: unknown;
            hasMicrophoneAudio?: unknown;
          } | undefined;
          setCursorTrack(normalizeCursorTrack(metadataWithCursor?.cursorTrack));
          if (typeof metadataWithCursor?.hasMicrophoneAudio === "boolean") {
            setSourceHasAudio(metadataWithCursor.hasMicrophoneAudio);
            setAudioEnabled(metadataWithCursor.hasMicrophoneAudio);
          } else {
            setSourceHasAudio(true);
            setAudioEnabled(true);
          }
        } else {
          setVideoFilePath(null);
          setError(t('editor.noVideo'));
        }
      } catch (err) {
        setError(t("editor.loadVideoError", { message: String(err) }));
      } finally {
        setLoading(false);
      }
    }
    loadVideo();
  }, [t]);

  // Initialize default wallpaper with resolved asset path
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const resolvedPath = await getAssetPath('wallpapers/wallpaper1.jpg');
        if (mounted) {
          setWallpaper(resolvedPath);
        }
      } catch (err) {
        // If resolution fails, keep the fallback
        console.warn('Failed to resolve default wallpaper path:', err);
      }
    })();
    return () => { mounted = false };
  }, []);

  function togglePlayPause() {
    const playback = videoPlaybackRef.current;
    const video = playback?.video;
    if (!playback || !video) return;

    if (isPlaying) {
      playback.pause();
    } else {
      playback.play().catch(err => console.error('Video play failed:', err));
    }
  }

  function handleSeek(time: number) {
    const video = videoPlaybackRef.current?.video;
    if (!video) return;
    video.currentTime = time;
  }

  const handleSelectZoom = useCallback((id: string | null) => {
    setSelectedZoomIdForActiveAspect(id);
    if (id) setSelectedTrimId(null);
  }, [setSelectedZoomIdForActiveAspect]);

  const handleSelectTrim = useCallback((id: string | null) => {
    setSelectedTrimId(id);
    if (id) {
      setSelectedZoomIdForActiveAspect(null);
      setSelectedAnnotationId(null);
    }
  }, [setSelectedZoomIdForActiveAspect]);

  const handleSelectAnnotation = useCallback((id: string | null) => {
    setSelectedAnnotationId(id);
    if (id) {
      setSelectedZoomIdForActiveAspect(null);
      setSelectedTrimId(null);
    }
  }, [setSelectedZoomIdForActiveAspect]);

  const handleZoomAdded = useCallback((span: Span) => {
    const id = `zoom-${nextZoomIdRef.current++}`;
    const newRegion: ZoomRegion = {
      id,
      startMs: Math.round(span.start),
      endMs: Math.round(span.end),
      depth: DEFAULT_ZOOM_DEPTH,
      focus: { cx: 0.5, cy: 0.5 },
    };
    setZoomRegionsForActiveAspect((prev) => [...prev, newRegion]);
    setSelectedZoomIdForActiveAspect(id);
    setSelectedTrimId(null);
    setSelectedAnnotationId(null);
  }, [setSelectedZoomIdForActiveAspect, setZoomRegionsForActiveAspect]);

  const handleTrimAdded = useCallback((span: Span) => {
    const id = `trim-${nextTrimIdRef.current++}`;
    const newRegion: TrimRegion = {
      id,
      startMs: Math.round(span.start),
      endMs: Math.round(span.end),
    };
    setTrimRegions((prev) => [...prev, newRegion]);
    setSelectedTrimId(id);
    setSelectedZoomIdForActiveAspect(null);
    setSelectedAnnotationId(null);
  }, [setSelectedZoomIdForActiveAspect]);

  const handleZoomSpanChange = useCallback((id: string, span: Span) => {
    setZoomRegionsForActiveAspect((prev) =>
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
  }, [setZoomRegionsForActiveAspect]);

  const handleTrimSpanChange = useCallback((id: string, span: Span) => {
    setTrimRegions((prev) =>
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
    setZoomRegionsForActiveAspect((prev) =>
      prev.map((region) =>
        region.id === id
          ? {
              ...region,
              focus: clampFocusToDepth(focus, region.depth),
            }
          : region,
      ),
    );
  }, [setZoomRegionsForActiveAspect]);

  const handleZoomDepthChange = useCallback((depth: ZoomDepth) => {
    if (!selectedZoomId) return;
    setZoomRegionsForActiveAspect((prev) =>
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
  }, [selectedZoomId, setZoomRegionsForActiveAspect]);

  const handleZoomDelete = useCallback((id: string) => {
    setZoomRegionsForActiveAspect((prev) => prev.filter((region) => region.id !== id));
    if (selectedZoomId === id) {
      setSelectedZoomIdForActiveAspect(null);
    }
  }, [selectedZoomId, setSelectedZoomIdForActiveAspect, setZoomRegionsForActiveAspect]);

  const applyAutoZoomEdits = useCallback((options?: { silent?: boolean }) => {
    const durationMs = Math.round(duration * 1000);
    if (!Number.isFinite(durationMs) || durationMs < 200 || !cursorTrack?.samples?.length) {
      if (!options?.silent) {
        toast.info(t("editor.autoEditUnavailable"));
      }
      return 0;
    }

    const drafts = generateAutoZoomDrafts(cursorTrack, {
      durationMs,
      maxRegions: 64,
    });

    if (drafts.length === 0) {
      if (!options?.silent) {
        toast.info(t("editor.autoEditUnavailable"));
      }
      return 0;
    }

    const generatedZoomRegions: ZoomRegion[] = drafts.map((draft) => ({
      id: `zoom-${nextZoomIdRef.current++}`,
      startMs: draft.startMs,
      endMs: draft.endMs,
      depth: draft.depth,
      focus: clampFocusToDepth(draft.focus, draft.depth),
    }));

    setZoomRegionsByAspect((previous) =>
      setZoomRegionsForAspect(previous, aspectRatio, generatedZoomRegions),
    );
    setSelectedZoomIdForActiveAspect(generatedZoomRegions[0]?.id ?? null);
    setSelectedTrimId(null);
    setSelectedAnnotationId(null);

    if (!options?.silent) {
      toast.success(t("editor.autoEditApplied", { count: generatedZoomRegions.length }));
    }

    return generatedZoomRegions.length;
  }, [aspectRatio, cursorTrack, duration, setSelectedZoomIdForActiveAspect, t]);

  const handleAutoEdit = useCallback(() => {
    autoEditInitializedAspectsRef.current.add(aspectRatio);
    applyAutoZoomEdits();
  }, [applyAutoZoomEdits, aspectRatio]);

  const handleTrimDelete = useCallback((id: string) => {
    setTrimRegions((prev) => prev.filter((region) => region.id !== id));
    if (selectedTrimId === id) {
      setSelectedTrimId(null);
    }
  }, [selectedTrimId]);

  const handleAnnotationAdded = useCallback((span: Span) => {
    const id = `annotation-${nextAnnotationIdRef.current++}`;
    const zIndex = nextAnnotationZIndexRef.current++; // Assign z-index based on creation order
    const newRegion: AnnotationRegion = {
      id,
      startMs: Math.round(span.start),
      endMs: Math.round(span.end),
      type: 'text',
      content: 'Enter text...',
      position: { ...DEFAULT_ANNOTATION_POSITION },
      size: { ...DEFAULT_ANNOTATION_SIZE },
      style: { ...DEFAULT_ANNOTATION_STYLE },
      zIndex,
    };
    setAnnotationRegions((prev) => [...prev, newRegion]);
    setSelectedAnnotationId(id);
    setSelectedZoomIdForActiveAspect(null);
    setSelectedTrimId(null);
  }, [setSelectedZoomIdForActiveAspect]);

  const handleAnnotationSpanChange = useCallback((id: string, span: Span) => {
    setAnnotationRegions((prev) =>
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

  const handleAnnotationDelete = useCallback((id: string) => {
    setAnnotationRegions((prev) => prev.filter((region) => region.id !== id));
    if (selectedAnnotationId === id) {
      setSelectedAnnotationId(null);
    }
  }, [selectedAnnotationId]);

  const handleAnnotationContentChange = useCallback((id: string, content: string) => {
    setAnnotationRegions((prev) => {
      const updated = prev.map((region) => {
        if (region.id !== id) return region;
        
        // Store content in type-specific fields
        if (region.type === 'text') {
          return { ...region, content, textContent: content };
        } else if (region.type === 'image') {
          return { ...region, content, imageContent: content };
        } else {
          return { ...region, content };
        }
      });
      return updated;
    });
  }, []);

  const handleAnnotationTypeChange = useCallback((id: string, type: AnnotationRegion['type']) => {
    setAnnotationRegions((prev) => {
      const updated = prev.map((region) => {
        if (region.id !== id) return region;
        
        const updatedRegion = { ...region, type };
        
        // Restore content from type-specific storage
        if (type === 'text') {
          updatedRegion.content = region.textContent || 'Enter text...';
        } else if (type === 'image') {
          updatedRegion.content = region.imageContent || '';
        } else if (type === 'figure') {
          updatedRegion.content = '';
          if (!region.figureData) {
            updatedRegion.figureData = { ...DEFAULT_FIGURE_DATA };
          }
        }
        
        return updatedRegion;
      });
      return updated;
    });
  }, []);

  const handleAnnotationStyleChange = useCallback((id: string, style: Partial<AnnotationRegion['style']>) => {
    setAnnotationRegions((prev) =>
      prev.map((region) =>
        region.id === id
          ? { ...region, style: { ...region.style, ...style } }
          : region,
      ),
    );
  }, []);

  const handleAnnotationFigureDataChange = useCallback((id: string, figureData: FigureData) => {
    setAnnotationRegions((prev) =>
      prev.map((region) =>
        region.id === id
          ? { ...region, figureData }
          : region,
      ),
    );
  }, []);

  const handleAnnotationPositionChange = useCallback((id: string, position: { x: number; y: number }) => {
    setAnnotationRegions((prev) =>
      prev.map((region) =>
        region.id === id
          ? { ...region, position }
          : region,
      ),
    );
  }, []);

  const handleAnnotationSizeChange = useCallback((id: string, size: { width: number; height: number }) => {
    setAnnotationRegions((prev) =>
      prev.map((region) =>
        region.id === id
          ? { ...region, size }
          : region,
      ),
    );
  }, []);
  
  // Global Tab prevention
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Tab') {
        // Allow tab only in inputs/textareas
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
          return;
        }
        e.preventDefault();
      }

      if (e.key === ' ' || e.code === 'Space') {
        // Allow space only in inputs/textareas
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
          return;
        }
        e.preventDefault();
        
        const playback = videoPlaybackRef.current;
        if (playback?.video) {
          if (playback.video.paused) {
            playback.play().catch(console.error);
          } else {
            playback.pause();
          }
        }
      }
    };
    
    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, []);

  useEffect(() => {
    setSelectedZoomIdByAspect((previous) =>
      clearStaleSelectedZoomIdForAspect(previous, zoomRegionsByAspect, aspectRatio),
    );
  }, [aspectRatio, zoomRegionsByAspect]);

  useEffect(() => {
    if (selectedTrimId && !trimRegions.some((region) => region.id === selectedTrimId)) {
      setSelectedTrimId(null);
    }
  }, [selectedTrimId, trimRegions]);

  useEffect(() => {
    if (selectedAnnotationId && !annotationRegions.some((region) => region.id === selectedAnnotationId)) {
      setSelectedAnnotationId(null);
    }
  }, [selectedAnnotationId, annotationRegions]);

  useEffect(() => {
    setCropRegionsByAspect((previous) => {
      const normalized = resolveAspectCropRegion(previous, aspectRatio, sourceAspectRatio);
      const existing = previous[aspectRatio];
      if (existing && cropRegionEquals(existing, normalized)) {
        return previous;
      }
      return {
        ...previous,
        [aspectRatio]: normalized,
      };
    });
  }, [aspectRatio, sourceAspectRatio]);

  useEffect(() => {
    if (loading) return;
    if (autoEditInitializedAspectsRef.current.has(aspectRatio)) return;
    if (zoomRegions.length > 0) {
      autoEditInitializedAspectsRef.current.add(aspectRatio);
      return;
    }
    if (!cursorTrack?.samples?.length) {
      autoEditInitializedAspectsRef.current.add(aspectRatio);
      return;
    }
    if (!Number.isFinite(duration) || duration <= 0) return;

    autoEditInitializedAspectsRef.current.add(aspectRatio);
    applyAutoZoomEdits({ silent: true });
  }, [applyAutoZoomEdits, aspectRatio, cursorTrack, duration, loading, zoomRegions.length]);

  const stopAnalysisPolling = useCallback(() => {
    if (analysisPollingTimerRef.current) {
      clearInterval(analysisPollingTimerRef.current);
      analysisPollingTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      stopAnalysisPolling();
    };
  }, [stopAnalysisPolling]);

  const applyAnalysis = useCallback((analysis?: VideoAnalysisMetadata) => {
    if (!analysis) {
      setSubtitleCues([]);
      setRoughCutSuggestions([]);
      return;
    }

    const normalizedCues = normalizeSubtitleCues(Array.isArray(analysis.subtitleCues) ? analysis.subtitleCues : []);
    const transcriptWords = Array.isArray(analysis.transcript?.words) ? analysis.transcript.words : [];
    const fallbackDurationMs = transcriptWords.length > 0
      ? Math.max(0, Math.round(transcriptWords[transcriptWords.length - 1].endMs))
      : 0;
    const normalizedSuggestions = normalizeRoughCutSuggestions(
      Array.isArray(analysis.roughCutSuggestions) ? analysis.roughCutSuggestions : [],
      Math.max(fallbackDurationMs, Math.round(duration * 1000)),
    );
    setSubtitleCues(normalizedCues);
    setRoughCutSuggestions(normalizedSuggestions);
  }, [duration]);

  useEffect(() => {
    let cancelled = false;

    if (!videoFilePath) {
      applyAnalysis(undefined);
      return;
    }

    applyAnalysis(undefined);
    void (async () => {
      try {
        const result = await window.electronAPI.getCurrentVideoAnalysis(videoFilePath);
        if (cancelled || !result.success) return;
        applyAnalysis(result.analysis);
      } catch (error) {
        console.warn('Failed to load cached analysis sidecar:', error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [applyAnalysis, videoFilePath]);

  useEffect(() => {
    stopAnalysisPolling();
    setAnalysisInProgress(false);
    setAnalysisJobId(null);
  }, [stopAnalysisPolling, videoFilePath]);

  const handleGenerateSubtitles = useCallback(async () => {
    if (analysisInProgress) {
      return;
    }

    const targetPath = (videoFilePath || fromFileUrl(videoPath || '')).trim();
    if (!targetPath) {
      toast.error(t('editor.noVideoLoaded'));
      return;
    }

    const video = videoPlaybackRef.current?.video;
    const sourceWidth = video?.videoWidth || 1920;

    try {
      const result = await window.electronAPI.startVideoAnalysis({
        videoPath: targetPath,
        locale: locale === 'zh-CN' ? 'zh-CN' : 'en-US',
        durationMs: Math.max(0, Math.round(duration * 1000)),
        videoWidth: sourceWidth,
        subtitleWidthRatio: 0.82,
      });

      if (!result.success || !result.jobId) {
        toast.error(t('editor.analysisStartFailed'), {
          description: result.message,
        });
        return;
      }

      stopAnalysisPolling();
      setAnalysisInProgress(true);
      setAnalysisJobId(result.jobId);
      toast.info(t('editor.analysisRunning'));
    } catch (error) {
      toast.error(t('editor.analysisStartFailed'), {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  }, [analysisInProgress, duration, locale, stopAnalysisPolling, t, videoFilePath, videoPath]);

  useEffect(() => {
    if (!analysisJobId) {
      return;
    }

    let cancelled = false;
    let polling = false;

    const finishWithError = (message?: string) => {
      if (cancelled) return;
      stopAnalysisPolling();
      setAnalysisInProgress(false);
      setAnalysisJobId(null);
      toast.error(t('editor.analysisStartFailed'), {
        description: message || t('error.unexpected'),
      });
    };

    const pollOnce = async () => {
      if (polling || cancelled) return;
      polling = true;
      try {
        const statusResult = await window.electronAPI.getVideoAnalysisStatus(analysisJobId);
        if (!statusResult.success || !statusResult.status) {
          finishWithError(statusResult.message);
          return;
        }

        const jobStatus = statusResult.status.status;
        if (jobStatus === 'failed') {
          finishWithError(statusResult.status.error || statusResult.message);
          return;
        }

        if (jobStatus !== 'completed') {
          return;
        }

        const result = await window.electronAPI.getVideoAnalysisResult(analysisJobId);
        if (!result.success || !result.result) {
          finishWithError(result.message);
          return;
        }

        stopAnalysisPolling();
        setAnalysisInProgress(false);
        setAnalysisJobId(null);
        applyAnalysis(result.result);

        toast.success(t('editor.analysisCompleted'));
        if (!result.result.subtitleCues?.length) {
          toast.info(t('editor.analysisNoSubtitles'));
        }
        if (!result.result.roughCutSuggestions?.length) {
          toast.info(t('editor.analysisNoSuggestions'));
        }
      } catch (error) {
        finishWithError(error instanceof Error ? error.message : String(error));
      } finally {
        polling = false;
      }
    };

    void pollOnce();
    analysisPollingTimerRef.current = setInterval(() => {
      void pollOnce();
    }, 900);

    return () => {
      cancelled = true;
      stopAnalysisPolling();
    };
  }, [analysisJobId, applyAnalysis, stopAnalysisPolling, t]);

  const handleApplyRoughCut = useCallback(() => {
    if (!roughCutSuggestions.length) {
      toast.info(t('editor.analysisNoSuggestions'));
      return;
    }

    const nextAudioEditRegions = applyRoughCutSuggestionsToAudioEdits(
      audioEditRegions,
      roughCutSuggestions,
      Math.max(0, Math.round(duration * 1000)),
    );
    setAudioEditRegions(nextAudioEditRegions);
    setSelectedZoomIdForActiveAspect(null);
    setSelectedTrimId(null);
    setSelectedAnnotationId(null);

    toast.success(t('editor.analysisApplyRoughCutSuccess', {
      count: roughCutSuggestions.length,
    }));
  }, [audioEditRegions, duration, roughCutSuggestions, setSelectedZoomIdForActiveAspect, t]);

  const handleExport = useCallback(async (settings: ExportSettings) => {
    if (!videoPath) {
      toast.error(t('editor.noVideoLoaded'));
      return;
    }

    const video = videoPlaybackRef.current?.video;
    if (!video) {
      toast.error(t('editor.videoNotReady'));
      return;
    }

    setIsExporting(true);
    setExportProgress(null);
    setExportError(null);
    setActiveBatchExport(null);
    exportCancelledRef.current = false;

    let shouldResumePlayback = false;
    const emittedWarningKeys = new Set<string>();
    const notifyExportWarnings = (warnings?: string[]) => {
      if (!warnings?.length) return;
      for (const warningKey of warnings) {
        if (!warningKey || emittedWarningKeys.has(warningKey)) continue;
        emittedWarningKeys.add(warningKey);
        toast.warning(t(warningKey));
      }
    };

    try {
      if (isPlaying) {
        videoPlaybackRef.current?.pause();
        shouldResumePlayback = true;
      }

      const sourceWidth = video.videoWidth || 1920;
      const sourceHeight = video.videoHeight || 1080;

      const playbackRef = videoPlaybackRef.current;
      const containerElement = playbackRef?.containerRef?.current;
      const previewWidth = containerElement?.clientWidth || 1920;
      const previewHeight = containerElement?.clientHeight || 1080;

      if (settings.format === 'gif' && settings.gifConfig) {
        const gifExporter = new GifExporter({
          videoUrl: videoPath,
          width: settings.gifConfig.width,
          height: settings.gifConfig.height,
          frameRate: settings.gifConfig.frameRate,
          loop: settings.gifConfig.loop,
          sizePreset: settings.gifConfig.sizePreset,
          wallpaper,
          zoomRegions,
          trimRegions,
          showShadow: shadowIntensity > 0,
          shadowIntensity,
          showBlur,
          motionBlurEnabled,
          borderRadius,
          padding,
          videoPadding: padding,
          cropRegion: activeCropRegion,
          annotationRegions,
          subtitleCues,
          previewWidth,
          previewHeight,
          cursorTrack,
          cursorStyle,
          onProgress: (progress: ExportProgress) => {
            setExportProgress(progress);
          },
        });

        exporterRef.current = gifExporter;
        const result = await gifExporter.export();
        const cancelled = exportCancelledRef.current
          || (typeof result.error === 'string' && result.error.toLowerCase().includes('cancel'));

        if (cancelled) {
          toast.info(t('editor.exportCancelled'));
        } else if (result.success && result.blob) {
          notifyExportWarnings(result.warnings);
          const arrayBuffer = await result.blob.arrayBuffer();
          const timestamp = Date.now();
          const fileName = `export-${timestamp}.gif`;

          const saveResult = await window.electronAPI.saveExportedVideo(arrayBuffer, fileName, locale);

          if (saveResult.cancelled) {
            toast.info(t('editor.exportCancelled'));
          } else if (saveResult.success) {
            toast.success(t('editor.gifExportSuccess', { path: saveResult.path ?? '' }));
          } else {
            setExportError(saveResult.message || t('editor.saveGifFailed'));
            toast.error(saveResult.message || t('editor.saveGifFailed'));
          }
        } else {
          setExportError(result.error || t('editor.gifExportFailed'));
          toast.error(result.error || t('editor.gifExportFailed'));
        }
      } else {
        const quality = settings.quality || exportQuality;
        const ratiosToExport = normalizedExportAspectRatios;
        if (ratiosToExport.length === 0) {
          toast.error(t('editor.exportAspectRatioRequired'));
          return;
        }

        let exportDirectoryPath: string | null = null;
        if (ratiosToExport.length > 1) {
          const pickDirectoryResult = await window.electronAPI.pickExportDirectory(locale);
          if (pickDirectoryResult.cancelled || !pickDirectoryResult.path) {
            toast.info(t('editor.exportCancelled'));
            return;
          }
          exportDirectoryPath = pickDirectoryResult.path;
        }

        const timestamp = Date.now();
        let completedCount = 0;
        let aborted = false;

        for (let index = 0; index < ratiosToExport.length; index += 1) {
          const currentRatio = ratiosToExport[index];
          setActiveBatchExport({
            current: index + 1,
            total: ratiosToExport.length,
            aspectRatio: currentRatio,
          });

          const exportPlan = calculateMp4ExportPlan({
            quality,
            aspectRatio: getAspectRatioValue(currentRatio),
            sourceWidth,
            sourceHeight,
            sourceFrameRate,
          });
          const {
            width: exportWidth,
            height: exportHeight,
            bitrate,
            frameRate: exportFrameRate,
            limitedBySource,
          } = exportPlan;

          if (limitedBySource && quality !== 'source') {
            toast.info(t('editor.exportResolutionLimited', { width: exportWidth, height: exportHeight }));
          }

          const zoomRegionsForRatio = getZoomRegionsForAspect(zoomRegionsByAspect, currentRatio);
          const exporter = new VideoExporter({
            videoUrl: videoPath,
            width: exportWidth,
            height: exportHeight,
            frameRate: exportFrameRate,
            bitrate,
            codec: 'avc1.640033',
            wallpaper,
            zoomRegions: zoomRegionsForRatio,
            trimRegions,
            showShadow: shadowIntensity > 0,
            shadowIntensity,
            showBlur,
            motionBlurEnabled,
            borderRadius,
            padding,
            cropRegion: resolveAspectCropRegion(cropRegionsByAspect, currentRatio, sourceAspectRatio),
            annotationRegions,
            subtitleCues,
            previewWidth,
            previewHeight,
            cursorTrack,
            cursorStyle,
            audioEditRegions,
            audioEnabled: sourceHasAudio && audioEnabled,
            audioGain,
            onProgress: (progress: ExportProgress) => {
              setExportProgress(progress);
            },
          });

          exporterRef.current = exporter;
          const result = await exporter.export();
          const cancelled = exportCancelledRef.current
            || (typeof result.error === 'string' && result.error.toLowerCase().includes('cancel'));

          if (cancelled) {
            toast.info(t('editor.exportCancelled'));
            aborted = true;
            break;
          }

          if (!(result.success && result.blob)) {
            setExportError(result.error || t('editor.exportFailed'));
            toast.error(result.error || t('editor.exportFailed'));
            aborted = true;
            break;
          }

          notifyExportWarnings(result.warnings);

          const arrayBuffer = await result.blob.arrayBuffer();
          const ratioSuffix = ratiosToExport.length > 1 ? `-${currentRatio.replace(':', 'x')}` : '';
          const fileName = `export-${timestamp}${ratioSuffix}.mp4`;

          const saveResult = await window.electronAPI.saveExportedVideo(
            arrayBuffer,
            fileName,
            locale,
            exportDirectoryPath ? { directoryPath: exportDirectoryPath } : undefined,
          );

          if (saveResult.cancelled) {
            toast.info(t('editor.exportCancelled'));
            aborted = true;
            break;
          } else if (saveResult.success) {
            completedCount += 1;
            if (ratiosToExport.length === 1) {
              toast.success(t('editor.videoExportSuccess', { path: saveResult.path ?? '' }));
            }
          } else {
            setExportError(saveResult.message || t('editor.saveVideoFailed'));
            toast.error(saveResult.message || t('editor.saveVideoFailed'));
            aborted = true;
            break;
          }
        }

        if (!aborted && completedCount > 1 && exportDirectoryPath) {
          toast.success(t('editor.batchVideoExportSuccess', { count: completedCount, path: exportDirectoryPath }));
        }
      }
    } catch (error) {
      console.error('Export error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setExportError(errorMessage);
      toast.error(t('editor.exportError', { message: errorMessage }));
    } finally {
      if (shouldResumePlayback) {
        videoPlaybackRef.current?.play();
      }
      setIsExporting(false);
      exporterRef.current = null;
      exportCancelledRef.current = false;
      setActiveBatchExport(null);
      setShowExportDialog(false);
      setExportProgress(null);
    }
  }, [videoPath, wallpaper, zoomRegions, zoomRegionsByAspect, trimRegions, shadowIntensity, showBlur, motionBlurEnabled, borderRadius, padding, activeCropRegion, cropRegionsByAspect, sourceAspectRatio, annotationRegions, subtitleCues, isPlaying, normalizedExportAspectRatios, exportQuality, locale, sourceFrameRate, sourceHasAudio, audioEnabled, audioGain, audioEditRegions, cursorTrack, cursorStyle, t]);

  const handleOpenExportDialog = useCallback(() => {
    if (!videoPath) {
      toast.error(t('editor.noVideoLoaded'));
      return;
    }

    const video = videoPlaybackRef.current?.video;
    if (!video) {
      toast.error(t('editor.videoNotReady'));
      return;
    }
    if (exportFormat === 'mp4' && normalizedExportAspectRatios.length === 0) {
      toast.error(t('editor.exportAspectRatioRequired'));
      return;
    }

    // Build export settings from current state
    const sourceWidth = video.videoWidth || 1920;
    const sourceHeight = video.videoHeight || 1080;
    const gifDimensions = calculateOutputDimensions(sourceWidth, sourceHeight, gifSizePreset, GIF_SIZE_PRESETS);

    const settings: ExportSettings = {
      format: exportFormat,
      quality: exportFormat === 'mp4' ? exportQuality : undefined,
      gifConfig: exportFormat === 'gif' ? {
        frameRate: gifFrameRate,
        loop: gifLoop,
        sizePreset: gifSizePreset,
        width: gifDimensions.width,
        height: gifDimensions.height,
      } : undefined,
    };

    setShowExportDialog(true);
    setExportError(null);

    // Start export immediately
    handleExport(settings);
  }, [videoPath, exportFormat, exportQuality, gifFrameRate, gifLoop, gifSizePreset, handleExport, normalizedExportAspectRatios.length, t]);

  const handleCancelExport = useCallback(() => {
    if (exporterRef.current) {
      exportCancelledRef.current = true;
      exporterRef.current.cancel();
      toast.info(t('editor.exportCancelled'));
      setShowExportDialog(false);
    }
  }, [t]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="text-foreground">{t("editor.loadingVideo")}</div>
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
    <div className="flex flex-col h-screen bg-[#09090b] text-slate-200 overflow-hidden selection:bg-[#34B27B]/30">
      <div 
        className="h-10 flex-shrink-0 bg-[#09090b]/80 backdrop-blur-md border-b border-white/5 flex items-center justify-between px-6 z-50"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <div className="flex-1" />
      </div>

      <div className="flex-1 p-5 gap-4 flex min-h-0 relative">
        {/* Left Column - Video & Timeline */}
        <div className="flex-[7] flex flex-col gap-3 min-w-0 h-full">
          <PanelGroup direction="vertical" className="gap-3">
            {/* Top section: video preview and controls */}
            <Panel defaultSize={70} minSize={40}>
              <div className="w-full h-full flex flex-col items-center justify-center bg-black/40 rounded-2xl border border-white/5 shadow-2xl overflow-hidden">
                {/* Video preview */}
                <div className="w-full flex justify-center items-center" style={{ flex: '1 1 auto', margin: '6px 0 0' }}>
                  <div className="relative" style={{ width: 'auto', height: '100%', aspectRatio: getAspectRatioValue(aspectRatio), maxWidth: '100%', margin: '0 auto', boxSizing: 'border-box' }}>
                    <VideoPlayback
                      aspectRatio={aspectRatio}
                      preferredFps={resolvePreviewFrameRate(sourceFrameRate)}
                      ref={videoPlaybackRef}
                      videoPath={videoPath || ''}
                      onDurationChange={setDuration}
                      onTimeUpdate={setCurrentTime}
                      currentTime={currentTime}
                      onPlayStateChange={setIsPlaying}
                      onError={setError}
                      wallpaper={wallpaper}
                      zoomRegions={zoomRegions}
                      selectedZoomId={selectedZoomId}
                      onSelectZoom={handleSelectZoom}
                      onZoomFocusChange={handleZoomFocusChange}
                      isPlaying={isPlaying}
                      showShadow={shadowIntensity > 0}
                      shadowIntensity={shadowIntensity}
                      showBlur={showBlur}
                      motionBlurEnabled={motionBlurEnabled}
                      borderRadius={borderRadius}
                      padding={padding}
                      cropRegion={DEFAULT_CROP_REGION}
                      trimRegions={trimRegions}
                      annotationRegions={annotationRegions}
                      selectedAnnotationId={selectedAnnotationId}
                      onSelectAnnotation={handleSelectAnnotation}
                      onAnnotationPositionChange={handleAnnotationPositionChange}
                      onAnnotationSizeChange={handleAnnotationSizeChange}
                      subtitleCues={subtitleCues}
                      cursorTrack={cursorTrack}
                      cursorStyle={cursorStyle}
                      hasAudioTrack={sourceHasAudio}
                      audioEnabled={audioEnabled}
                      audioGain={audioGain}
                      audioEditRegions={audioEditRegions}
                      onVideoDimensionsChange={setSourceVideoDimensions}
                    />
                    {showAspectCropOverlay ? (
                      <PreviewAspectCropOverlay
                        cropRegion={activeCropRegion}
                        onCropChange={handleActiveCropRegionChange}
                        sourceAspectRatio={sourceAspectRatio}
                        targetAspectRatio={getAspectRatioValue(aspectRatio)}
                        positionHint={t("editor.cropOverlayDragHint")}
                      />
                    ) : null}
                  </div>
                </div>
                {/* Playback controls */}
                <div className="w-full flex justify-center items-center" style={{ height: '48px', flexShrink: 0, padding: '6px 12px', margin: '6px 0 6px 0' }}>
                  <div style={{ width: '100%', maxWidth: '700px' }}>
                    <PlaybackControls
                      isPlaying={isPlaying}
                      currentTime={currentTime}
                      duration={duration}
                      onTogglePlayPause={togglePlayPause}
                      onSeek={handleSeek}
                    />
                  </div>
                </div>
              </div>
            </Panel>

            <PanelResizeHandle className="h-3 bg-[#09090b]/80 hover:bg-[#09090b] transition-colors rounded-full mx-4 flex items-center justify-center">
              <div className="w-8 h-1 bg-white/20 rounded-full"></div>
            </PanelResizeHandle>

            {/* Timeline section */}
            <Panel defaultSize={30} minSize={20}>
              <div className="h-full bg-[#09090b] rounded-2xl border border-white/5 shadow-lg overflow-hidden flex flex-col">
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
              trimRegions={trimRegions}
              onTrimAdded={handleTrimAdded}
              onTrimSpanChange={handleTrimSpanChange}
              onTrimDelete={handleTrimDelete}
              selectedTrimId={selectedTrimId}
              onSelectTrim={handleSelectTrim}
              annotationRegions={annotationRegions}
              onAnnotationAdded={handleAnnotationAdded}
              onAnnotationSpanChange={handleAnnotationSpanChange}
              onAnnotationDelete={handleAnnotationDelete}
              selectedAnnotationId={selectedAnnotationId}
              onSelectAnnotation={handleSelectAnnotation}
              subtitleCues={subtitleCues}
              aspectRatio={aspectRatio}
              onAspectRatioChange={setAspectRatio}
              hasAudioTrack={sourceHasAudio}
              audioEnabled={audioEnabled}
              audioGain={audioGain}
              audioEditRegions={audioEditRegions}
            />
              </div>
            </Panel>
          </PanelGroup>
        </div>

          {/* Right section: settings panel */}
          <SettingsPanel
          selected={wallpaper}
          onWallpaperChange={setWallpaper}
          selectedZoomDepth={selectedZoomId ? zoomRegions.find(z => z.id === selectedZoomId)?.depth : null}
          onZoomDepthChange={(depth) => selectedZoomId && handleZoomDepthChange(depth)}
          selectedZoomId={selectedZoomId}
          onZoomDelete={handleZoomDelete}
          selectedTrimId={selectedTrimId}
          onTrimDelete={handleTrimDelete}
          shadowIntensity={shadowIntensity}
          onShadowChange={setShadowIntensity}
          showBlur={showBlur}
          onBlurChange={setShowBlur}
          motionBlurEnabled={motionBlurEnabled}
          onMotionBlurChange={setMotionBlurEnabled}
          borderRadius={borderRadius}
          onBorderRadiusChange={setBorderRadius}
          padding={padding}
          onPaddingChange={setPadding}
          cropRegion={activeCropRegion}
          onCropChange={handleActiveCropRegionChange}
          aspectRatio={aspectRatio}
          videoElement={videoPlaybackRef.current?.video || null}
          exportQuality={exportQuality}
          onExportQualityChange={setExportQuality}
          exportFormat={exportFormat}
          onExportFormatChange={setExportFormat}
          exportAspectRatios={exportAspectRatios}
          onExportAspectRatiosChange={setExportAspectRatios}
          onPreviewAspectRatioChange={setAspectRatio}
          gifFrameRate={gifFrameRate}
          onGifFrameRateChange={setGifFrameRate}
          gifLoop={gifLoop}
          onGifLoopChange={setGifLoop}
          gifSizePreset={gifSizePreset}
          onGifSizePresetChange={setGifSizePreset}
          gifOutputDimensions={calculateOutputDimensions(
            videoPlaybackRef.current?.video?.videoWidth || 1920,
            videoPlaybackRef.current?.video?.videoHeight || 1080,
            gifSizePreset,
            GIF_SIZE_PRESETS
          )}
          onExport={handleOpenExportDialog}
          selectedAnnotationId={selectedAnnotationId}
          annotationRegions={annotationRegions}
          onAnnotationContentChange={handleAnnotationContentChange}
          onAnnotationTypeChange={handleAnnotationTypeChange}
          onAnnotationStyleChange={handleAnnotationStyleChange}
          onAnnotationFigureDataChange={handleAnnotationFigureDataChange}
          onAnnotationDelete={handleAnnotationDelete}
          hasAudioTrack={sourceHasAudio}
          audioEnabled={audioEnabled}
          onAudioEnabledChange={setAudioEnabled}
          audioGain={audioGain}
          onAudioGainChange={setAudioGain}
          cursorStyle={cursorStyle}
          onCursorStyleChange={setCursorStyle}
          onAutoEdit={handleAutoEdit}
          autoEditDisabled={!cursorTrack?.samples?.length || !Number.isFinite(duration) || duration <= 0}
          onGenerateSubtitles={handleGenerateSubtitles}
          onApplyRoughCut={handleApplyRoughCut}
          analysisRunning={analysisInProgress}
          subtitleCueCount={subtitleCues.length}
          roughCutSuggestionCount={roughCutSuggestions.length}
        />
      </div>
      <ExportDialog
        isOpen={showExportDialog}
        onClose={() => setShowExportDialog(false)}
        progress={exportProgress}
        isExporting={isExporting}
        error={exportError}
        onCancel={handleCancelExport}
        exportFormat={exportFormat}
        batchProgress={activeBatchExport}
      />
    </div>
  );
}
