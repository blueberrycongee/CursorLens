import { ipcMain, desktopCapturer, BrowserWindow, shell, app, dialog } from 'electron'

import fs from 'node:fs/promises'
import path from 'node:path'
import { RECORDINGS_DIR } from '../main'

let selectedSource: any = null

type Locale = 'en' | 'zh-CN'
type CurrentVideoMetadata = {
  frameRate?: number
  width?: number
  height?: number
  mimeType?: string
  capturedAt?: number
  cursorTrack?: {
    source?: 'recorded' | 'synthetic'
    samples: Array<{
      timeMs: number
      x: number
      y: number
      click?: boolean
      visible?: boolean
    }>
  }
}

function sanitizeCursorTrack(input?: CurrentVideoMetadata['cursorTrack'] | null): CurrentVideoMetadata['cursorTrack'] | undefined {
  if (!input || !Array.isArray(input.samples) || input.samples.length === 0) return undefined

  const samples = input.samples
    .slice(0, 6_000)
    .map((sample) => {
      const timeMs = Number(sample.timeMs)
      const x = Number(sample.x)
      const y = Number(sample.y)
      if (!Number.isFinite(timeMs) || !Number.isFinite(x) || !Number.isFinite(y)) return null
      return {
        timeMs: Math.max(0, Math.round(timeMs)),
        x: Math.min(1, Math.max(0, x)),
        y: Math.min(1, Math.max(0, y)),
        click: Boolean(sample.click),
        visible: sample.visible === false ? false : true,
      }
    })
    .filter((sample): sample is NonNullable<typeof sample> => Boolean(sample))
    .sort((a, b) => a.timeMs - b.timeMs)

  if (samples.length === 0) return undefined
  return {
    source: input.source === 'synthetic' ? 'synthetic' : 'recorded',
    samples,
  }
}

function normalizeLocale(input?: string): Locale {
  return (input ?? '').toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'
}

function tt(locale: Locale, key: string): string {
  const zh: Record<string, string> = {
    saveGif: '保存导出 GIF',
    saveVideo: '保存导出视频',
    exportCancelled: '导出已取消',
    exportSaved: '视频导出成功',
    exportSaveFailed: '保存导出视频失败',
    selectVideoFile: '选择视频文件',
    videoFiles: '视频文件',
    allFiles: '所有文件',
    filePickerFailed: '打开文件选择器失败',
  }
  const en: Record<string, string> = {
    saveGif: 'Save Exported GIF',
    saveVideo: 'Save Exported Video',
    exportCancelled: 'Export cancelled',
    exportSaved: 'Video exported successfully',
    exportSaveFailed: 'Failed to save exported video',
    selectVideoFile: 'Select Video File',
    videoFiles: 'Video Files',
    allFiles: 'All Files',
    filePickerFailed: 'Failed to open file picker',
  }
  return (locale === 'zh-CN' ? zh : en)[key] ?? key
}

function sanitizeVideoMetadata(metadata?: CurrentVideoMetadata | null): CurrentVideoMetadata | null {
  if (!metadata) return null

  const frameRate = Number(metadata.frameRate)
  const width = Number(metadata.width)
  const height = Number(metadata.height)
  const capturedAt = Number(metadata.capturedAt)

  const normalized: CurrentVideoMetadata = {}
  if (Number.isFinite(frameRate) && frameRate >= 1 && frameRate <= 240) {
    normalized.frameRate = Math.round(frameRate)
  }
  if (Number.isFinite(width) && width >= 2) {
    normalized.width = Math.floor(width)
  }
  if (Number.isFinite(height) && height >= 2) {
    normalized.height = Math.floor(height)
  }
  if (typeof metadata.mimeType === 'string' && metadata.mimeType.trim().length > 0) {
    normalized.mimeType = metadata.mimeType.trim()
  }
  if (Number.isFinite(capturedAt) && capturedAt > 0) {
    normalized.capturedAt = Math.floor(capturedAt)
  }

  const cursorTrack = sanitizeCursorTrack(metadata.cursorTrack)
  if (cursorTrack) {
    normalized.cursorTrack = cursorTrack
  }

  return Object.keys(normalized).length > 0 ? normalized : null
}

