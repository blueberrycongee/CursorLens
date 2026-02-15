export const GITHUB_REPO_URL = 'https://github.com/blueberrycongee/CursorLens'
export const GITHUB_ISSUE_REPO_URL = GITHUB_REPO_URL
export const GITHUB_ISSUES_URL = `${GITHUB_ISSUE_REPO_URL}/issues`
export const GITHUB_ISSUE_URL_MAX_LENGTH = 7_500

const BODY_TRUNCATION_NOTE =
  '\n\n[truncated: additional diagnostic details were omitted to keep this issue URL openable]'
const TITLE_TRUNCATION_SUFFIX = '...'

function buildIssueNewUrl(title?: string, body?: string): string {
  const params = new URLSearchParams()
  if (title) {
    params.set('title', title)
  }
  if (body) {
    params.set('body', body)
  }

  const serialized = params.toString()
  return serialized ? `${GITHUB_ISSUES_URL}/new?${serialized}` : `${GITHUB_ISSUES_URL}/new`
}

function truncateBodyToFit(title: string | undefined, body: string): string | null {
  const bodyWithNote = (prefix: string) => `${prefix.trimEnd()}${BODY_TRUNCATION_NOTE}`
  if (buildIssueNewUrl(title, BODY_TRUNCATION_NOTE).length > GITHUB_ISSUE_URL_MAX_LENGTH) {
    return null
  }

  let low = 0
  let high = body.length
  let best: string | null = null
  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    const candidate = bodyWithNote(body.slice(0, mid))
    if (buildIssueNewUrl(title, candidate).length <= GITHUB_ISSUE_URL_MAX_LENGTH) {
      best = candidate
      low = mid + 1
    } else {
      high = mid - 1
    }
  }
  return best
}

function truncateTitleToFit(title: string): string | null {
  if (buildIssueNewUrl(title).length <= GITHUB_ISSUE_URL_MAX_LENGTH) {
    return title
  }
  if (buildIssueNewUrl(TITLE_TRUNCATION_SUFFIX).length > GITHUB_ISSUE_URL_MAX_LENGTH) {
    return null
  }

  let low = 0
  let high = title.length
  let best: string | null = null
  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    const candidate = `${title.slice(0, mid).trimEnd()}${TITLE_TRUNCATION_SUFFIX}`
    if (buildIssueNewUrl(candidate).length <= GITHUB_ISSUE_URL_MAX_LENGTH) {
      best = candidate
      low = mid + 1
    } else {
      high = mid - 1
    }
  }
  return best
}

export function buildIssueReportUrl(input: {
  title?: string
  bodyLines?: string[]
}): string {
  const title = input.title?.trim()
  const body = (input.bodyLines ?? []).join('\n').trim()

  const fullUrl = buildIssueNewUrl(title, body)
  if (fullUrl.length <= GITHUB_ISSUE_URL_MAX_LENGTH) {
    return fullUrl
  }

  if (body) {
    const truncatedBody = truncateBodyToFit(title, body)
    if (truncatedBody) {
      return buildIssueNewUrl(title, truncatedBody)
    }
  }

  if (title) {
    const truncatedTitle = truncateTitleToFit(title)
    if (truncatedTitle) {
      return buildIssueNewUrl(truncatedTitle)
    }
  }

  return `${GITHUB_ISSUES_URL}/new`
}
