/**
 * The Exa client's own decisions: which group pays, what body leaves, and how a
 * refusal reaches the caller.
 */
import { describe, expect, it, vi } from 'vitest'
import type { NearTokenRoute } from './pricing.ts'
import { cutAt, NearTokenExaClient, refusalMessage, resolveExaGroup, searchBody, contentsBody } from './exa-client.ts'

/** One catalog route, as the pricing load expands it. */
function route(model: string, group: string, groupRef?: string): NearTokenRoute {
  return {
    id: `${group}::${model}`,
    name: `${model} @ ${group}`,
    description: '',
    group,
    model,
    ...groupRef === undefined ? {} : { groupRef },
  }
}

const bothRoutes = [
  route('exa-search', '[低价] Exa', '#1'),
  route('exa-search', '[满血] Exa', '#2'),
  route('exa-contents', '[低价] Exa', '#1'),
]

/** One client over a stub carrier. */
function clientWith(send: typeof fetch, routes: readonly NearTokenRoute[] = bothRoutes): NearTokenExaClient {
  return new NearTokenExaClient({
    baseURL: () => 'https://site.test',
    apiKey: async () => 'sk-test',
    routes: async () => routes,
    timeoutMs: () => 5_000,
    fetch: send,
  })
}

describe('resolveExaGroup', () => {
  it('takes the catalog first offering when the caller names none', () => {
    expect(resolveExaGroup(bothRoutes, 'exa-search')).toEqual({ group: '[低价] Exa', groupRef: '#1' })
  })

  it('honours the group the caller named', () => {
    expect(resolveExaGroup(bothRoutes, 'exa-search', '[满血] Exa')).toEqual({ group: '[满血] Exa', groupRef: '#2' })
  })

  it('names the groups when the call asks for one that does not offer the model', () => {
    expect(() => resolveExaGroup(bothRoutes, 'exa-search', 'free'))
      .toThrow(/"free"; groups offering it: \[低价\] Exa, \[满血\] Exa/)
  })

  it('explains that the site needs a channel when the model is absent', () => {
    expect(() => resolveExaGroup([], 'exa-search'))
      .toThrow(/this site does not offer exa-search: an administrator has to add an Exa channel/)
  })
})

describe('searchBody', () => {
  it('asks for excerpts at the character budget and keeps the filters it was given', () => {
    expect(searchBody({
      query: 'harness',
      type: 'deep',
      numResults: 5,
      maxCharacters: 1_200,
      includeDomains: ['docs.exa.ai'],
      startPublishedDate: '2026-01-01T00:00:00.000Z',
    })).toEqual({
      query: 'harness',
      type: 'deep',
      numResults: 5,
      contents: { highlights: { maxCharacters: 1_200 } },
      includeDomains: ['docs.exa.ai'],
      startPublishedDate: '2026-01-01T00:00:00.000Z',
    })
  })

  it('omits empty domain filters rather than sending an empty list', () => {
    const body = searchBody({ query: 'q', type: 'auto', numResults: 8, maxCharacters: 500, includeDomains: [] })
    expect(body).not.toHaveProperty('includeDomains')
    expect(body).not.toHaveProperty('excludeDomains')
  })
})

describe('contentsBody', () => {
  it('names the view it asks for and sends the URLs as ids', () => {
    expect(contentsBody({
      urls: ['https://a.example', 'https://b.example'],
      mode: 'text',
      maxCharacters: 2_000,
    })).toEqual({
      ids: ['https://a.example', 'https://b.example'],
      text: { maxCharacters: 2_000 },
    })
  })
})

describe('refusalMessage', () => {
  it('reads a gateway envelope', () => {
    expect(refusalMessage({ error: { message: 'insufficient quota' } }, 403, '')).toBe('HTTP 403: insufficient quota')
  })

  it('reads the vendor envelope', () => {
    expect(refusalMessage({ error: 'Invalid request body', tag: 'INVALID_REQUEST_BODY' }, 400, ''))
      .toBe('HTTP 400: Invalid request body')
  })

  it('falls back to the raw body when nothing is structured', () => {
    expect(refusalMessage(undefined, 502, '<html>bad gateway</html>')).toBe('HTTP 502: <html>bad gateway</html>')
  })
})

describe('cutAt', () => {
  it('leaves text inside the budget alone', () => {
    expect(cutAt('  short  ', 100)).toBe('short')
  })

  it('marks the cut so the model knows it is partial', () => {
    const cut = cutAt('x'.repeat(50), 10)
    expect(cut).toContain('…[cut at 10 characters]')
    expect(cut.startsWith('xxxxxxxxxx')).toBe(true)
  })
})

describe('NearTokenExaClient', () => {
  it('sends the vendor body to the relay search path with the group reference', async () => {
    const send = vi.fn(async () => new Response(JSON.stringify({
      requestId: 'req-1',
      results: [{ url: 'https://a.example', title: 'A', highlights: ['first', 'second'] }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }))

    const result = await clientWith(send).search({ query: 'harness', type: 'auto', numResults: 5, maxCharacters: 400 })

    expect(result.group).toBe('[低价] Exa')
    expect(result.requestId).toBe('req-1')
    expect(result.results).toEqual([
      { url: 'https://a.example', title: 'A', snippet: 'first\n…\nsecond' },
    ])
    const [url, init] = send.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://site.test/v1/exa/search')
    expect((init.headers as Record<string, string>)['x-neartoken-group']).toBe('#1')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk-test')
    expect(JSON.parse(String(init.body))).toEqual({
      query: 'harness',
      type: 'auto',
      numResults: 5,
      contents: { highlights: { maxCharacters: 400 } },
    })
  })

  it('bills a fetch under the contents model and reads the requested view', async () => {
    const send = vi.fn(async () => new Response(JSON.stringify({
      requestId: 'req-2',
      results: [{ id: 'https://a.example', title: 'A', text: 'whole page' }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }))

    const result = await clientWith(send).contents({ urls: ['https://a.example'], mode: 'text', maxCharacters: 900 })

    expect(result.pages).toEqual([{ url: 'https://a.example', title: 'A', content: 'whole page' }])
    const [url, init] = send.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://site.test/v1/exa/contents')
    expect(JSON.parse(String(init.body))).toEqual({
      ids: ['https://a.example'],
      text: { maxCharacters: 900 },
    })
  })

  it('carries the site refusal into the thrown error', async () => {
    const send = vi.fn(async () => new Response(JSON.stringify({ error: { message: 'model price not configured' } }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    }))

    await expect(clientWith(send).search({ query: 'q', type: 'auto', numResults: 3, maxCharacters: 100 }))
      .rejects.toThrow(/HTTP 400: model price not configured/)
  })
})
