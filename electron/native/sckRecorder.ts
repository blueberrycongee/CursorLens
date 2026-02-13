import { app } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'

export type NativeCursorMode = 'always' | 'never'

export type NativeRecorderStartOptions = {
  outputPath: string
  sourceId?: string
  displayId?: string
  cursorMode: NativeCursorMode
  cameraEnabled?: boolean
  cameraShape?: 'rounded' | 'square' | 'circle'
  cameraSizePercent?: number
  frameRate: number
  width?: number
  height?: number
}

export type NativeRecorderStopResult = {
  success: boolean
  path?: string
  message?: string
  metadata?: {
    frameRate: number
    width: number
    height: number
    mimeType: string
    capturedAt: number
    systemCursorMode: NativeCursorMode
  }
}

type RecorderReadyInfo = {
  width: number
  height: number
  frameRate: number
  sourceKind: 'display' | 'window' | 'unknown'
}

type RecorderHelperErrorInfo = {
  code: string
  message: string
}

type ActiveNativeRecorderSession = {
  process: ChildProcess
  outputPath: string
  cursorMode: NativeCursorMode
  ready: RecorderReadyInfo
  exitPromise: Promise<{ code: number | null; signal: NodeJS.Signals | null }>
}

let activeSession: ActiveNativeRecorderSession | null = null

function isChildProcessAlive(processRef: ChildProcess): boolean {
  const pid = processRef.pid
  if (!pid || processRef.exitCode !== null) {
    return false
  }

  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function clearStaleActiveSession(): void {
  if (!activeSession) {
    return
  }

  if (!isChildProcessAlive(activeSession.process)) {
    activeSession = null
  }
}

function parseReadyLine(line: string): RecorderReadyInfo | null {
  const match = /SCK_RECORDER_READY\s+width=(\d+)\s+height=(\d+)\s+fps=(\d+)\s+source=([a-zA-Z-]+)/.exec(line)
  if (!match) return null
  const width = Number(match[1])
  const height = Number(match[2])
  const frameRate = Number(match[3])
  const sourceKindRaw = String(match[4])
  if (!Number.isFinite(width) || !Number.isFinite(height) || !Number.isFinite(frameRate)) {
    return null
  }

  const sourceKind: RecorderReadyInfo['sourceKind'] = sourceKindRaw === 'window'
    ? 'window'
    : sourceKindRaw === 'display'
      ? 'display'
      : 'unknown'

  return {
    width: Math.max(2, Math.round(width)),
    height: Math.max(2, Math.round(height)),
    frameRate: Math.max(1, Math.round(frameRate)),
    sourceKind,
  }
}

function parseHelperErrorLine(line: string): RecorderHelperErrorInfo | null {
  const match = /^SCK_RECORDER_ERROR\s+code=([a-z0-9_-]+)\s+message=(.+)$/i.exec(line)
  if (!match) return null
  return {
    code: String(match[1]).toLowerCase(),
    message: String(match[2]).trim(),
  }
}

function collectLines(stream: NodeJS.ReadableStream, onLine: (line: string) => void): () => void {
  let buffer = ''

  const onData = (chunk: Buffer | string): void => {
    buffer += String(chunk)
    let newlineIndex = buffer.indexOf('\n')
    while (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex).trim()
      buffer = buffer.slice(newlineIndex + 1)
      if (line) onLine(line)
      newlineIndex = buffer.indexOf('\n')
    }
  }

  stream.on('data', onData)
  return () => {
    stream.off('data', onData)
  }
}

async function ensureHelperBinary(): Promise<string> {
  const helperPath = app.isPackaged
    ? path.join(process.resourcesPath, 'native', 'sck-recorder')
    : path.join(app.getAppPath(), 'electron', 'native', 'bin', 'sck-recorder')

  try {
    await fs.access(helperPath)
    return helperPath
  } catch {
    if (app.isPackaged) {
      throw new Error(`Native recorder helper missing: ${helperPath}`)
    }
  }

  const projectRoot = app.getAppPath()
  const sourcePath = path.join(projectRoot, 'electron', 'native', 'macos', 'sck-recorder.swift')
  await fs.mkdir(path.dirname(helperPath), { recursive: true })

  await new Promise<void>((resolve, reject) => {
    const compile = spawn('xcrun', [
      'swiftc',
      '-parse-as-library',
      '-O',
      sourcePath,
      '-framework', 'ScreenCaptureKit',
      '-framework', 'AVFoundation',
      '-framework', 'CoreMedia',
      '-framework', 'CoreVideo',
      '-framework', 'CoreGraphics',
      '-framework', 'Foundation',
      '-o', helperPath,
    ], {
      cwd: projectRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stderr = ''
    compile.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })

    compile.on('error', (error) => {
      reject(error)
    })

    compile.on('exit', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(stderr.trim() || `swiftc failed with code ${code ?? 'unknown'}`))
      }
    })
  })

  await fs.chmod(helperPath, 0o755)
  return helperPath
}

function waitForProcessExit(
  processRef: ChildProcess,
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve) => {
    processRef.once('exit', (code, signal) => {
      resolve({ code, signal })
    })
  })
}

export function isNativeMacRecorderActive(): boolean {
  return Boolean(activeSession)
}

export function forceTerminateNativeMacRecorder(): void {
  const session = activeSession
  activeSession = null
  if (!session) return

  try {
    session.process.kill('SIGTERM')
  } catch {
    // ignore process teardown errors
  }

  globalThis.setTimeout(() => {
    try {
      session.process.kill('SIGKILL')
    } catch {
      // ignore process teardown errors
    }
  }, 300)
}

