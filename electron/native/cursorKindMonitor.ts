import { app } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'

export type NativeCursorKind = 'arrow' | 'ibeam'

type CursorKindMonitorSession = {
  process: ChildProcess
  cleanupStdout: () => void
  cleanupStderr: () => void
}

let helperPathPromise: Promise<string | null> | null = null
let helperUnavailable = false
let activeSession: CursorKindMonitorSession | null = null
let activeConsumers = 0
let latestCursorKind: NativeCursorKind = 'arrow'

function parseCursorKindLine(line: string): NativeCursorKind | null {
  const normalized = line.trim().toLowerCase()
  if (normalized === 'cursor_kind ibeam' || normalized === 'ibeam') {
    return 'ibeam'
  }
  if (normalized === 'cursor_kind arrow' || normalized === 'arrow') {
    return 'arrow'
  }
  return null
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

async function ensureHelperBinary(): Promise<string | null> {
  if (process.platform !== 'darwin' || helperUnavailable) {
    return null
  }

  if (helperPathPromise) {
    return helperPathPromise
  }

  helperPathPromise = (async () => {
    const helperPath = app.isPackaged
      ? path.join(process.resourcesPath, 'native', 'cursor-kind-monitor')
      : path.join(app.getAppPath(), 'electron', 'native', 'bin', 'cursor-kind-monitor')

    try {
      await fs.access(helperPath)
      return helperPath
    } catch {
      if (app.isPackaged) {
        helperUnavailable = true
        console.warn(`Native cursor kind helper missing: ${helperPath}`)
        return null
      }
    }

    const projectRoot = app.getAppPath()
    const sourcePath = path.join(projectRoot, 'electron', 'native', 'macos', 'cursor-kind-monitor.swift')

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
          '-framework', 'CryptoKit',
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
      console.warn('Failed to prepare native cursor kind helper, using arrow cursor fallback.', error)
      return null
    }
  })()

  const helperPath = await helperPathPromise
  if (!helperPath) {
    helperPathPromise = null
  }
  return helperPath
}

export async function startNativeCursorKindMonitor(): Promise<void> {
  if (process.platform !== 'darwin') return

  activeConsumers += 1
  if (activeSession) return

  const helperPath = await ensureHelperBinary()
  if (!helperPath) return

  const helperProcess = spawn(helperPath, [], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  helperProcess.stdout.setEncoding('utf8')
  helperProcess.stderr.setEncoding('utf8')

  latestCursorKind = 'arrow'

  const cleanupStdout = collectLines(helperProcess.stdout, (line) => {
    const maybeKind = parseCursorKindLine(line)
    if (maybeKind) {
      latestCursorKind = maybeKind
      return
    }
    console.log(`[cursor-kind-monitor] ${line}`)
  })

  const cleanupStderr = collectLines(helperProcess.stderr, (line) => {
    console.error(`[cursor-kind-monitor] ${line}`)
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
}

export function stopNativeCursorKindMonitor(): void {
  if (process.platform !== 'darwin') return

  activeConsumers = Math.max(0, activeConsumers - 1)
  if (activeConsumers > 0) return

  const session = activeSession
  activeSession = null
  if (!session) return
  session.cleanupStdout()
  session.cleanupStderr()
  session.process.kill('SIGTERM')
}

export function getNativeCursorKind(): NativeCursorKind {
  return latestCursorKind
}
