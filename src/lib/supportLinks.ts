export const GITHUB_REPO_URL = 'https://github.com/blueberrycongee/CursorLens'
export const GITHUB_ISSUES_URL = `${GITHUB_REPO_URL}/issues`

export function buildIssueReportUrl(input: {
  title?: string
  bodyLines?: string[]
}): string {
  const params = new URLSearchParams()
  const title = input.title?.trim()
  if (title) {
    params.set('title', title)
  }

  const body = (input.bodyLines ?? []).join('\n').trim()
  if (body) {
    params.set('body', body)
  }

  const serialized = params.toString()
  return serialized ? `${GITHUB_ISSUES_URL}/new?${serialized}` : `${GITHUB_ISSUES_URL}/new`
}
