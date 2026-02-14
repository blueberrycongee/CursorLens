import { app } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'

export type NativeMouseButtonTransition = {
  pressed: boolean
  monotonicMs: number
}

type MouseButtonMonitorSession = {
  process: ChildProcess
  cleanupStdout: () => void
  cleanupStderr: () => void
}

const TRANSITION_PATTERN = /^left_button\s+(down|up)\s+(\d+)$/i

let helperPathPromise: Promise<string | null> | null = null
let helperUnavailable = false
let activeSession: MouseButtonMonitorSession | null = null
let activeConsumers = 0
let transitionQueue: NativeMouseButtonTransition[] = []

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

function parseTransitionLine(line: string): NativeMouseButtonTransition | null {
  const match = TRANSITION_PATTERN.exec(line.trim())
  if (!match) return null

  const state = match[1]?.toLowerCase()
  const monotonicMs = Number(match[2])
  if (!Number.isFinite(monotonicMs) || monotonicMs < 0) {
    return null
  }

  return {
    pressed: state === 'down',
    monotonicMs: Math.round(monotonicMs),
  }
}

async function ensureHelperBinary(): Promise<string | null> {
  if (process.platform !== 'darwin' || helperUnavailable) {
    return null
  }

  if (helperPathPromise) {
    return helperPathPromise
  }

  helperPathPromise = (async () => {
    const helperPath = app.isPackaged
      ? path.join(process.resourcesPath, 'native', 'mouse-button-monitor')
      : path.join(app.getAppPath(), 'electron', 'native', 'bin', 'mouse-button-monitor')

    try {
      await fs.access(helperPath)
      return helperPath
    } catch {
      if (app.isPackaged) {
        helperUnavailable = true
        console.warn(`Native mouse button helper missing: ${helperPath}`)
        return null
      }
    }

    const projectRoot = app.getAppPath()
    const sourcePath = path.join(projectRoot, 'electron', 'native', 'macos', 'mouse-button-monitor.swift')

    try {
      await fs.mkdir(path.dirname(helperPath), { recursive: true })
      await new Promise<void>((resolve, reject) => {
        const compile = spawn('xcrun', [
          'swiftc',
          '-parse-as-library',
          '-O',
          sourcePath,
          '-framework', 'Foundation',
          '-framework', 'AppKit',
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
    } catch (error) {
      helperUnavailable = true
      console.warn('Failed to prepare native mouse button helper, click detection will use heuristic fallback.', error)
      return null
    }
  })()

  const helperPath = await helperPathPromise
  if (!helperPath) {
    helperPathPromise = null
  }
  return helperPath
}

export async function startNativeMouseButtonMonitor(): Promise<boolean> {
  if (process.platform !== 'darwin') return false

  activeConsumers += 1
  if (activeSession) return true

  const helperPath = await ensureHelperBinary()
  if (!helperPath) return false

  transitionQueue = []
  const helperProcess = spawn(helperPath, [], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  helperProcess.stdout.setEncoding('utf8')
  helperProcess.stderr.setEncoding('utf8')

  const cleanupStdout = collectLines(helperProcess.stdout, (line) => {
    const transition = parseTransitionLine(line)
    if (transition) {
      transitionQueue.push(transition)
      if (transitionQueue.length > 8_000) {
        transitionQueue.splice(0, 1_000)
      }
      return
    }
    console.log(`[mouse-button-monitor] ${line}`)
  })

  const cleanupStderr = collectLines(helperProcess.stderr, (line) => {
    console.error(`[mouse-button-monitor] ${line}`)
  })

  helperProcess.once('exit', () => {
    if (!activeSession || activeSession.process !== helperProcess) return
    activeSession.cleanupStdout()
    activeSession.cleanupStderr()
    activeSession = null
  })

  activeSession = {
    process: helperProcess,
    cleanupStdout,
    cleanupStderr,
  }

  return true
}

export function stopNativeMouseButtonMonitor(): void {
  if (process.platform !== 'darwin') return

  activeConsumers = Math.max(0, activeConsumers - 1)
  if (activeConsumers > 0) return

  const session = activeSession
  activeSession = null
  if (!session) {
    transitionQueue = []
    return
  }

  session.cleanupStdout()
  session.cleanupStderr()
  session.process.kill('SIGTERM')
  transitionQueue = []
}

export function drainNativeMouseButtonTransitions(): NativeMouseButtonTransition[] {
  if (transitionQueue.length === 0) return []
  const transitions = transitionQueue
  transitionQueue = []
  return transitions
}
