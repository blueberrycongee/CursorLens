import { app } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

type Bounds = { x: number; y: number; width: number; height: number }

const execFileAsync = promisify(execFile)

let helperBinaryPathPromise: Promise<string | null> | null = null
let helperUnavailable = false

const WINDOW_BOUNDS_SWIFT_SOURCE = `
import Foundation
import CoreGraphics

func printError(_ message: String) {
    FileHandle.standardError.write((message + "\\n").data(using: .utf8)!)
}

guard CommandLine.arguments.count >= 2, let windowId = UInt32(CommandLine.arguments[1]) else {
    printError("missing_window_id")
    exit(64)
}

let infoList = CGWindowListCopyWindowInfo([.optionIncludingWindow], windowId) as? [[String: Any]]
guard let first = infoList?.first else {
    printError("window_not_found")
    exit(66)
}

guard let bounds = first[kCGWindowBounds as String] as? [String: Any] else {
    printError("bounds_missing")
    exit(65)
}

let x = (bounds["X"] as? NSNumber)?.doubleValue ?? 0
let y = (bounds["Y"] as? NSNumber)?.doubleValue ?? 0
let width = (bounds["Width"] as? NSNumber)?.doubleValue ?? 0
let height = (bounds["Height"] as? NSNumber)?.doubleValue ?? 0

let payload: [String: Double] = [
    "x": x,
    "y": y,
    "width": width,
    "height": height,
]

if let data = try? JSONSerialization.data(withJSONObject: payload, options: []) {
    FileHandle.standardOutput.write(data)
} else {
    printError("json_encode_failed")
    exit(70)
}
`

function isFiniteBounds(value: unknown): value is Bounds {
  if (!value || typeof value !== 'object') return false
  const row = value as Partial<Bounds>
  return Number.isFinite(row.x)
    && Number.isFinite(row.y)
    && Number.isFinite(row.width)
    && Number.isFinite(row.height)
    && Number(row.width) > 0
    && Number(row.height) > 0
}

async function ensureWindowBoundsHelperBinary(): Promise<string | null> {
  if (process.platform !== 'darwin' || helperUnavailable) {
    return null
  }

  if (helperBinaryPathPromise) {
    return helperBinaryPathPromise
  }

  helperBinaryPathPromise = (async () => {
    try {
      const toolDir = path.join(app.getPath('userData'), 'native-tools')
      const sourcePath = path.join(toolDir, 'window-bounds-helper.swift')
      const binaryPath = path.join(toolDir, 'window-bounds-helper')

      await fs.mkdir(toolDir, { recursive: true })

      let binaryExists = true
      try {
        const stat = await fs.stat(binaryPath)
        binaryExists = stat.isFile()
      } catch {
        binaryExists = false
      }

      if (!binaryExists) {
        await fs.writeFile(sourcePath, WINDOW_BOUNDS_SWIFT_SOURCE, 'utf-8')
        await execFileAsync('swiftc', ['-O', sourcePath, '-o', binaryPath], {
          timeout: 15_000,
          maxBuffer: 1024 * 1024,
        })
        await fs.chmod(binaryPath, 0o755).catch(() => {})
      }

      return binaryPath
    } catch (error) {
      helperUnavailable = true
      console.warn('Failed to prepare window bounds helper, window cursor mapping falls back to heuristic.', error)
      return null
    }
  })()

  const result = await helperBinaryPathPromise
  if (!result) {
    helperBinaryPathPromise = null
  }
  return result
}

export function parseWindowIdFromSourceId(sourceId?: string | null): number | undefined {
  if (!sourceId || !sourceId.startsWith('window:')) return undefined
  const match = sourceId.match(/^window:(\d+):/)
  if (!match) return undefined
  const value = Number(match[1])
  if (!Number.isFinite(value) || value <= 0) return undefined
  return Math.floor(value)
}

export async function getWindowBoundsById(windowId: number): Promise<Bounds | null> {
  if (process.platform !== 'darwin') return null
  if (!Number.isFinite(windowId) || windowId <= 0) return null

  const binaryPath = await ensureWindowBoundsHelperBinary()
  if (!binaryPath) return null

  try {
    const { stdout } = await execFileAsync(binaryPath, [String(Math.floor(windowId))], {
      timeout: 1_200,
      maxBuffer: 64 * 1024,
    })

    const parsed = JSON.parse(stdout) as unknown
    if (!isFiniteBounds(parsed)) return null

    return {
      x: Number(parsed.x),
      y: Number(parsed.y),
      width: Math.max(1, Number(parsed.width)),
      height: Math.max(1, Number(parsed.height)),
    }
  } catch {
    return null
  }
}
