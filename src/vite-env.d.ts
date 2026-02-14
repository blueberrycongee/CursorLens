/// <reference types="vite/client" />
/// <reference types="../electron/electron-env" />

interface ProcessedDesktopSource {
  id: string;
  name: string;
  display_id: string;
  width?: number;
  height?: number;
  thumbnail: string | null;
  appIcon: string | null;
}

type CapturePermissionStatus =
  | 'granted'
  | 'denied'
  | 'restricted'
  | 'not-determined'
  | 'unknown'
  | 'manual-check';

type CapturePermissionKey =
  | 'screen'
  | 'camera'
  | 'microphone'
  | 'accessibility'
  | 'input-monitoring';

type PermissionSettingsTarget =
  | 'screen-capture'
  | 'camera'
  | 'microphone'
  | 'accessibility'
  | 'input-monitoring';

type CapturePermissionSnapshot = {
  platform: string;
  checkedAtMs: number;
  canOpenSystemSettings: boolean;
  items: Array<{
    key: CapturePermissionKey;
    status: CapturePermissionStatus;
    requiredForRecording: boolean;
    canOpenSettings: boolean;
    settingsTarget?: PermissionSettingsTarget;
  }>;
};

type CursorTrackMetadata = {
  source?: 'recorded' | 'synthetic';
  samples: Array<{ timeMs: number; x: number; y: number; click?: boolean; visible?: boolean; cursorKind?: 'arrow' | 'ibeam' }>;
  events?: Array<{
    type: 'click' | 'selection';
    startMs: number;
    endMs: number;
    point: { x: number; y: number };
    startPoint?: { x: number; y: number };
    endPoint?: { x: number; y: number };
    bounds?: {
      minX: number;
      minY: number;
      maxX: number;
      maxY: number;
      width: number;
      height: number;
    };
  }>;
  space?: {
    mode?: 'source-display' | 'virtual-desktop';
    displayId?: string;
    bounds?: { x: number; y: number; width: number; height: number };
  };
  stats?: {
    sampleCount?: number;
    clickCount?: number;
  };
  capture?: {
    sourceId?: string;
    width?: number;
    height?: number;
  };
};

type SubtitleCueMetadata = {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
  source: 'asr' | 'manual' | 'agent';
  confidence?: number;
};

type TranscriptWordMetadata = {
  text: string;
  startMs: number;
  endMs: number;
  confidence?: number;
};

type RoughCutSuggestionMetadata = {
  id: string;
  startMs: number;
  endMs: number;
  reason: 'silence' | 'filler';
  confidence: number;
  label: string;
};

type VideoAnalysisMetadata = {
  transcript: {
    locale: string;
    text: string;
    createdAtMs: number;
    words: TranscriptWordMetadata[];
  };
  subtitleCues: SubtitleCueMetadata[];
  roughCutSuggestions: RoughCutSuggestionMetadata[];
};

