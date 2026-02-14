import { useEffect } from 'react'
import { useI18n } from '@/i18n'
import { reportUserActionError } from '@/lib/userErrorFeedback'

const IGNORED_ERROR_PATTERNS: RegExp[] = [
  /ResizeObserver loop limit exceeded/i,
  /ResizeObserver loop completed with undelivered notifications/i,
]

function shouldIgnoreMessage(input: string): boolean {
  const message = input.trim()
  if (!message) return false
  return IGNORED_ERROR_PATTERNS.some((pattern) => pattern.test(message))
}

export function GlobalErrorObserver() {
  const { t } = useI18n()

  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      if (shouldIgnoreMessage(event.message || '')) {
        return
      }

      reportUserActionError({
        t,
        userMessage: t('error.unexpected'),
        error: event.error ?? event.message,
        context: 'renderer.window.error',
        details: {
          filename: event.filename,
          line: event.lineno,
          column: event.colno,
        },
        dedupeKey: `renderer-window-error:${event.filename}:${event.lineno}:${event.colno}:${event.message}`,
        dedupeMs: 6_000,
      })
    }

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason
      const message = reason instanceof Error ? reason.message : String(reason ?? '')
      if (shouldIgnoreMessage(message)) {
        return
      }

      reportUserActionError({
        t,
        userMessage: t('error.unexpected'),
        error: reason,
        context: 'renderer.window.unhandledrejection',
        dedupeKey: `renderer-unhandled-rejection:${message}`,
        dedupeMs: 6_000,
      })
    }

    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onUnhandledRejection)

    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onUnhandledRejection)
    }
  }, [t])

  return null
}
