/// <reference types="vite-plugin-electron/electron-env" />

declare namespace NodeJS {
  interface ProcessEnv {
    /**
     * The built directory structure
     *
     * ```tree
     * ├─┬─┬ dist
     * │ │ └── index.html
     * │ │
     * │ ├─┬ dist-electron
     * │ │ ├── main.js
     * │ │ └── preload.js
     * │
     * ```
     */
    APP_ROOT: string
    /** /dist/ or /public/ */
    VITE_PUBLIC: string
  }
}

type CursorTrackMetadata = {
  source?: 'recorded' | 'synthetic'
  samples: Array<{ timeMs: number; x: number; y: number; click?: boolean; visible?: boolean; cursorKind?: 'arrow' | 'ibeam' }>
  space?: {
    mode?: 'source-display' | 'virtual-desktop'
    displayId?: string
    bounds?: { x: number; y: number; width: number; height: number }
  }
  stats?: {
    sampleCount?: number
    clickCount?: number
  }
  capture?: {
    sourceId?: string
    width?: number
    height?: number
  }
}

type SubtitleCueMetadata = {
  id: string
  startMs: number
  endMs: number
  text: string
  source: 'asr' | 'manual' | 'agent'
  confidence?: number
}

type TranscriptWordMetadata = {
  text: string
  startMs: number
  endMs: number
  confidence?: number
}

type RoughCutSuggestionMetadata = {
  id: string
  startMs: number
  endMs: number
  reason: 'silence' | 'filler'
  confidence: number
  label: string
}

type VideoAnalysisMetadata = {
  transcript: {
    locale: string
    text: string
    createdAtMs: number
    words: TranscriptWordMetadata[]
  }
  subtitleCues: SubtitleCueMetadata[]
  roughCutSuggestions: RoughCutSuggestionMetadata[]
}

type CapturePermissionStatus =
  | 'granted'
  | 'denied'
  | 'restricted'
  | 'not-determined'
  | 'unknown'
  | 'manual-check'

type CapturePermissionKey =
  | 'screen'
  | 'camera'
  | 'microphone'
  | 'accessibility'
  | 'input-monitoring'

type PermissionSettingsTarget =
  | 'screen-capture'
  | 'camera'
  | 'microphone'
  | 'accessibility'
  | 'input-monitoring'

type CapturePermissionSnapshot = {
  platform: string
  checkedAtMs: number
  canOpenSystemSettings: boolean
  items: Array<{
    key: CapturePermissionKey
    status: CapturePermissionStatus
    requiredForRecording: boolean
    canOpenSettings: boolean
    settingsTarget?: PermissionSettingsTarget
  }>
}

// Used in Renderer process, expose in `preload.ts`
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
    selectSource: (source: any) => Promise<any>
    getSelectedSource: () => Promise<any>
    storeRecordedVideo: (
      videoData: ArrayBuffer,
      fileName: string,
      metadata?: { frameRate?: number; width?: number; height?: number; mimeType?: string; capturedAt?: number; systemCursorMode?: 'always' | 'never'; hasMicrophoneAudio?: boolean; cursorTrack?: CursorTrackMetadata }
    ) => Promise<{
      success: boolean
      path?: string
      message?: string
      metadata?: { frameRate?: number; width?: number; height?: number; mimeType?: string; capturedAt?: number; systemCursorMode?: 'always' | 'never'; hasMicrophoneAudio?: boolean; cursorTrack?: CursorTrackMetadata }
    }>
    getRecordedVideoPath: () => Promise<{ success: boolean; path?: string; message?: string }>
    setRecordingState: (recording: boolean) => Promise<void>
    startNativeScreenRecording: (options?: {
      source?: { id?: string; display_id?: string | number | null }
      cursorMode?: 'always' | 'never'
      microphoneEnabled?: boolean
      cameraEnabled?: boolean
      cameraShape?: 'rounded' | 'square' | 'circle'
      cameraSizePercent?: number
      frameRate?: number
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
    pickExportDirectory: (locale?: string) => Promise<{ success: boolean; path?: string; message?: string; cancelled?: boolean }>
    saveExportedVideo: (
      videoData: ArrayBuffer,
      fileName: string,
      locale?: string,
      options?: { directoryPath?: string | null }
    ) => Promise<{ success: boolean; path?: string; message?: string; cancelled?: boolean }>
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
    hudOverlayHide: () => void;
    hudOverlayClose: () => void;
  }
}

interface ProcessedDesktopSource {
  id: string
  name: string
  display_id: string
  thumbnail: string | null
  appIcon: string | null
}
