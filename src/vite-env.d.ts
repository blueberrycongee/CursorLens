/// <reference types="vite/client" />
/// <reference types="../electron/electron-env" />

interface ProcessedDesktopSource {
  id: string;
  name: string;
  display_id: string;
  thumbnail: string | null;
  appIcon: string | null;
}

type CursorTrackMetadata = {
  source?: 'recorded' | 'synthetic';
  samples: Array<{ timeMs: number; x: number; y: number; click?: boolean; visible?: boolean; cursorKind?: 'arrow' | 'ibeam' }>;
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

interface Window {
  electronAPI: {
    getSources: (opts: Electron.SourcesOptions) => Promise<ProcessedDesktopSource[]>
    switchToEditor: () => Promise<void>
    openSourceSelector: () => Promise<void>
    selectSource: (source: any) => Promise<any>
    getSelectedSource: () => Promise<any>
    storeRecordedVideo: (
      videoData: ArrayBuffer,
      fileName: string,
      metadata?: { frameRate?: number; width?: number; height?: number; mimeType?: string; capturedAt?: number; systemCursorMode?: 'always' | 'never'; cursorTrack?: CursorTrackMetadata }
    ) => Promise<{
      success: boolean
      path?: string
      message: string
      error?: string
      metadata?: { frameRate?: number; width?: number; height?: number; mimeType?: string; capturedAt?: number; systemCursorMode?: 'always' | 'never'; cursorTrack?: CursorTrackMetadata }
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
      cameraEnabled?: boolean
      cameraShape?: 'rounded' | 'square' | 'circle'
      cameraSizePercent?: number
      frameRate?: number
      width?: number
      height?: number
    }) => Promise<{
      success: boolean
      message?: string
      width?: number
      height?: number
      frameRate?: number
      sourceKind?: 'display' | 'window' | 'unknown'
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
      }
    }>
    startCursorTracking: (options?: {
      source?: { id?: string; display_id?: string | number | null }
      captureSize?: { width?: number; height?: number }
    }) => Promise<{ success: boolean }>
    stopCursorTracking: () => Promise<{ success: boolean; track?: CursorTrackMetadata }>
    onStopRecordingFromTray: (callback: () => void) => () => void
    openExternalUrl: (url: string) => Promise<{ success: boolean; error?: string }>
    saveExportedVideo: (videoData: ArrayBuffer, fileName: string, locale?: string) => Promise<{
      success: boolean
      path?: string
      message?: string
      cancelled?: boolean
    }>
    openVideoFilePicker: (locale?: string) => Promise<{ success: boolean; path?: string; cancelled?: boolean }>
    setCurrentVideoPath: (
      path: string,
      metadata?: { frameRate?: number; width?: number; height?: number; mimeType?: string; capturedAt?: number; systemCursorMode?: 'always' | 'never'; cursorTrack?: CursorTrackMetadata }
    ) => Promise<{ success: boolean }>
    getCurrentVideoPath: () => Promise<{
      success: boolean
      path?: string
      metadata?: { frameRate?: number; width?: number; height?: number; mimeType?: string; capturedAt?: number; systemCursorMode?: 'always' | 'never'; cursorTrack?: CursorTrackMetadata }
    }>
    clearCurrentVideoPath: () => Promise<{ success: boolean }>
    getPlatform: () => Promise<string>
    hudOverlayHide: () => void
    hudOverlayClose: () => void
  }
}
