import { BrowserWindow, screen, ipcMain, desktopCapturer, shell, app, nativeImage, Tray, Menu } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs/promises";
import { uIOhook } from "uiohook-napi";
const __dirname$1 = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.join(__dirname$1, "..");
const VITE_DEV_SERVER_URL$1 = process.env["VITE_DEV_SERVER_URL"];
const RENDERER_DIST$1 = path.join(APP_ROOT, "dist");
function createHudOverlayWindow() {
  const win = new BrowserWindow({
    width: 250,
    height: 80,
    minWidth: 250,
    maxWidth: 250,
    minHeight: 80,
    maxHeight: 80,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname$1, "preload.mjs"),
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false
    }
  });
  win.webContents.on("did-finish-load", () => {
    win == null ? void 0 : win.webContents.send("main-process-message", (/* @__PURE__ */ new Date()).toLocaleString());
  });
  if (VITE_DEV_SERVER_URL$1) {
    win.loadURL(VITE_DEV_SERVER_URL$1 + "?windowType=hud-overlay");
  } else {
    win.loadFile(path.join(RENDERER_DIST$1, "index.html"), {
      query: { windowType: "hud-overlay" }
    });
  }
  return win;
}
function createEditorWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    frame: true,
    transparent: false,
    resizable: true,
    alwaysOnTop: false,
    skipTaskbar: false,
    title: "",
    webPreferences: {
      preload: path.join(__dirname$1, "preload.mjs"),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false
    }
  });
  win.maximize();
  win.webContents.on("did-finish-load", () => {
    win == null ? void 0 : win.webContents.send("main-process-message", (/* @__PURE__ */ new Date()).toLocaleString());
  });
  if (VITE_DEV_SERVER_URL$1) {
    win.loadURL(VITE_DEV_SERVER_URL$1 + "?windowType=editor");
  } else {
    win.loadFile(path.join(RENDERER_DIST$1, "index.html"), {
      query: { windowType: "editor" }
    });
  }
  return win;
}
function createSourceSelectorWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const win = new BrowserWindow({
    width: 620,
    height: 420,
    minHeight: 350,
    maxHeight: 500,
    x: Math.round((width - 620) / 2),
    y: Math.round((height - 420) / 2),
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    transparent: true,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname$1, "preload.mjs"),
      nodeIntegration: false,
      contextIsolation: true
    }
  });
  if (VITE_DEV_SERVER_URL$1) {
    win.loadURL(VITE_DEV_SERVER_URL$1 + "?windowType=source-selector");
  } else {
    win.loadFile(path.join(RENDERER_DIST$1, "index.html"), {
      query: { windowType: "source-selector" }
    });
  }
  return win;
}
let isMouseTrackingActive = false;
let isHookStarted = false;
let recordingStartTime = 0;
let mouseEventData = [];
function startMouseTracking() {
  if (isMouseTrackingActive) {
    return { success: false, message: "Already tracking" };
  }
  isMouseTrackingActive = true;
  recordingStartTime = performance.now();
  mouseEventData = [];
  if (!isHookStarted) {
    setupMouseEventListeners();
    try {
      uIOhook.start();
      isHookStarted = true;
      return { success: true, message: "Mouse tracking started", startTime: recordingStartTime };
    } catch (error) {
      console.error("❌ Failed to start mouse tracking:", error);
      isMouseTrackingActive = false;
      return { success: false, message: "Failed to start hook", error };
    }
  } else {
    return { success: true, message: "Mouse tracking resumed", startTime: recordingStartTime };
  }
}
function stopMouseTracking() {
  if (!isMouseTrackingActive) {
    return { success: false, message: "Not currently tracking" };
  }
  isMouseTrackingActive = false;
  const duration = performance.now() - recordingStartTime;
  const session = {
    startTime: recordingStartTime,
    events: mouseEventData,
    duration
  };
  return {
    success: true,
    message: "Mouse tracking stopped",
    data: session
  };
}
function setupMouseEventListeners() {
  uIOhook.on("mousemove", (e) => {
    if (isMouseTrackingActive) {
      const timestamp = performance.now() - recordingStartTime;
      const event = {
        type: "move",
        timestamp,
        x: e.x,
        y: e.y
      };
      mouseEventData.push(event);
    }
  });
  uIOhook.on("mousedown", (e) => {
    if (isMouseTrackingActive) {
      const timestamp = performance.now() - recordingStartTime;
      const event = {
        type: "down",
        timestamp,
        x: e.x,
        y: e.y,
        button: e.button,
        clicks: e.clicks
      };
      mouseEventData.push(event);
    }
  });
  uIOhook.on("mouseup", (e) => {
    if (isMouseTrackingActive) {
      const timestamp = performance.now() - recordingStartTime;
      const event = {
        type: "up",
        timestamp,
        x: e.x,
        y: e.y,
        button: e.button
      };
      mouseEventData.push(event);
    }
  });
  uIOhook.on("click", (e) => {
    if (isMouseTrackingActive) {
      const timestamp = performance.now() - recordingStartTime;
      const event = {
        type: "click",
        timestamp,
        x: e.x,
        y: e.y,
        button: e.button,
        clicks: e.clicks
      };
      mouseEventData.push(event);
    }
  });
}
function getTrackingData() {
  return [...mouseEventData];
}
function cleanupMouseTracking() {
  if (isHookStarted) {
    try {
      uIOhook.stop();
      isHookStarted = false;
      isMouseTrackingActive = false;
      mouseEventData = [];
    } catch (error) {
      console.error("Error cleaning up mouse tracking:", error);
    }
  }
}
let selectedSource = null;
function registerIpcHandlers(createEditorWindow2, createSourceSelectorWindow2, getMainWindow, getSourceSelectorWindow, onRecordingStateChange) {
  ipcMain.handle("get-sources", async (_, opts) => {
    const sources = await desktopCapturer.getSources(opts);
    return sources.map((source) => ({
      id: source.id,
      name: source.name,
      display_id: source.display_id,
      thumbnail: source.thumbnail ? source.thumbnail.toDataURL() : null,
      appIcon: source.appIcon ? source.appIcon.toDataURL() : null
    }));
  });
  ipcMain.handle("select-source", (_, source) => {
    selectedSource = source;
    const sourceSelectorWin = getSourceSelectorWindow();
    if (sourceSelectorWin) {
      sourceSelectorWin.close();
    }
    return selectedSource;
  });
  ipcMain.handle("get-selected-source", () => {
    return selectedSource;
  });
  ipcMain.handle("open-source-selector", () => {
    const sourceSelectorWin = getSourceSelectorWindow();
    if (sourceSelectorWin) {
      sourceSelectorWin.focus();
      return;
    }
    createSourceSelectorWindow2();
  });
  ipcMain.handle("switch-to-editor", () => {
    const mainWin = getMainWindow();
    if (mainWin) {
      mainWin.close();
    }
    createEditorWindow2();
  });
  ipcMain.handle("start-mouse-tracking", () => {
    return startMouseTracking();
  });
  ipcMain.handle("stop-mouse-tracking", () => {
    return stopMouseTracking();
  });
  ipcMain.handle("store-recorded-video", async (_, videoData, fileName) => {
    try {
      const videoPath = path.join(RECORDINGS_DIR, fileName);
      await fs.writeFile(videoPath, Buffer.from(videoData));
      return {
        success: true,
        path: videoPath,
        message: "Video stored successfully"
      };
    } catch (error) {
      console.error("Failed to store video:", error);
      return {
        success: false,
        message: "Failed to store video",
        error: String(error)
      };
    }
  });
  ipcMain.handle("store-mouse-tracking-data", async (_, fileName) => {
    try {
      const data = getTrackingData();
      if (data.length === 0) {
        return { success: false, message: "No tracking data to save" };
      }
      const trackingPath = path.join(RECORDINGS_DIR, fileName);
      await fs.writeFile(trackingPath, JSON.stringify(data, null, 2), "utf-8");
      return {
        success: true,
        path: trackingPath,
        eventCount: data.length,
        message: "Mouse tracking data stored successfully"
      };
    } catch (error) {
      console.error("Failed to store mouse tracking data:", error);
      return {
        success: false,
        message: "Failed to store mouse tracking data",
        error: String(error)
      };
    }
  });
  ipcMain.handle("get-recorded-video-path", async () => {
    try {
      const files = await fs.readdir(RECORDINGS_DIR);
      const videoFiles = files.filter((file) => file.endsWith(".webm"));
      if (videoFiles.length === 0) {
        return { success: false, message: "No recorded video found" };
      }
      const latestVideo = videoFiles.sort().reverse()[0];
      const videoPath = path.join(RECORDINGS_DIR, latestVideo);
      return { success: true, path: videoPath };
    } catch (error) {
      console.error("Failed to get video path:", error);
      return { success: false, message: "Failed to get video path", error: String(error) };
    }
  });
  ipcMain.handle("set-recording-state", (_, recording) => {
    const source = selectedSource || { name: "Screen" };
    if (onRecordingStateChange) {
      onRecordingStateChange(recording, source.name);
    }
  });
  ipcMain.handle("open-external-url", async (_, url) => {
    try {
      await shell.openExternal(url);
      return { success: true };
    } catch (error) {
      console.error("Failed to open URL:", error);
      return { success: false, error: String(error) };
    }
  });
}
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RECORDINGS_DIR = path.join(app.getPath("userData"), "recordings");
async function cleanupOldRecordings() {
  try {
    const files = await fs.readdir(RECORDINGS_DIR);
    const now = Date.now();
    const maxAge = 1 * 24 * 60 * 60 * 1e3;
    for (const file of files) {
      const filePath = path.join(RECORDINGS_DIR, file);
      const stats = await fs.stat(filePath);
      if (now - stats.mtimeMs > maxAge) {
        await fs.unlink(filePath);
        console.log(`Deleted old recording: ${file}`);
      }
    }
  } catch (error) {
    console.error("Failed to cleanup old recordings:", error);
  }
}
async function ensureRecordingsDir() {
  try {
    await fs.mkdir(RECORDINGS_DIR, { recursive: true });
    console.log("Recordings directory ready:", RECORDINGS_DIR);
  } catch (error) {
    console.error("Failed to create recordings directory:", error);
  }
}
process.env.APP_ROOT = path.join(__dirname, "..");
const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
const MAIN_DIST = path.join(process.env.APP_ROOT, "dist-electron");
const RENDERER_DIST = path.join(process.env.APP_ROOT, "dist");
process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, "public") : RENDERER_DIST;
let mainWindow = null;
let sourceSelectorWindow = null;
let tray = null;
let selectedSourceName = "";
function createWindow() {
  mainWindow = createHudOverlayWindow();
}
function createTray() {
  const iconPath = path.join(process.env.VITE_PUBLIC || RENDERER_DIST, "rec-button.png");
  let icon = nativeImage.createFromPath(iconPath);
  icon = icon.resize({ width: 24, height: 24, quality: "best" });
  tray = new Tray(icon);
  updateTrayMenu();
}
function updateTrayMenu() {
  if (!tray) return;
  const menuTemplate = [
    {
      label: "Stop Recording",
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("stop-recording-from-tray");
        }
      }
    }
  ];
  const contextMenu = Menu.buildFromTemplate(menuTemplate);
  tray.setContextMenu(contextMenu);
  tray.setToolTip(`Recording: ${selectedSourceName}`);
}
function createEditorWindowWrapper() {
  if (mainWindow) {
    mainWindow.close();
    mainWindow = null;
  }
  mainWindow = createEditorWindow();
}
function createSourceSelectorWindowWrapper() {
  sourceSelectorWindow = createSourceSelectorWindow();
  sourceSelectorWindow.on("closed", () => {
    sourceSelectorWindow = null;
  });
  return sourceSelectorWindow;
}
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    cleanupMouseTracking();
    app.quit();
    mainWindow = null;
  }
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
app.on("before-quit", async (event) => {
  event.preventDefault();
  cleanupMouseTracking();
  await cleanupOldRecordings();
  app.exit(0);
});
app.whenReady().then(async () => {
  await ensureRecordingsDir();
  registerIpcHandlers(
    createEditorWindowWrapper,
    createSourceSelectorWindowWrapper,
    () => mainWindow,
    () => sourceSelectorWindow,
    (recording, sourceName) => {
      selectedSourceName = sourceName;
      if (recording) {
        if (!tray) createTray();
        updateTrayMenu();
        if (mainWindow) mainWindow.minimize();
      } else {
        if (tray) {
          tray.destroy();
          tray = null;
        }
        if (mainWindow) mainWindow.restore();
      }
    }
  );
  createWindow();
});
export {
  MAIN_DIST,
  RECORDINGS_DIR,
  RENDERER_DIST,
  VITE_DEV_SERVER_URL
};
