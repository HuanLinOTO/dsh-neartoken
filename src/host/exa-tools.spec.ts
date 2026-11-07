/**
 * The Exa tools' own decisions: which group a call bills to, how the operator's
 * budget bounds a result count, and what the model reads back.
 */
import { describe, expect, it } from 'vitest'
import type { ExaToolSettings } from './exa-tools.ts'
import { boundResultCount, formatFetchOutput, formatSearchOutput, pickExaGroup } from './exa-tools.ts'

const settings: ExaToolSettings = {
  enabled: true,
  group: '[低价] Exa',
  maxResults: 8,
  maxCharacters: 4_000,
}

describe('pickExaGroup', () => {
  it("uses the operator's group when the caller names none", () => {
    expect(pickExaGroup(settings)).toBe('[低价] Exa')
  })

  it('lets the caller reach another priced group', () => {
    expect(pickExaGroup(settings, '[满血] Exa')).toBe('[满血] Exa')
  })

  it('leaves the choice to the catalog when the operator stored no group', () => {
    expect(pickExaGroup({ ...settings, group: '' })).toBeUndefined()
  })
})

describe('boundResultCount', () => {
  it("defaults to the operator's ceiling", () => {
    expect(boundResultCount(settings)).toBe(8)
  })

  it('keeps a smaller request', () => {
    expect(boundResultCount(settings, 3)).toBe(3)
  })

  it('clamps a request above the ceiling, because cost grows with it', () => {
    expect(boundResultCount(settings, 50)).toBe(8)
  })

  it('refuses to bill for zero results', () => {
    expect(boundResultCount(settings, 0)).toBe(1)
  })
})

describe('formatSearchOutput', () => {
  it('states the group and one numbered hit per result', () => {
    const text = formatSearchOutput({
      group: '[低价] Exa',
      results: [
        { url: 'https://a.example', title: 'A page', publishedDate: '2026-01-02', snippet: 'line one\nline two' },
        { url: 'https://b.example' },
      ],
    })
    expect(text).toContain('<group>[低价] Exa</group>')
    expect(text).toContain('count="2"')
    expect(text).toContain('1. A page')
    expect(text).toContain('https://a.example · 2026-01-02')
    expect(text).toContain('   line one\n   line two')
    expect(text).toContain('2. https://b.example')
  })

  it('says so when nothing matched', () => {
    expect(formatSearchOutput({ group: 'g', results: [] })).toContain('No page matched this query.')
  })
})

describe('formatFetchOutput', () => {
  it('wraps each page in its own element with the facts it has', () => {
    const text = formatFetchOutput({
      group: 'g',
      pages: [{ url: 'https://a.example', title: 'A "quoted" page', content: 'body' }],
    })
    expect(text).toContain('<page url="https://a.example" title="A &quot;quoted&quot; page">')
    expect(text).toContain('body')
  })

  it('says so when no page carried content', () => {
    expect(formatFetchOutput({ group: 'g', pages: [] })).toContain('The pages carried no readable content.')
  })
})
