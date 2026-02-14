import { ipcMain, desktopCapturer, BrowserWindow, shell, app, dialog, screen, systemPreferences } from 'electron'

import fs from 'node:fs/promises'
import path from 'node:path'
import { RECORDINGS_DIR } from '../main'
import { scheduleRecordingsCleanup } from '../recordingsCleanup'
import {
  forceTerminateNativeMacRecorder,
  isNativeMacRecorderActive,
  startNativeMacRecorder,
  stopNativeMacRecorder,
} from '../native/sckRecorder'
import { getNativeCursorKind, startNativeCursorKindMonitor, stopNativeCursorKindMonitor } from '../native/cursorKindMonitor'
import { getWindowBoundsById, parseWindowIdFromSourceId } from './windowBounds'
import {
  isPointInsideBounds,
  normalizePointToBounds,
  resolveCursorBoundsForSource,
  type CaptureBounds,
  type CaptureBoundsResolution,
  type CaptureBoundsMode,
  type CaptureSourceRef,
} from '../../src/lib/cursor/captureSpace'
import { readAnalysisSidecar, VideoAnalysisService } from '../analysis/videoAnalysisService'

type SelectedSource = {
  id?: string
  name?: string
  display_id?: string | number | null
  width?: number
  height?: number
}

let selectedSource: SelectedSource | null = null