export async function startNativeMacRecorder(options: NativeRecorderStartOptions): Promise<{
  success: boolean
  code?: string
  message?: string
  ready?: RecorderReadyInfo
}> {
  if (process.platform !== 'darwin') {
    return { success: false, message: 'Native ScreenCaptureKit recorder is only supported on macOS.' }
  }

  clearStaleActiveSession()
  if (activeSession) {
    return { success: false, message: 'Native recorder is already active.' }
  }

  try {
    const helperPath = await ensureHelperBinary()
    const args = [
      '--output', options.outputPath,
      '--hide-cursor', options.cursorMode === 'never' ? '1' : '0',
      '--fps', String(Math.max(1, Math.min(120, Math.round(options.frameRate || 60)))),
    ]

    if (options.sourceId) {
      args.push('--source-id', options.sourceId)
    }
    if (options.displayId) {
      args.push('--display-id', options.displayId)
    }
    if (options.width && options.width > 1) {
      args.push('--width', String(Math.round(options.width)))
    }
    if (options.height && options.height > 1) {
      args.push('--height', String(Math.round(options.height)))
    }
    if (options.cameraEnabled) {
      args.push('--camera-enabled', '1')
      args.push('--camera-shape', options.cameraShape ?? 'rounded')
      const sizePercent = Math.max(14, Math.min(40, Math.round(options.cameraSizePercent ?? 22)))
      args.push('--camera-size-percent', String(sizePercent))
    }

    const helperProcess = spawn(helperPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    helperProcess.stdout.setEncoding('utf8')
    helperProcess.stderr.setEncoding('utf8')

    const exitPromise = waitForProcessExit(helperProcess)

    let readyInfo: RecorderReadyInfo | null = null
    let stderrBuffer = ''
    const helperErrorRef: { current?: RecorderHelperErrorInfo } = {}

    const cleanupStdout = collectLines(helperProcess.stdout, (line) => {
      const maybeReady = parseReadyLine(line)
      if (maybeReady) {
        readyInfo = maybeReady
      }
      if (!line.startsWith('SCK_RECORDER_READY') && !line.startsWith('SCK_RECORDER_DONE')) {
        console.log(`[sck-recorder] ${line}`)
      }
    })

    const cleanupStderr = collectLines(helperProcess.stderr, (line) => {
      stderrBuffer += `${line}\n`
      const parsed = parseHelperErrorLine(line)
      if (parsed) {
        helperErrorRef.current = parsed
      }
      console.error(`[sck-recorder] ${line}`)
    })

    const started = await new Promise<boolean>((resolve) => {
      const timeout = globalThis.setTimeout(() => {
        resolve(false)
      }, 10_000)

      const interval = globalThis.setInterval(() => {
        if (readyInfo) {
          globalThis.clearTimeout(timeout)
          globalThis.clearInterval(interval)
          resolve(true)
        }
      }, 20)

      exitPromise.then(() => {
        globalThis.clearTimeout(timeout)
        globalThis.clearInterval(interval)
        if (!readyInfo) {
          resolve(false)
        }
      }).catch(() => {
        globalThis.clearTimeout(timeout)
        globalThis.clearInterval(interval)
        resolve(false)
      })
    })

    if (!started || !readyInfo) {
      cleanupStdout()
      cleanupStderr()
      const exit = await exitPromise
      const reason = helperErrorRef.current?.message
        || stderrBuffer.trim()
        || `Helper exited before ready (code=${exit.code ?? 'null'}, signal=${exit.signal ?? 'none'})`
      return { success: false, code: helperErrorRef.current?.code, message: reason }
    }

    activeSession = {
      process: helperProcess,
      outputPath: options.outputPath,
      cursorMode: options.cursorMode,
      ready: readyInfo,
      exitPromise,
    }

    const helperPid = helperProcess.pid
    void exitPromise.finally(() => {
      if (activeSession?.process.pid === helperPid) {
        activeSession = null
      }
    })

    return {
      success: true,
      ready: readyInfo,
    }
  } catch (error) {
    return {
      success: false,
      code: 'start_exception',
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function stopNativeMacRecorder(): Promise<NativeRecorderStopResult> {
  const session = activeSession
  activeSession = null

  if (!session) {
    return { success: false, message: 'Native recorder is not active.' }
  }

  try {
    session.process.kill('SIGINT')
  } catch {
    // process may already be gone; rely on exitPromise/timeout path
  }

  const exitResult = await Promise.race([
    session.exitPromise,
    new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
      globalThis.setTimeout(() => {
        try {
          session.process.kill('SIGKILL')
        } catch {
          // process may already be gone
        }
        resolve({ code: null, signal: 'SIGKILL' })
      }, 15_000)
    }),
  ])

  let hasValidOutput = false
  try {
    const stat = await fs.stat(session.outputPath)
    hasValidOutput = stat.isFile() && stat.size >= 1024
  } catch {
    hasValidOutput = false
  }

  if (!hasValidOutput) {
    return {
      success: false,
      message: 'Native recorder output file is missing or empty.',
    }
  }

  const exitedCleanly = exitResult.code === 0
  if (!exitedCleanly) {
    console.warn(
      `[sck-recorder] helper exited with non-zero status but produced output. code=${exitResult.code ?? 'null'} signal=${exitResult.signal ?? 'none'}`,
    )
  }

  return {
    success: true,
    path: session.outputPath,
    metadata: {
      frameRate: session.ready.frameRate,
      width: session.ready.width,
      height: session.ready.height,
      mimeType: 'video/mp4',
      capturedAt: Date.now(),
      systemCursorMode: session.cursorMode,
    },
  }
}
