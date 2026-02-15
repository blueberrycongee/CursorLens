import { describe, expect, it } from 'vitest'
import {
  buildIssueReportUrl,
  GITHUB_REPO_URL,
  GITHUB_ISSUES_URL,
  GITHUB_ISSUE_URL_MAX_LENGTH,
} from './supportLinks'

describe('buildIssueReportUrl', () => {
  it('targets this repository issue tracker', () => {
    expect(GITHUB_ISSUES_URL).toBe(`${GITHUB_REPO_URL}/issues`)
  })

  it('builds a prefilled issue URL against the configured issue tracker', () => {
    const url = buildIssueReportUrl({
      title: '[Bug] source-selector failed',
      bodyLines: ['## Summary', 'Sample body'],
    })
    const parsed = new URL(url)

    expect(`${parsed.origin}${parsed.pathname}`).toBe(`${GITHUB_ISSUES_URL}/new`)
    expect(parsed.searchParams.get('title')).toBe('[Bug] source-selector failed')
    expect(parsed.searchParams.get('body')).toBe('## Summary\nSample body')
  })

  it('truncates large issue bodies so URL stays openable', () => {
    const url = buildIssueReportUrl({
      title: '[Bug] huge payload',
      bodyLines: ['x'.repeat(GITHUB_ISSUE_URL_MAX_LENGTH * 3)],
    })
    const parsed = new URL(url)
    const body = parsed.searchParams.get('body') ?? ''

    expect(url.length).toBeLessThanOrEqual(GITHUB_ISSUE_URL_MAX_LENGTH)
    expect(body).toContain('[truncated: additional diagnostic details were omitted')
  })

  it('falls back to truncated title when title alone is too long', () => {
    const url = buildIssueReportUrl({
      title: 't'.repeat(GITHUB_ISSUE_URL_MAX_LENGTH * 2),
    })
    const parsed = new URL(url)
    const title = parsed.searchParams.get('title') ?? ''

    expect(url.length).toBeLessThanOrEqual(GITHUB_ISSUE_URL_MAX_LENGTH)
    expect(title.endsWith('...')).toBe(true)
  })
})