type Locale = 'en' | 'zh-CN'
type CurrentVideoMetadata = {
  frameRate?: number
  width?: number
  height?: number
  mimeType?: string
  capturedAt?: number
  systemCursorMode?: 'always' | 'never'
  hasMicrophoneAudio?: boolean
  cursorTrack?: {
    source?: 'recorded' | 'synthetic'
    samples: Array<{
      timeMs: number
      x: number
      y: number
      click?: boolean
      visible?: boolean
      cursorKind?: 'arrow' | 'ibeam'
    }>
    space?: {
      mode?: CaptureBoundsMode
      displayId?: string
      bounds?: CaptureBounds
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
}

type CursorTrackPayload = NonNullable<CurrentVideoMetadata['cursorTrack']>
type CursorTrackerStartOptions = {
  source?: CaptureSourceRef | null
  captureSize?: {
    width?: number
    height?: number
  } | null
}

type NativeRecorderStartOptions = {
  source?: CaptureSourceRef | SelectedSource | null
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
}

type SaveExportedVideoOptions = {
  directoryPath?: string | null
}

type StartVideoAnalysisOptions = {
  videoPath?: string
  locale?: string
  durationMs?: number
  videoWidth?: number
  subtitleWidthRatio?: number
}

const SOURCE_PERMISSION_GUIDANCE =
  'Screen Recording permission is not granted. Open System Settings > Privacy & Security > Screen & System Audio, allow CursorLens, then relaunch the app.'
const SCREEN_CAPTURE_SETTINGS_URL = 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'

type CapturePermissionStatus = 'granted' | 'denied' | 'restricted' | 'not-determined' | 'unknown' | 'manual-check'
type CapturePermissionKey = 'screen' | 'camera' | 'microphone' | 'accessibility' | 'input-monitoring'
type PermissionSettingsTarget = 'screen-capture' | 'camera' | 'microphone' | 'accessibility' | 'input-monitoring'

type CapturePermissionItem = {
  key: CapturePermissionKey
  status: CapturePermissionStatus
  requiredForRecording: boolean
  canOpenSettings: boolean
  settingsTarget?: PermissionSettingsTarget
}

type CapturePermissionSnapshot = {
  platform: NodeJS.Platform
  checkedAtMs: number
  canOpenSystemSettings: boolean
  items: CapturePermissionItem[]
}

const CAMERA_SETTINGS_URL = 'x-apple.systempreferences:com.apple.preference.security?Privacy_Camera'
const MICROPHONE_SETTINGS_URL = 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone'
const ACCESSIBILITY_SETTINGS_URL = 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'
const INPUT_MONITORING_SETTINGS_URL = 'x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent'

const PERMISSION_SETTINGS_URLS: Record<PermissionSettingsTarget, string> = {
  'screen-capture': SCREEN_CAPTURE_SETTINGS_URL,
  camera: CAMERA_SETTINGS_URL,
  microphone: MICROPHONE_SETTINGS_URL,
  accessibility: ACCESSIBILITY_SETTINGS_URL,
  'input-monitoring': INPUT_MONITORING_SETTINGS_URL,
}

type ScreenCaptureAccessStatus = 'granted' | 'denied' | 'restricted' | 'not-determined' | 'unknown'

function normalizeScreenCaptureAccessStatus(input: unknown): ScreenCaptureAccessStatus {
  const normalized = String(input ?? '').trim().toLowerCase()
  switch (normalized) {
    case 'granted':
      return 'granted'
    case 'denied':
      return 'denied'
    case 'restricted':
      return 'restricted'
    case 'not-determined':
      return 'not-determined'
    default:
      return 'unknown'
  }
}

function getScreenCaptureAccessStatus(): ScreenCaptureAccessStatus {
  if (process.platform !== 'darwin') {
    return 'granted'
  }
  try {
    return normalizeScreenCaptureAccessStatus(systemPreferences.getMediaAccessStatus('screen'))
  } catch {
    return 'unknown'
  }
}

function isScreenCaptureAccessBlocked(status: ScreenCaptureAccessStatus): boolean {
  return status === 'denied' || status === 'restricted'
}

function getMediaPermissionStatus(mediaType: 'camera' | 'microphone'): CapturePermissionStatus {
  if (process.platform !== 'darwin') {
    return 'granted'
  }
  try {
    return normalizeScreenCaptureAccessStatus(systemPreferences.getMediaAccessStatus(mediaType))
  } catch {
    return 'unknown'
  }
}

function getAccessibilityPermissionStatus(): CapturePermissionStatus {
  if (process.platform !== 'darwin') {
    return 'granted'
  }
  try {
    return systemPreferences.isTrustedAccessibilityClient(false) ? 'granted' : 'denied'
  } catch {
    return 'unknown'
  }
}

function getCapturePermissionSnapshot(): CapturePermissionSnapshot {
  const checkedAtMs = Date.now()
  const canOpenSystemSettings = process.platform === 'darwin'
  if (process.platform !== 'darwin') {
    return {
      platform: process.platform,
      checkedAtMs,
      canOpenSystemSettings: false,
      items: [
        {
          key: 'screen',
          status: 'granted',
          requiredForRecording: true,
          canOpenSettings: false,
          settingsTarget: 'screen-capture',
        },
        {
          key: 'camera',
          status: 'granted',
          requiredForRecording: false,
          canOpenSettings: false,
          settingsTarget: 'camera',
        },
        {
          key: 'microphone',
          status: 'granted',
          requiredForRecording: false,
          canOpenSettings: false,
          settingsTarget: 'microphone',
        },
        {
          key: 'accessibility',
          status: 'granted',
          requiredForRecording: false,
          canOpenSettings: false,
          settingsTarget: 'accessibility',
        },
        {
          key: 'input-monitoring',
          status: 'granted',
          requiredForRecording: false,
          canOpenSettings: false,
          settingsTarget: 'input-monitoring',
        },
      ],
    }
  }

  return {
    platform: process.platform,
    checkedAtMs,
    canOpenSystemSettings,
    items: [
      {
        key: 'screen',
        status: getScreenCaptureAccessStatus(),
        requiredForRecording: true,
        canOpenSettings: canOpenSystemSettings,
        settingsTarget: 'screen-capture',
      },
      {
        key: 'camera',
        status: getMediaPermissionStatus('camera'),
        requiredForRecording: false,
        canOpenSettings: canOpenSystemSettings,
        settingsTarget: 'camera',
      },
      {
        key: 'microphone',
        status: getMediaPermissionStatus('microphone'),
        requiredForRecording: false,
        canOpenSettings: canOpenSystemSettings,
        settingsTarget: 'microphone',
      },
      {
        key: 'accessibility',
        status: getAccessibilityPermissionStatus(),
        requiredForRecording: false,
        canOpenSettings: canOpenSystemSettings,
        settingsTarget: 'accessibility',
      },
      {
        key: 'input-monitoring',
        status: 'manual-check',
        requiredForRecording: false,
        canOpenSettings: canOpenSystemSettings,
        settingsTarget: 'input-monitoring',
      },
    ],
  }
}

function normalizeGetSourcesOptions(input?: Partial<Electron.SourcesOptions>): Electron.SourcesOptions {
  const requestedTypes = Array.isArray(input?.types) ? input?.types : []
  const types: Array<'screen' | 'window'> = []
  for (const type of requestedTypes) {
    if (type === 'screen' || type === 'window') {
      types.push(type)
    }
  }

  const normalizedTypes: Array<'screen' | 'window'> = types.length > 0 ? types : ['screen', 'window']
  const width = Number(input?.thumbnailSize?.width)
  const height = Number(input?.thumbnailSize?.height)

  return {
    types: normalizedTypes,
    thumbnailSize: {
      width: Number.isFinite(width) && width > 0 ? Math.floor(width) : 320,
      height: Number.isFinite(height) && height > 0 ? Math.floor(height) : 180,
    },
    fetchWindowIcons: input?.fetchWindowIcons !== false,
  }
}

function clampRecorderDimension(value: number): number {
  const rounded = Math.max(2, Math.round(value))
  return rounded % 2 === 0 ? rounded : rounded - 1
}

function resolveSourceDisplaySize(source: Electron.DesktopCapturerSource): { width?: number; height?: number } {
  if (!source.id.startsWith('screen:')) {
    return {}
  }

  const displayId = Number(source.display_id)
  if (!Number.isFinite(displayId)) {
    return {}
  }

  const display = screen.getAllDisplays().find((row) => row.id === displayId)
  if (!display || display.size.width <= 1 || display.size.height <= 1) {
    return {}
  }

  const scaleFactor = Math.max(1, Number(display.scaleFactor) || 1)
  const nativeWidth = clampRecorderDimension(display.size.width * scaleFactor)
  const nativeHeight = clampRecorderDimension(display.size.height * scaleFactor)

  return {
    width: nativeWidth,
    height: nativeHeight,
  }
}

function applyLongEdgeLimit(
  width: number,
  height: number,
  maxLongEdge: number,
): { width: number; height: number } {
  if (!Number.isFinite(maxLongEdge) || maxLongEdge <= 0) {
    return {
      width: clampRecorderDimension(width),
      height: clampRecorderDimension(height),
    }
  }

  const longEdge = Math.max(width, height)
  if (longEdge <= maxLongEdge) {
    return {
      width: clampRecorderDimension(width),
      height: clampRecorderDimension(height),
    }
  }

  const scale = maxLongEdge / longEdge
  return {
    width: clampRecorderDimension(width * scale),
    height: clampRecorderDimension(height * scale),
  }
}

function isGetSourcesPermissionError(error: unknown): boolean {
  const message = String(
    (error as { message?: unknown } | undefined)?.message
    ?? error
    ?? '',
  ).toLowerCase()
  return (
    message.includes('permission')
    || message.includes('not authorized')
    || message.includes('denied')
    || message.includes('tcc')
  )
}

function formatGetSourcesError(error: unknown): string {
  const raw = String((error as { message?: unknown } | undefined)?.message ?? error ?? 'Failed to get sources.')
  if (isGetSourcesPermissionError(error)) {
    return `${raw} ${SOURCE_PERMISSION_GUIDANCE}`
  }
  return raw
}

async function getSourcesWithFallback(
  opts: Electron.SourcesOptions,
): Promise<Electron.DesktopCapturerSource[]> {
  const attempts: Electron.SourcesOptions[] = [opts]

  if (opts.fetchWindowIcons) {
    attempts.push({
      ...opts,
      fetchWindowIcons: false,
    })
  }

  if (opts.types.includes('screen') && opts.types.includes('window')) {
    const noIcons = {
      ...opts,
      fetchWindowIcons: false,
    }
    attempts.push(
      {
        ...noIcons,
        types: ['screen'],
      },
      {
        ...noIcons,
        types: ['window'],
      },
    )
  }

  let lastError: unknown = null
  const collected = new Map<string, Electron.DesktopCapturerSource>()

  for (const attempt of attempts) {
    try {
      const sources = await desktopCapturer.getSources(attempt)
      for (const source of sources) {
        if (!collected.has(source.id)) {
          collected.set(source.id, source)
        }
      }
      if (attempt.types.length === 1) {
        continue
      }
      if (sources.length > 0) {
        return Array.from(collected.values())
      }
    } catch (error) {
      lastError = error
    }
  }

  if (collected.size > 0) {
    return Array.from(collected.values())
  }
  throw lastError ?? new Error('Failed to get sources.')
}

type CursorTrackerRuntime = {
  timer: NodeJS.Timeout
  boundsRefreshTimer: NodeJS.Timeout | null
  refreshingBounds: boolean
  startedAt: number
  samples: CursorTrackPayload['samples']
  bounds: CaptureBounds
  boundsMode: CaptureBoundsMode
  displayId?: string
  sourceRef?: CaptureSourceRef
  windowId?: number
  captureSize?: { width: number; height: number }
  lastPoint: { x: number; y: number } | null
  lastTickAt: number
  lastSampleAt: number
  lastSpeed: number
  stillFrames: number
  lastClickAt: number
  clickCount: number
}

function pushCursorSample(
  tracker: CursorTrackerRuntime,
  now: number,
  point: { x: number; y: number },
  cursorKind: 'arrow' | 'ibeam',
  click = false,
): void {
  const timeMs = Math.max(0, now - tracker.startedAt)
  const normalized = normalizePointToBounds(point, tracker.bounds)
  const inCaptureBounds = isPointInsideBounds(point, tracker.bounds, 0.5)
  const visible = tracker.boundsMode === 'virtual-desktop' ? true : inCaptureBounds

  tracker.samples.push({
    timeMs,
    x: normalized.x,
    y: normalized.y,
    click: click && visible,
    visible,
    cursorKind,
  })

  if (click && visible) {
    tracker.clickCount += 1
  }

  if (tracker.samples.length > 12_000) {
    tracker.samples.splice(0, 2_000)
  }

  tracker.lastSampleAt = now
}

function normalizeSourceRef(input?: CaptureSourceRef | SelectedSource | null): CaptureSourceRef | undefined {
  if (!input) return undefined
  const sourceId = typeof input.id === 'string' ? input.id : ''
  const displayId = input.display_id === null || input.display_id === undefined
    ? undefined
    : String(input.display_id)
  if (!sourceId && !displayId) return undefined
  return {
    id: sourceId || undefined,
    display_id: displayId,
  }
}

function normalizeCaptureSize(input?: CursorTrackerStartOptions['captureSize']): { width: number; height: number } | undefined {
  if (!input) return undefined
  const width = Math.floor(Number(input.width))
  const height = Math.floor(Number(input.height))
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 2 || height < 2) {
    return undefined
  }
  return { width, height }
}

function resolveWindowCaptureFallbackBounds(args: {
  displays: Electron.Display[]
  initialResolution: CaptureBoundsResolution
  captureSize?: { width: number; height: number }
  point: { x: number; y: number }
}): { bounds: CaptureBounds; mode: CaptureBoundsMode; displayId?: string } {
  const matchedDisplay = args.initialResolution.displayId
    ? args.displays.find((display) => String(display.id) === args.initialResolution.displayId)
    : undefined
  const nearestDisplay = screen.getDisplayNearestPoint(args.point)
  const displayForScale = matchedDisplay ?? nearestDisplay
  const displayBounds = displayForScale?.bounds ?? args.initialResolution.bounds

  if (!args.captureSize) {
    return {
      bounds: {
        x: displayBounds.x,
        y: displayBounds.y,
        width: Math.max(1, displayBounds.width),
        height: Math.max(1, displayBounds.height),
      },
      mode: 'source-display',
      displayId: displayForScale ? String(displayForScale.id) : args.initialResolution.displayId,
    }
  }

  const scaleFactor = Math.max(1, Number(displayForScale?.scaleFactor) || 1)
  const width = Math.max(1, args.captureSize.width / scaleFactor)
  const height = Math.max(1, args.captureSize.height / scaleFactor)
  const normalizedOnDisplay = normalizePointToBounds(args.point, displayBounds)

  return {
    bounds: {
      x: args.point.x - normalizedOnDisplay.x * width,
      y: args.point.y - normalizedOnDisplay.y * height,
      width,
      height,
    },
    mode: 'source-display',
    displayId: displayForScale ? String(displayForScale.id) : args.initialResolution.displayId,
  }
}

function resolveCursorSidecarPath(videoPath: string): string {
  const parsed = path.parse(videoPath)
  return path.join(parsed.dir, `${parsed.name}.cursor.json`)
}

async function readCursorTrackSidecar(videoPath: string): Promise<CurrentVideoMetadata['cursorTrack'] | undefined> {
  const sidecarPath = resolveCursorSidecarPath(videoPath)
  try {
    const raw = await fs.readFile(sidecarPath, 'utf-8')
    const parsed = JSON.parse(raw) as { cursorTrack?: CurrentVideoMetadata['cursorTrack'] } | CurrentVideoMetadata['cursorTrack']
    const input = (parsed as { cursorTrack?: CurrentVideoMetadata['cursorTrack'] }).cursorTrack ?? (parsed as CurrentVideoMetadata['cursorTrack'])
    return sanitizeCursorTrack(input)
  } catch {
    return undefined
  }
}

async function writeCursorTrackSidecar(videoPath: string, cursorTrack: CurrentVideoMetadata['cursorTrack']): Promise<void> {
  const sanitized = sanitizeCursorTrack(cursorTrack)
  if (!sanitized) return
  const sidecarPath = resolveCursorSidecarPath(videoPath)
  const payload = JSON.stringify(
    {
      version: 1,
      cursorTrack: sanitized,
    },
    null,
    2,
  )
  await fs.writeFile(sidecarPath, payload, 'utf-8')
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
      const cursorKind: 'arrow' | 'ibeam' = sample.cursorKind === 'ibeam' ? 'ibeam' : 'arrow'
      return {
        timeMs: Math.max(0, Math.round(timeMs)),
        x: Math.min(1, Math.max(0, x)),
        y: Math.min(1, Math.max(0, y)),
        click: Boolean(sample.click),
        visible: sample.visible === false ? false : true,
        cursorKind,
      }
    })
    .filter((sample): sample is NonNullable<typeof sample> => Boolean(sample))
    .sort((a, b) => a.timeMs - b.timeMs)

  if (samples.length === 0) return undefined
  const normalized: NonNullable<CurrentVideoMetadata['cursorTrack']> = {
    source: input.source === 'synthetic' ? 'synthetic' : 'recorded',
    samples,
  }

  if (input.space) {
    const boundsInput = input.space.bounds
    const x = Number(boundsInput?.x)
    const y = Number(boundsInput?.y)
    const width = Number(boundsInput?.width)
    const height = Number(boundsInput?.height)
    if ([x, y, width, height].every(Number.isFinite) && width >= 1 && height >= 1) {
      normalized.space = {
        mode: input.space.mode === 'source-display' ? 'source-display' : 'virtual-desktop',
        displayId: typeof input.space.displayId === 'string' && input.space.displayId.trim().length > 0
          ? input.space.displayId.trim()
          : undefined,
        bounds: {
          x,
          y,
          width,
          height,
        },
      }
    }
  }

  if (input.stats) {
    const sampleCount = Number(input.stats.sampleCount)
    const clickCount = Number(input.stats.clickCount)
    normalized.stats = {
      sampleCount: Number.isFinite(sampleCount) && sampleCount >= 0 ? Math.floor(sampleCount) : samples.length,
      clickCount: Number.isFinite(clickCount) && clickCount >= 0 ? Math.floor(clickCount) : samples.filter((sample) => sample.click).length,
    }
  }

  if (input.capture) {
    const width = Number(input.capture.width)
    const height = Number(input.capture.height)
    const sourceId = typeof input.capture.sourceId === 'string' && input.capture.sourceId.trim().length > 0
      ? input.capture.sourceId.trim()
      : undefined
    if (sourceId || (Number.isFinite(width) && Number.isFinite(height))) {
      normalized.capture = {
        sourceId,
        width: Number.isFinite(width) && width >= 2 ? Math.floor(width) : undefined,
        height: Number.isFinite(height) && height >= 2 ? Math.floor(height) : undefined,
      }
    }
  }

  return normalized
}