interface Window {
  electronAPI: {
    getSources: (opts: Electron.SourcesOptions) => Promise<ProcessedDesktopSource[]>
    getScreenCaptureAccessStatus: () => Promise<{
      status: 'granted' | 'denied' | 'restricted' | 'not-determined' | 'unknown'
      canOpenSystemSettings: boolean
    }>
    getCapturePermissionSnapshot: () => Promise<CapturePermissionSnapshot>
    openScreenCaptureSettings: () => Promise<{ success: boolean; message?: string }>
    openPermissionSettings: (target: PermissionSettingsTarget) => Promise<{ success: boolean; message?: string }>
    openPermissionChecker: () => Promise<{ success: boolean }>
    switchToEditor: () => Promise<void>
    openSourceSelector: () => Promise<void>
    selectSource: (source: unknown) => Promise<unknown>
    getSelectedSource: () => Promise<unknown>
    storeRecordedVideo: (
      videoData: ArrayBuffer,
      fileName: string,
      metadata?: { frameRate?: number; width?: number; height?: number; mimeType?: string; capturedAt?: number; systemCursorMode?: 'always' | 'never'; hasMicrophoneAudio?: boolean; cursorTrack?: CursorTrackMetadata }
    ) => Promise<{
      success: boolean
      path?: string
      message: string
      error?: string
      metadata?: { frameRate?: number; width?: number; height?: number; mimeType?: string; capturedAt?: number; systemCursorMode?: 'always' | 'never'; hasMicrophoneAudio?: boolean; cursorTrack?: CursorTrackMetadata }
    }>
    getRecordedVideoPath: () => Promise<{
      success: boolean
      path?: string
      message?: string
      error?: string
    }>
    getAssetBasePath: () => Promise<string | null>
    setRecordingState: (recording: boolean) => Promise<void>
    startNativeScreenRecording: (options?: {
      source?: { id?: string; display_id?: string | number | null }
      cursorMode?: 'always' | 'never'
      microphoneEnabled?: boolean
      cameraEnabled?: boolean
      cameraShape?: 'rounded' | 'square' | 'circle'
      cameraSizePercent?: number
      frameRate?: number
      maxLongEdge?: number
      bitrateScale?: number
      width?: number
      height?: number
    }) => Promise<{
      success: boolean
      code?: string
      message?: string
      width?: number
      height?: number
      frameRate?: number
      sourceKind?: 'display' | 'window' | 'unknown'
      hasMicrophoneAudio?: boolean
    }>
    stopNativeScreenRecording: () => Promise<{
      success: boolean
      path?: string
      message?: string
      metadata?: {
        frameRate?: number
        width?: number
        height?: number
        mimeType?: string
        capturedAt?: number
        systemCursorMode?: 'always' | 'never'
        hasMicrophoneAudio?: boolean
      }
    }>
    startCursorTracking: (options?: {
      source?: { id?: string; display_id?: string | number | null }
      captureSize?: { width?: number; height?: number }
    }) => Promise<{ success: boolean; warningCode?: string; warningMessage?: string }>
    stopCursorTracking: () => Promise<{ success: boolean; track?: CursorTrackMetadata }>
    onStopRecordingFromTray: (callback: () => void) => () => void
    setStopRecordingShortcut: (accelerator: string) => Promise<{ success: boolean; accelerator: string; message?: string }>
    getStopRecordingShortcut: () => Promise<{ success: boolean; accelerator: string; message?: string }>
    openExternalUrl: (url: string) => Promise<{ success: boolean; error?: string }>
    pickExportDirectory: (locale?: string) => Promise<{
      success: boolean
      path?: string
      message?: string
      cancelled?: boolean
    }>
    saveExportedVideo: (
      videoData: ArrayBuffer,
      fileName: string,
      locale?: string,
      options?: { directoryPath?: string | null }
    ) => Promise<{
      success: boolean
      path?: string
      message?: string
      cancelled?: boolean
    }>
    openVideoFilePicker: (locale?: string) => Promise<{ success: boolean; path?: string; cancelled?: boolean }>
    setCurrentVideoPath: (
      path: string,
      metadata?: { frameRate?: number; width?: number; height?: number; mimeType?: string; capturedAt?: number; systemCursorMode?: 'always' | 'never'; hasMicrophoneAudio?: boolean; cursorTrack?: CursorTrackMetadata }
    ) => Promise<{ success: boolean }>
    getCurrentVideoPath: () => Promise<{
      success: boolean
      path?: string
      metadata?: { frameRate?: number; width?: number; height?: number; mimeType?: string; capturedAt?: number; systemCursorMode?: 'always' | 'never'; hasMicrophoneAudio?: boolean; cursorTrack?: CursorTrackMetadata }
    }>
    clearCurrentVideoPath: () => Promise<{ success: boolean }>
    getPlatform: () => Promise<string>
    startVideoAnalysis: (options?: {
      videoPath?: string
      locale?: string
      durationMs?: number
      videoWidth?: number
      subtitleWidthRatio?: number
    }) => Promise<{ success: boolean; jobId?: string; message?: string }>
    getVideoAnalysisStatus: (jobId: string) => Promise<{
      success: boolean
      message?: string
      status?: {
        id: string
        status: 'pending' | 'running' | 'completed' | 'failed'
        createdAt: number
        startedAt?: number
        finishedAt?: number
        error?: string
      }
    }>
    getVideoAnalysisResult: (jobId: string) => Promise<{
      success: boolean
      message?: string
      status?: {
        id: string
        status: 'pending' | 'running' | 'completed' | 'failed'
        createdAt: number
        startedAt?: number
        finishedAt?: number
        error?: string
      }
      result?: VideoAnalysisMetadata
    }>
    getCurrentVideoAnalysis: (videoPath?: string) => Promise<{
      success: boolean
      message?: string
      analysis?: VideoAnalysisMetadata
    }>
    hudOverlayHide: () => void
    hudOverlayClose: () => void
  }
}
