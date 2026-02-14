import { toast } from 'sonner'
import { buildIssueReportUrl } from './supportLinks'

type Translator = (key: string, params?: Record<string, string | number>) => string

type ReportUserActionErrorInput = {
  t: Translator
  userMessage: string
  error?: unknown
  context: string
  details?: Record<string, unknown>
  issueTitle?: string
  dedupeKey?: string
  dedupeMs?: number
}

const recentErrorsByKey = new Map<string, number>()

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.trim()
  }
  if (typeof error === 'string' && error.trim().length > 0) {
    return error.trim()
  }
  if (error === null || error === undefined) {
    return 'Unknown error'
  }

  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

function normalizeErrorStack(error: unknown): string | null {
  if (error instanceof Error && typeof error.stack === 'string' && error.stack.trim().length > 0) {
    return error.stack
  }
  return null
}

function serializeDetails(details?: Record<string, unknown>): string {
  if (!details || Object.keys(details).length === 0) {
    return 'none'
  }

  try {
    return JSON.stringify(details, null, 2)
  } catch {
    return String(details)
  }
}

async function openReportUrl(t: Translator, url: string): Promise<void> {
  try {
    if (window.electronAPI?.openExternalUrl) {
      const result = await window.electronAPI.openExternalUrl(url)
      if (result.success) {
        return
      }
      throw new Error(result.error || 'openExternalUrl returned unsuccessful result')
    }

    window.open(url, '_blank', 'noopener,noreferrer')
  } catch (error) {
    console.error('Failed to open issue report URL:', error)
    toast.error(t('error.reportOpenFailed'))
  }
}

function shouldDedupeToast(key?: string, dedupeMs = 4_000): boolean {
  const normalized = (key ?? '').trim()
  if (!normalized) return false

  const now = Date.now()
  const previousAt = recentErrorsByKey.get(normalized)
  if (previousAt && now - previousAt < dedupeMs) {
    return true
  }

  recentErrorsByKey.set(normalized, now)
  return false
}

export function reportUserActionError(input: ReportUserActionErrorInput): string {
  if (shouldDedupeToast(input.dedupeKey, input.dedupeMs)) {
    return ''
  }

  const now = Date.now()
  const errorId = `CL-${now.toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`
  const errorMessage = normalizeErrorMessage(input.error)
  const errorStack = normalizeErrorStack(input.error)

  const issueTitle = input.issueTitle?.trim() || `[Bug] ${input.context}`
  const issueLines = [
    '## Summary',
    input.userMessage,
    '',
    '## Reference',
    `- Error ID: ${errorId}`,
    `- Context: ${input.context}`,
    `- Time: ${new Date(now).toISOString()}`,
    `- User Agent: ${window.navigator.userAgent}`,
    '',
    '## Error Message',
    errorMessage,
    '',
    '## Extra Details',
    serializeDetails(input.details),
  ]

  if (errorStack) {
    issueLines.push('', '## Stack', '```', errorStack, '```')
  }

  const issueUrl = buildIssueReportUrl({
    title: issueTitle,
    bodyLines: issueLines,
  })

  toast.error(input.userMessage, {
    description: `${input.t('error.reference', { id: errorId })}\n${errorMessage}`,
    duration: 12_000,
    action: {
      label: input.t('error.reportAction'),
      onClick: () => {
        void openReportUrl(input.t, issueUrl)
      },
    },
  })

  console.error(`[${errorId}] ${input.context}`, input.error)
  return errorId
}