function normalizeLocale(input?: string): Locale {
  return (input ?? '').toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'
}

function tt(locale: Locale, key: string): string {
  const zh: Record<string, string> = {
    saveGif: '保存导出 GIF',
    saveVideo: '保存导出视频',
    chooseExportFolder: '选择导出文件夹',
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
    chooseExportFolder: 'Choose Export Folder',
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
  if (metadata.systemCursorMode === 'always' || metadata.systemCursorMode === 'never') {
    normalized.systemCursorMode = metadata.systemCursorMode
  }
  if (typeof metadata.hasMicrophoneAudio === 'boolean') {
    normalized.hasMicrophoneAudio = metadata.hasMicrophoneAudio
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
  createPermissionCheckerWindow: () => BrowserWindow,
  getMainWindow: () => BrowserWindow | null,
  getSourceSelectorWindow: () => BrowserWindow | null,
  getPermissionCheckerWindow: () => BrowserWindow | null,
  onRecordingStateChange?: (recording: boolean, sourceName: string) => void,
  onSourceSelectionChange?: (source: SelectedSource | null) => void,
) {
  let currentVideoPath: string | null = null
  let currentVideoMetadata: CurrentVideoMetadata | null = null
  let cursorTracker: CursorTrackerRuntime | null = null
  const analysisService = new VideoAnalysisService()

  const stopCursorTracker = (): CursorTrackPayload | undefined => {
    if (!cursorTracker) return undefined
    globalThis.clearInterval(cursorTracker.timer)
    if (cursorTracker.boundsRefreshTimer) {
      globalThis.clearInterval(cursorTracker.boundsRefreshTimer)
      cursorTracker.boundsRefreshTimer = null
    }
    stopNativeCursorKindMonitor()
    const payload = sanitizeCursorTrack({
      source: 'recorded',
      samples: cursorTracker.samples,
      space: {
        mode: cursorTracker.boundsMode,
        displayId: cursorTracker.displayId,
        bounds: cursorTracker.bounds,
      },
      stats: {
        sampleCount: cursorTracker.samples.length,
        clickCount: cursorTracker.clickCount,
      },
      capture: {
        sourceId: cursorTracker.sourceRef?.id ?? undefined,
        width: cursorTracker.captureSize?.width,
        height: cursorTracker.captureSize?.height,
      },
    })
    cursorTracker = null
    return payload
  }

  ipcMain.handle('cursor-tracker-start', async (_, options?: CursorTrackerStartOptions) => {
    stopCursorTracker()
    await startNativeCursorKindMonitor()

    const startedAt = Date.now()
    const initialPoint = screen.getCursorScreenPoint()
    const sourceRef = normalizeSourceRef(options?.source) ?? normalizeSourceRef(selectedSource)
    const captureSize = normalizeCaptureSize(options?.captureSize)
    const windowId = parseWindowIdFromSourceId(sourceRef?.id)
    const displayObjects = screen.getAllDisplays()
    const displaySnapshot = displayObjects.map((display) => ({
      id: display.id,
      bounds: display.bounds,
    }))
    const initialResolution = resolveCursorBoundsForSource({
      displays: displaySnapshot,
      source: sourceRef,
      pointHint: initialPoint,
    })
    let captureBounds = initialResolution.bounds
    let captureMode = initialResolution.mode
    let captureDisplayId = initialResolution.displayId
    let hasNativeWindowBounds = false
    let usingWindowBoundsFallback = false

    if (windowId) {
      const nativeWindowBounds = await getWindowBoundsById(windowId)
      if (nativeWindowBounds) {
        hasNativeWindowBounds = true
        captureBounds = nativeWindowBounds
        captureMode = 'source-display'
        const displayForWindow = screen.getDisplayNearestPoint({
          x: Math.round(nativeWindowBounds.x + nativeWindowBounds.width / 2),
          y: Math.round(nativeWindowBounds.y + nativeWindowBounds.height / 2),
        })
        captureDisplayId = displayForWindow ? String(displayForWindow.id) : captureDisplayId
      }
    }

    if (windowId && !hasNativeWindowBounds) {
      const fallback = resolveWindowCaptureFallbackBounds({
        displays: displayObjects,
        initialResolution,
        captureSize,
        point: initialPoint,
      })
      captureBounds = fallback.bounds
      captureMode = fallback.mode
      captureDisplayId = fallback.displayId
      usingWindowBoundsFallback = true
      console.warn(
        'Native window bounds are unavailable for cursor tracking; using fallback bounds mapping for this recording.',
      )
    }

    const tracker: CursorTrackerRuntime = {
      timer: globalThis.setInterval(() => {
        if (!cursorTracker) return

        const now = Date.now()
        const point = screen.getCursorScreenPoint()

        if (!cursorTracker.lastPoint) {
          cursorTracker.lastPoint = { x: point.x, y: point.y }
          cursorTracker.lastTickAt = now
          pushCursorSample(cursorTracker, now, point, getNativeCursorKind(), false)
          return
        }

        const dt = Math.max(1, now - cursorTracker.lastTickAt)
        const dx = point.x - cursorTracker.lastPoint.x
        const dy = point.y - cursorTracker.lastPoint.y
        const distance = Math.hypot(dx, dy)
        const speed = (distance * 1000) / dt

        if (distance <= 1) {
          cursorTracker.stillFrames += 1
        } else {
          cursorTracker.stillFrames = 0
        }

        let click = false
        if (
          cursorTracker.stillFrames >= 2
          && cursorTracker.lastSpeed > 950
          && now - cursorTracker.lastClickAt > 240
        ) {
          click = true
          cursorTracker.lastClickAt = now
          cursorTracker.stillFrames = 0
        }

        const shouldStore = click || distance >= 0.2 || now - cursorTracker.lastSampleAt >= 33
        if (shouldStore) {
          pushCursorSample(cursorTracker, now, point, getNativeCursorKind(), click)
        }

        cursorTracker.lastSpeed = speed
        cursorTracker.lastPoint = { x: point.x, y: point.y }
        cursorTracker.lastTickAt = now
      }, 16),
      boundsRefreshTimer: null,
      refreshingBounds: false,
      startedAt,
      samples: [],
      bounds: captureBounds,
      boundsMode: captureMode,
      displayId: captureDisplayId,
      sourceRef,
      windowId,
      captureSize,
      lastPoint: null,
      lastTickAt: startedAt,
      lastSampleAt: startedAt,
      lastSpeed: 0,
      stillFrames: 0,
      lastClickAt: 0,
      clickCount: 0,
    }

    cursorTracker = tracker
    if (windowId) {
      tracker.boundsRefreshTimer = globalThis.setInterval(() => {
        void (async () => {
          if (!cursorTracker || cursorTracker !== tracker || !tracker.windowId || tracker.refreshingBounds) {
            return
          }

          tracker.refreshingBounds = true
          try {
            const nextBounds = await getWindowBoundsById(tracker.windowId)
            if (!cursorTracker || cursorTracker !== tracker) return

            if (!nextBounds) {
              const point = screen.getCursorScreenPoint()
              const displaySnapshot = screen.getAllDisplays()
              const fallbackResolution = resolveCursorBoundsForSource({
                displays: displaySnapshot.map((display) => ({
                  id: display.id,
                  bounds: display.bounds,
                })),
                source: tracker.sourceRef,
                pointHint: point,
              })
              const fallback = resolveWindowCaptureFallbackBounds({
                displays: displaySnapshot,
                initialResolution: fallbackResolution,
                captureSize: tracker.captureSize,
                point,
              })
              tracker.bounds = fallback.bounds
              tracker.boundsMode = fallback.mode
              tracker.displayId = fallback.displayId
              return
            }

            tracker.bounds = nextBounds
            tracker.boundsMode = 'source-display'
            const displayForWindow = screen.getDisplayNearestPoint({
              x: Math.round(nextBounds.x + nextBounds.width / 2),
              y: Math.round(nextBounds.y + nextBounds.height / 2),
            })
            if (displayForWindow) {
              tracker.displayId = String(displayForWindow.id)
            }
          } finally {
            tracker.refreshingBounds = false
          }
        })()
      }, 120)
    }
    pushCursorSample(tracker, startedAt, initialPoint, getNativeCursorKind(), false)

    return {
      success: true,
      warningCode: usingWindowBoundsFallback ? 'window_bounds_fallback' : undefined,
      warningMessage: usingWindowBoundsFallback
        ? 'Window capture is using fallback bounds mapping. Cursor alignment may be less accurate.'
        : undefined,
    }
  })

  ipcMain.handle('cursor-tracker-stop', () => {
    const track = stopCursorTracker()
    return { success: true, track }
  })

  ipcMain.handle('get-sources', async (_, opts) => {
    const normalized = normalizeGetSourcesOptions(opts)
    const accessStatus = getScreenCaptureAccessStatus()
    if (isScreenCaptureAccessBlocked(accessStatus)) {
      throw new Error(`${SOURCE_PERMISSION_GUIDANCE} (status: ${accessStatus})`)
    }

    try {
      const sources = await getSourcesWithFallback(normalized)
      return sources.map(source => ({
        id: source.id,
        name: source.name,
        display_id: source.display_id,
        ...resolveSourceDisplaySize(source),
        thumbnail: source.thumbnail ? source.thumbnail.toDataURL() : null,
        appIcon: source.appIcon ? source.appIcon.toDataURL() : null
      }))
    } catch (error) {
      const latestStatus = getScreenCaptureAccessStatus()
      if (isScreenCaptureAccessBlocked(latestStatus)) {
        throw new Error(`${SOURCE_PERMISSION_GUIDANCE} (status: ${latestStatus})`)
      }
      const message = formatGetSourcesError(error)
      console.error('Failed to get sources:', error)
      throw new Error(message)
    }
  })

  ipcMain.handle('get-screen-capture-access-status', () => {
    const status = getScreenCaptureAccessStatus()
    return {
      status,
      canOpenSystemSettings: process.platform === 'darwin',
    }
  })

  ipcMain.handle('get-capture-permission-snapshot', () => {
    return getCapturePermissionSnapshot()
  })

  ipcMain.handle('open-permission-settings', async (_, target: PermissionSettingsTarget | string) => {
    if (process.platform !== 'darwin') {
      return { success: false, message: 'Opening Privacy settings is only supported on macOS.' }
    }

    const normalizedTarget = typeof target === 'string' ? target.trim() : ''
    const url = PERMISSION_SETTINGS_URLS[normalizedTarget as PermissionSettingsTarget]
    if (!url) {
      return { success: false, message: `Unknown permission settings target: ${String(target)}` }
    }

    try {
      await shell.openExternal(url)
      return { success: true }
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : String(error),
      }
    }
  })

  ipcMain.handle('open-screen-capture-settings', async () => {
    if (process.platform !== 'darwin') {
      return { success: false, message: 'Opening Screen Capture settings is only supported on macOS.' }
    }
    try {
      await shell.openExternal(PERMISSION_SETTINGS_URLS['screen-capture'])
      return { success: true }
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : String(error),
      }
    }
  })

  ipcMain.handle('open-permission-checker', () => {
    const permissionWindow = getPermissionCheckerWindow()
    if (permissionWindow) {
      permissionWindow.focus()
      return { success: true }
    }
    createPermissionCheckerWindow()
    return { success: true }
  })

  ipcMain.handle('select-source', (_, source) => {
    selectedSource = source
    onSourceSelectionChange?.(selectedSource)
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
      if (currentVideoMetadata?.cursorTrack) {
        await writeCursorTrackSidecar(videoPath, currentVideoMetadata.cursorTrack)
      }
      scheduleRecordingsCleanup({
        recordingsDir: RECORDINGS_DIR,
        excludePaths: [videoPath],
        reason: 'post-recording',
      })
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
    const sourceName = selectedSource?.name || 'Screen'
    if (onRecordingStateChange) {
      onRecordingStateChange(recording, sourceName)
    }
  })

  ipcMain.handle('native-screen-recorder-start', async (_, options?: NativeRecorderStartOptions) => {
    try {
      if (process.platform !== 'darwin') {
        return { success: false, message: 'Native ScreenCaptureKit recorder is only supported on macOS.' }
      }

      const sourceRef = normalizeSourceRef(options?.source) ?? normalizeSourceRef(selectedSource)
      const cursorMode = options?.cursorMode === 'never' ? 'never' : 'always'
      const microphoneEnabled = options?.microphoneEnabled !== false
      const cameraEnabled = options?.cameraEnabled === true
      const cameraShape = options?.cameraShape === 'square' || options?.cameraShape === 'circle'
        ? options.cameraShape
        : 'rounded'
      const cameraSizePercent = Number.isFinite(options?.cameraSizePercent)
        ? Number(options?.cameraSizePercent)
        : 22
      const frameRate = Number.isFinite(options?.frameRate) ? Number(options?.frameRate) : 60
      const maxLongEdge = Number.isFinite(options?.maxLongEdge) ? Math.max(2, Math.round(Number(options?.maxLongEdge))) : undefined
      const bitrateScale = Number.isFinite(options?.bitrateScale)
        ? Math.max(0.5, Math.min(2, Number(options?.bitrateScale)))
        : 1
      let width = Number.isFinite(options?.width) ? clampRecorderDimension(Number(options?.width)) : undefined
      let height = Number.isFinite(options?.height) ? clampRecorderDimension(Number(options?.height)) : undefined
      if ((!width || !height) && maxLongEdge && sourceRef?.id?.startsWith('screen:')) {
        const sourceWidth = Number((options?.source as SelectedSource | undefined)?.width ?? selectedSource?.width)
        const sourceHeight = Number((options?.source as SelectedSource | undefined)?.height ?? selectedSource?.height)
        if (Number.isFinite(sourceWidth) && Number.isFinite(sourceHeight) && sourceWidth > 1 && sourceHeight > 1) {
          const limited = applyLongEdgeLimit(sourceWidth, sourceHeight, maxLongEdge)
          width = limited.width
          height = limited.height
        }
      }
      const outputPath = path.join(RECORDINGS_DIR, `recording-${Date.now()}.mp4`)

      const result = await startNativeMacRecorder({
        outputPath,
        sourceId: typeof sourceRef?.id === 'string' ? sourceRef.id : undefined,
        displayId: sourceRef?.display_id ? String(sourceRef.display_id) : undefined,
        cursorMode,
        microphoneEnabled,
        cameraEnabled,
        cameraShape,
        cameraSizePercent,
        frameRate,
        bitrateScale,
        width,
        height,
      })

      if (!result.success || !result.ready) {
        return {
          success: false,
          code: result.code,
          message: result.message ?? 'Failed to start native ScreenCaptureKit recorder.',
        }
      }

      const sourceName = selectedSource?.name || 'Screen'
      onRecordingStateChange?.(true, sourceName)

      return {
        success: true,
        width: result.ready.width,
        height: result.ready.height,
        frameRate: result.ready.frameRate,
        sourceKind: result.ready.sourceKind,
        hasMicrophoneAudio: result.ready.hasMicrophoneAudio,
      }
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : String(error),
      }
    }
  })

  ipcMain.handle('native-screen-recorder-stop', async () => {
    try {
      const result = await stopNativeMacRecorder()
      const sourceName = selectedSource?.name || 'Screen'
      onRecordingStateChange?.(false, sourceName)
      if (result.success && result.path) {
        scheduleRecordingsCleanup({
          recordingsDir: RECORDINGS_DIR,
          excludePaths: [result.path],
          reason: 'post-native-recording',
        })
      }
      return result
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : String(error),
      }
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

  ipcMain.handle('save-exported-video', async (_, videoData: ArrayBuffer, fileName: string, localeInput?: string, options?: SaveExportedVideoOptions) => {
    try {
      const locale = normalizeLocale(localeInput)
      // Determine file type from extension
      const isGif = fileName.toLowerCase().endsWith('.gif');
      const filters = isGif 
        ? [{ name: 'GIF', extensions: ['gif'] }]
        : [{ name: 'MP4', extensions: ['mp4'] }];
      const directoryPath = typeof options?.directoryPath === 'string' && options.directoryPath.trim().length > 0
        ? options.directoryPath.trim()
        : null

      let targetPath: string
      if (directoryPath) {
        await fs.mkdir(directoryPath, { recursive: true })
        targetPath = path.join(directoryPath, fileName)
      } else {
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
        targetPath = result.filePath
      }

      await fs.writeFile(targetPath, Buffer.from(videoData));

      return {
        success: true,
        path: targetPath,
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

  ipcMain.handle('pick-export-directory', async (_, localeInput?: string) => {
    try {
      const locale = normalizeLocale(localeInput)
      const result = await dialog.showOpenDialog({
        title: tt(locale, 'chooseExportFolder'),
        defaultPath: app.getPath('downloads'),
        properties: ['openDirectory', 'createDirectory'],
      })

      if (result.canceled || result.filePaths.length === 0) {
        return {
          success: false,
          cancelled: true,
          message: tt(locale, 'exportCancelled'),
        }
      }

      return {
        success: true,
        path: result.filePaths[0],
      }
    } catch (error) {
      console.error('Failed to pick export directory:', error)
      return {
        success: false,
        message: tt(normalizeLocale(), 'exportSaveFailed'),
        error: String(error),
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

  ipcMain.handle('set-current-video-path', async (_, nextPath: string, metadata?: CurrentVideoMetadata) => {
    currentVideoPath = nextPath
    currentVideoMetadata = sanitizeVideoMetadata(metadata)
    if (currentVideoPath && !currentVideoMetadata?.cursorTrack) {
      const sidecarTrack = await readCursorTrackSidecar(currentVideoPath)
      if (sidecarTrack) {
        currentVideoMetadata = {
          ...(currentVideoMetadata ?? {}),
          cursorTrack: sidecarTrack,
        }
      }
    }
    return { success: true };
  });

  ipcMain.handle('get-current-video-path', async () => {
    if (currentVideoPath && !currentVideoMetadata?.cursorTrack) {
      const sidecarTrack = await readCursorTrackSidecar(currentVideoPath)
      if (sidecarTrack) {
        currentVideoMetadata = {
          ...(currentVideoMetadata ?? {}),
          cursorTrack: sidecarTrack,
        }
      }
    }

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

  ipcMain.handle('analysis-start', async (_, options?: StartVideoAnalysisOptions) => {
    try {
      const targetVideoPath = (typeof options?.videoPath === 'string' && options.videoPath.trim().length > 0)
        ? options.videoPath.trim()
        : currentVideoPath

      if (!targetVideoPath) {
        return { success: false, message: 'No video selected for analysis.' }
      }

      const job = analysisService.start({
        videoPath: targetVideoPath,
        locale: typeof options?.locale === 'string' && options.locale.trim().length > 0
          ? options.locale.trim()
          : app.getLocale(),
        durationMs: Number.isFinite(options?.durationMs) ? Number(options?.durationMs) : 0,
        videoWidth: Number.isFinite(options?.videoWidth) ? Number(options?.videoWidth) : 1920,
        subtitleWidthRatio: Number.isFinite(options?.subtitleWidthRatio)
          ? Number(options?.subtitleWidthRatio)
          : 0.82,
      })

      return {
        success: true,
        jobId: job.jobId,
      }
    } catch (error) {
      console.error('Failed to start analysis job:', error)
      return {
        success: false,
        message: error instanceof Error ? error.message : String(error),
      }
    }
  })

  ipcMain.handle('analysis-status', (_, jobId: string) => {
    const status = analysisService.getStatus(String(jobId || '').trim())
    if (!status) {
      return { success: false, message: 'Analysis job not found.' }
    }

    return {
      success: true,
      status,
    }
  })

  ipcMain.handle('analysis-result', (_, jobId: string) => {
    const normalizedJobId = String(jobId || '').trim()
    const status = analysisService.getStatus(normalizedJobId)
    if (!status) {
      return { success: false, message: 'Analysis job not found.' }
    }

    if (status.status === 'failed') {
      return {
        success: false,
        message: status.error || 'Analysis job failed.',
        status,
      }
    }

    if (status.status !== 'completed') {
      return {
        success: false,
        message: 'Analysis job is still running.',
        status,
      }
    }

    const result = analysisService.getResult(normalizedJobId)
    if (!result) {
      return {
        success: false,
        message: 'Analysis job completed without result payload.',
        status,
      }
    }

    return {
      success: true,
      status,
      result,
    }
  })

  ipcMain.handle('analysis-get-current', async (_, targetPath?: string) => {
    const videoPath = typeof targetPath === 'string' && targetPath.trim().length > 0
      ? targetPath.trim()
      : currentVideoPath
    if (!videoPath) {
      return { success: false, message: 'No video selected for analysis.' }
    }

    try {
      const analysis = await readAnalysisSidecar(videoPath)
      return {
        success: true,
        analysis: analysis ?? undefined,
      }
    } catch (error) {
      console.error('Failed to read analysis sidecar:', error)
      return {
        success: false,
        message: error instanceof Error ? error.message : String(error),
      }
    }
  })

  const shutdown = async (): Promise<void> => {
    try {
      stopCursorTracker()

      if (isNativeMacRecorderActive()) {
        const result = await stopNativeMacRecorder()
        if (!result.success) {
          console.warn('[ipc] native recorder stop during shutdown reported failure:', result.message)
          forceTerminateNativeMacRecorder()
        }
      }
    } catch (error) {
      console.warn('[ipc] failed to shutdown capture resources cleanly:', error)
      forceTerminateNativeMacRecorder()
    }
  }

  return {
    shutdown,
  }
}