export function registerIpcHandlers(
  createEditorWindow: () => void,
  createSourceSelectorWindow: () => BrowserWindow,
  getMainWindow: () => BrowserWindow | null,
  getSourceSelectorWindow: () => BrowserWindow | null,
  onRecordingStateChange?: (recording: boolean, sourceName: string) => void
) {
  let currentVideoPath: string | null = null
  let currentVideoMetadata: CurrentVideoMetadata | null = null

  ipcMain.handle('get-sources', async (_, opts) => {
    const sources = await desktopCapturer.getSources(opts)
    return sources.map(source => ({
      id: source.id,
      name: source.name,
      display_id: source.display_id,
      thumbnail: source.thumbnail ? source.thumbnail.toDataURL() : null,
      appIcon: source.appIcon ? source.appIcon.toDataURL() : null
    }))
  })

  ipcMain.handle('select-source', (_, source) => {
    selectedSource = source
    const sourceSelectorWin = getSourceSelectorWindow()
    if (sourceSelectorWin) {
      sourceSelectorWin.close()
    }
    return selectedSource
  })

  ipcMain.handle('get-selected-source', () => {
    return selectedSource
  })

  ipcMain.handle('open-source-selector', () => {
    const sourceSelectorWin = getSourceSelectorWindow()
    if (sourceSelectorWin) {
      sourceSelectorWin.focus()
      return
    }
    createSourceSelectorWindow()
  })

  ipcMain.handle('switch-to-editor', () => {
    const mainWin = getMainWindow()
    if (mainWin) {
      mainWin.close()
    }
    createEditorWindow()
  })



  ipcMain.handle('store-recorded-video', async (_, videoData: ArrayBuffer, fileName: string, metadata?: CurrentVideoMetadata) => {
    try {
      const videoPath = path.join(RECORDINGS_DIR, fileName)
      await fs.writeFile(videoPath, Buffer.from(videoData))
      currentVideoPath = videoPath
      currentVideoMetadata = sanitizeVideoMetadata(metadata)
      return {
        success: true,
        path: videoPath,
        metadata: currentVideoMetadata ?? undefined,
        message: 'Video stored successfully'
      }
    } catch (error) {
      console.error('Failed to store video:', error)
      return {
        success: false,
        message: 'Failed to store video',
        error: String(error)
      }
    }
  })



  ipcMain.handle('get-recorded-video-path', async () => {
    try {
      const files = await fs.readdir(RECORDINGS_DIR)
      const videoFiles = files.filter(file => file.endsWith('.webm'))
      
      if (videoFiles.length === 0) {
        return { success: false, message: 'No recorded video found' }
      }
      
      const latestVideo = videoFiles.sort().reverse()[0]
      const videoPath = path.join(RECORDINGS_DIR, latestVideo)
      
      return { success: true, path: videoPath }
    } catch (error) {
      console.error('Failed to get video path:', error)
      return { success: false, message: 'Failed to get video path', error: String(error) }
    }
  })

  ipcMain.handle('set-recording-state', (_, recording: boolean) => {
    const source = selectedSource || { name: 'Screen' }
    if (onRecordingStateChange) {
      onRecordingStateChange(recording, source.name)
    }
  })


  ipcMain.handle('open-external-url', async (_, url: string) => {
    try {
      await shell.openExternal(url)
      return { success: true }
    } catch (error) {
      console.error('Failed to open URL:', error)
      return { success: false, error: String(error) }
    }
  })

  // Return base path for assets so renderer can resolve file:// paths in production
  ipcMain.handle('get-asset-base-path', () => {
    try {
      if (app.isPackaged) {
        return path.join(process.resourcesPath, 'assets')
      }
      return path.join(app.getAppPath(), 'public', 'assets')
    } catch (err) {
      console.error('Failed to resolve asset base path:', err)
      return null
    }
  })

  ipcMain.handle('save-exported-video', async (_, videoData: ArrayBuffer, fileName: string, localeInput?: string) => {
    try {
      const locale = normalizeLocale(localeInput)
      // Determine file type from extension
      const isGif = fileName.toLowerCase().endsWith('.gif');
      const filters = isGif 
        ? [{ name: 'GIF', extensions: ['gif'] }]
        : [{ name: 'MP4', extensions: ['mp4'] }];

      const result = await dialog.showSaveDialog({
        title: isGif ? tt(locale, 'saveGif') : tt(locale, 'saveVideo'),
        defaultPath: path.join(app.getPath('downloads'), fileName),
        filters,
        properties: ['createDirectory', 'showOverwriteConfirmation']
      });

      if (result.canceled || !result.filePath) {
        return {
          success: false,
          cancelled: true,
          message: tt(locale, 'exportCancelled')
        };
      }

      await fs.writeFile(result.filePath, Buffer.from(videoData));

      return {
        success: true,
        path: result.filePath,
        message: tt(locale, 'exportSaved')
      };
    } catch (error) {
      console.error('Failed to save exported video:', error)
      return {
        success: false,
        message: tt(normalizeLocale(), 'exportSaveFailed'),
        error: String(error)
      }
    }
  })

  ipcMain.handle('open-video-file-picker', async (_, localeInput?: string) => {
    try {
      const locale = normalizeLocale(localeInput)
      const result = await dialog.showOpenDialog({
        title: tt(locale, 'selectVideoFile'),
        defaultPath: RECORDINGS_DIR,
        filters: [
          { name: tt(locale, 'videoFiles'), extensions: ['webm', 'mp4', 'mov', 'avi', 'mkv'] },
          { name: tt(locale, 'allFiles'), extensions: ['*'] }
        ],
        properties: ['openFile']
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, cancelled: true };
      }

      return {
        success: true,
        path: result.filePaths[0]
      };
    } catch (error) {
      console.error('Failed to open file picker:', error);
      return {
        success: false,
        message: tt(normalizeLocale(), 'filePickerFailed'),
        error: String(error)
      };
    }
  });

  ipcMain.handle('set-current-video-path', (_, path: string, metadata?: CurrentVideoMetadata) => {
    currentVideoPath = path
    currentVideoMetadata = sanitizeVideoMetadata(metadata)
    return { success: true };
  });

  ipcMain.handle('get-current-video-path', () => {
    return currentVideoPath
      ? { success: true, path: currentVideoPath, metadata: currentVideoMetadata ?? undefined }
      : { success: false };
  });

  ipcMain.handle('clear-current-video-path', () => {
    currentVideoPath = null;
    currentVideoMetadata = null;
    return { success: true };
  });

  ipcMain.handle('get-platform', () => {
    return process.platform;
  });
}
