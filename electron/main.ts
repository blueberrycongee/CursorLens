import { app, BrowserWindow, Tray, Menu, nativeImage, session, desktopCapturer } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs/promises'
import { createHudOverlayWindow, createEditorWindow, createSourceSelectorWindow } from './windows'
import { registerIpcHandlers } from './ipc/handlers'


const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const RECORDINGS_DIR = path.join(app.getPath('userData'), 'recordings')


async function ensureRecordingsDir() {
  try {
    await fs.mkdir(RECORDINGS_DIR, { recursive: true })
    console.log('RECORDINGS_DIR:', RECORDINGS_DIR)
    console.log('User Data Path:', app.getPath('userData'))
  } catch (error) {
    console.error('Failed to create recordings directory:', error)
  }
}

// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.js
// │ │ └── preload.mjs
// │
process.env.APP_ROOT = path.join(__dirname, '..')

// Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

// Window references
let mainWindow: BrowserWindow | null = null
let sourceSelectorWindow: BrowserWindow | null = null
let tray: Tray | null = null
let selectedSourceName = ''
let selectedDesktopSourceId: string | null = null
let shutdownInProgress = false
let shutdownFinished = false
let ipcRuntime: { shutdown: () => Promise<void> } | null = null

// Tray Icons
const defaultTrayIcon = getTrayIcon('openscreen.png');
const recordingTrayIcon = getTrayIcon('rec-button.png');

function createWindow() {
  mainWindow = createHudOverlayWindow()
}

function createTray() {
  tray = new Tray(defaultTrayIcon);
}

function getTrayIcon(filename: string) {
  return nativeImage.createFromPath(path.join(process.env.VITE_PUBLIC || RENDERER_DIST, filename)).resize({
    width: 24,
    height: 24,
    quality: 'best'
  });
}

function currentLocale(): 'en' | 'zh-CN' {
  return app.getLocale().toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'
}

function trayText(locale: 'en' | 'zh-CN', key: 'app' | 'recording' | 'stop' | 'open' | 'quit', source?: string): string {
  const dict = locale === 'zh-CN'
    ? {
        app: 'CursorLens',
        recording: `录制中：${source ?? ''}`,
        stop: '停止录制',
        open: '打开',
        quit: '退出',
      }
    : {
        app: 'CursorLens',
        recording: `Recording: ${source ?? ''}`,
        stop: 'Stop Recording',
        open: 'Open',
        quit: 'Quit',
      }
  return dict[key]
}


function updateTrayMenu(recording: boolean = false) {
  if (!tray) return;
  const locale = currentLocale();
  const trayIcon = recording ? recordingTrayIcon : defaultTrayIcon;
  const trayToolTip = recording ? trayText(locale, 'recording', selectedSourceName) : trayText(locale, 'app');
  const menuTemplate = recording
    ? [
        {
          label: trayText(locale, 'stop'),
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send("stop-recording-from-tray");
            }
          },
        },
      ]
    : [
        {
          label: trayText(locale, 'open'),
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.isMinimized() && mainWindow.restore();
            } else {
              createWindow();
            }
          },
        },
        {
          label: trayText(locale, 'quit'),
          click: () => {
            app.quit();
          },
        },
      ];
  tray.setImage(trayIcon);
  tray.setToolTip(trayToolTip);
  tray.setContextMenu(Menu.buildFromTemplate(menuTemplate));
}

function createEditorWindowWrapper() {
  if (mainWindow) {
    mainWindow.close()
    mainWindow = null
  }
  mainWindow = createEditorWindow()
}

function createSourceSelectorWindowWrapper() {
  sourceSelectorWindow = createSourceSelectorWindow()
  sourceSelectorWindow.on('closed', () => {
    sourceSelectorWindow = null
  })
  return sourceSelectorWindow
}

// On macOS, applications and their menu bar stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  // Keep app running (macOS behavior)
})

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.on('before-quit', (event) => {
  if (shutdownFinished) {
    return
  }

  event.preventDefault()
  if (shutdownInProgress) {
    return
  }

  shutdownInProgress = true

  void (async () => {
    try {
      if (ipcRuntime) {
        await Promise.race([
          ipcRuntime.shutdown(),
          new Promise<void>((resolve) => {
            globalThis.setTimeout(resolve, 12_000)
          }),
        ])
      }
    } catch (error) {
      console.warn('Failed to cleanly shutdown capture resources before quit:', error)
    } finally {
      shutdownFinished = true
      app.quit()
    }
  })()
})



// Register all IPC handlers when app is ready
app.whenReady().then(async () => {
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    try {
      if (!selectedDesktopSourceId) {
        callback({ video: undefined, audio: undefined })
        return
      }

      const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 1, height: 1 },
        fetchWindowIcons: false,
      })
      const selectedSource = sources.find((source) => source.id === selectedDesktopSourceId)
      if (!selectedSource) {
        callback({ video: undefined, audio: undefined })
        return
      }

      callback({
        video: selectedSource,
        audio: undefined,
      })
    } catch (error) {
      console.error('display-media handler failed:', error)
      callback({ video: undefined, audio: undefined })
    }
  })

    // Listen for HUD overlay quit event (macOS only)
    const { ipcMain } = await import('electron');
    ipcMain.on('hud-overlay-close', () => {
      app.quit();
    });
    createTray()
    updateTrayMenu()
  // Ensure recordings directory exists
  await ensureRecordingsDir()

  ipcRuntime = registerIpcHandlers(
    createEditorWindowWrapper,
    createSourceSelectorWindowWrapper,
    () => mainWindow,
    () => sourceSelectorWindow,
    (recording: boolean, sourceName: string) => {
      selectedSourceName = sourceName
      if (!tray) createTray();
      updateTrayMenu(recording);
      if (!recording) {
        if (mainWindow) mainWindow.restore();
      }
    },
    (source) => {
      selectedDesktopSourceId = source?.id ?? null
    }
  )
  createWindow()
})
