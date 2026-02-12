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
  samples: Array<{ timeMs: number; x: number; y: number; click?: boolean; visible?: boolean }>;
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
      metadata?: { frameRate?: number; width?: number; height?: number; mimeType?: string; capturedAt?: number; cursorTrack?: CursorTrackMetadata }
    ) => Promise<{
      success: boolean
      path?: string
      message: string
      error?: string
      metadata?: { frameRate?: number; width?: number; height?: number; mimeType?: string; capturedAt?: number; cursorTrack?: CursorTrackMetadata }
    }>
    getRecordedVideoPath: () => Promise<{
      success: boolean
      path?: string
      message?: string
      error?: string
    }>
    getAssetBasePath: () => Promise<string | null>
    setRecordingState: (recording: boolean) => Promise<void>
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
      metadata?: { frameRate?: number; width?: number; height?: number; mimeType?: string; capturedAt?: number; cursorTrack?: CursorTrackMetadata }
    ) => Promise<{ success: boolean }>
    getCurrentVideoPath: () => Promise<{
      success: boolean
      path?: string
      metadata?: { frameRate?: number; width?: number; height?: number; mimeType?: string; capturedAt?: number; cursorTrack?: CursorTrackMetadata }
    }>
    clearCurrentVideoPath: () => Promise<{ success: boolean }>
    getPlatform: () => Promise<string>
    hudOverlayHide: () => void
    hudOverlayClose: () => void
  }
}
