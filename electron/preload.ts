import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
    hudOverlayHide: () => {
      ipcRenderer.send('hud-overlay-hide');
    },
    hudOverlayClose: () => {
      ipcRenderer.send('hud-overlay-close');
    },
  getAssetBasePath: async () => {
    // ask main process for the correct base path (production vs dev)
    return await ipcRenderer.invoke('get-asset-base-path')
  },
  getSources: async (opts: Electron.SourcesOptions) => {
    return await ipcRenderer.invoke('get-sources', opts)
  },
  switchToEditor: () => {
    return ipcRenderer.invoke('switch-to-editor')
  },
  openSourceSelector: () => {
    return ipcRenderer.invoke('open-source-selector')
  },
  selectSource: (source: any) => {
    return ipcRenderer.invoke('select-source', source)
  },
  getSelectedSource: () => {
    return ipcRenderer.invoke('get-selected-source')
  },

  storeRecordedVideo: (
    videoData: ArrayBuffer,
    fileName: string,
    metadata?: {
      frameRate?: number;
      width?: number;
      height?: number;
      mimeType?: string;
      capturedAt?: number;
      systemCursorMode?: 'always' | 'never';
      cursorTrack?: {
        source?: 'recorded' | 'synthetic';
        samples: Array<{ timeMs: number; x: number; y: number; click?: boolean; visible?: boolean; cursorKind?: 'arrow' | 'ibeam' }>;
      };
    },
  ) => {
    return ipcRenderer.invoke('store-recorded-video', videoData, fileName, metadata)
  },

  getRecordedVideoPath: () => {
    return ipcRenderer.invoke('get-recorded-video-path')
  },
  setRecordingState: (recording: boolean) => {
    return ipcRenderer.invoke('set-recording-state', recording)
  },
  startNativeScreenRecording: (options?: {
    source?: { id?: string; display_id?: string | number | null }
    cursorMode?: 'always' | 'never'
    cameraEnabled?: boolean
    cameraShape?: 'rounded' | 'square' | 'circle'
    cameraSizePercent?: number
    frameRate?: number
    width?: number
    height?: number
  }) => {
    return ipcRenderer.invoke('native-screen-recorder-start', options)
  },
  stopNativeScreenRecording: () => {
    return ipcRenderer.invoke('native-screen-recorder-stop')
  },
  startCursorTracking: (options?: {
    source?: { id?: string; display_id?: string | number | null }
    captureSize?: { width?: number; height?: number }
  }) => {
    return ipcRenderer.invoke('cursor-tracker-start', options)
  },
  stopCursorTracking: () => {
    return ipcRenderer.invoke('cursor-tracker-stop')
  },
  onStopRecordingFromTray: (callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on('stop-recording-from-tray', listener)
    return () => ipcRenderer.removeListener('stop-recording-from-tray', listener)
  },
  openExternalUrl: (url: string) => {
    return ipcRenderer.invoke('open-external-url', url)
  },
  saveExportedVideo: (videoData: ArrayBuffer, fileName: string, locale?: string) => {
    return ipcRenderer.invoke('save-exported-video', videoData, fileName, locale)
  },
  openVideoFilePicker: (locale?: string) => {
    return ipcRenderer.invoke('open-video-file-picker', locale)
  },
  setCurrentVideoPath: (path: string, metadata?: {
    frameRate?: number;
    width?: number;
    height?: number;
    mimeType?: string;
    capturedAt?: number;
    systemCursorMode?: 'always' | 'never';
    cursorTrack?: {
      source?: 'recorded' | 'synthetic';
      samples: Array<{ timeMs: number; x: number; y: number; click?: boolean; visible?: boolean; cursorKind?: 'arrow' | 'ibeam' }>;
    };
  }) => {
    return ipcRenderer.invoke('set-current-video-path', path, metadata)
  },
  getCurrentVideoPath: () => {
    return ipcRenderer.invoke('get-current-video-path')
  },
  clearCurrentVideoPath: () => {
    return ipcRenderer.invoke('clear-current-video-path')
  },
  getPlatform: () => {
    return ipcRenderer.invoke('get-platform')
  },
})
