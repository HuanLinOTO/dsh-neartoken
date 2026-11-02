/**
 * The usage window: the site's per-model, per-bucket numbers turned into the
 * series the overview stacks, with every amount converted into the site's own
 * currency and the totals printed with its symbol.
 *
 * The two "no window" answers are asserted apart, because the page prints a
 * different sentence for each: a deployment that predates the endpoint is not
 * a site that cannot be reached, and only one of them is worth acting on.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { readUsage, type UsageRead } from './usage.ts'

/** Every request the code under test issued, in order. */
let requests: string[] = []

/**
 * Replace fetch with one that answers from a table and records the path.
 * @param answer - returns the body one request gets, or a Response to answer verbatim.
 */
function stubFetch(answer: (path: string) => unknown): void {
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = new URL(String(input))
    const path = `${url.pathname}${url.search}`
    requests.push(`${init?.method ?? 'GET'} ${path}`)
    const body = answer(path)
    if (body instanceof Response) return body
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
}

/** One day of usage as the site reports it: two models, three buckets, one quiet. */
const WINDOW = {
  success: true,
  data: {
    range: 'day',
    start_timestamp: 1_700_000_000,
    end_timestamp: 1_700_086_400,
    bucket_seconds: 3600,
    quota: 2_500_000,
    tokens: 123_456,
    models: [
      { model: 'gpt-5.6-sol', quota: 2_000_000, tokens: 100_000 },
      { model: 'glm-5.3', quota: 500_000, tokens: 23_456 },
    ],
    buckets: [
      { timestamp: 1_700_000_000, models: [{ model: 'gpt-5.6-sol', quota: 2_000_000, tokens: 100_000 }] },
      { timestamp: 1_700_003_600, models: [] },
      { timestamp: 1_700_007_200, models: [{ model: 'glm-5.3', quota: 500_000, tokens: 23_456 }] },
    ],
  },
}

/** The read under test: one key, the card's balance, and the site's money format. */
const READ: UsageRead = {
  baseURL: 'https://site.test',
  apiKey: 'k'.repeat(48),
  balance: '￥88.48',
  format: { symbol: '￥', value: (quota) => quota / 1_000_000 },
}

afterEach(() => {
  requests = []
})

describe('readUsage', () => {
  it('turns one window into the series the page stacks', async () => {
    stubFetch(() => WINDOW)
    const state = await readUsage(READ, 'day')
    expect(requests).toEqual(['GET /api/dsh/device/usage?range=day'])
    if (!state.available) throw new Error('the site answered a window')
    expect(state.currency).toBe('￥')
    expect(state.spent).toBe('￥2.50')
    expect(state.balance).toBe('￥88.48')
    expect(state.tokens).toBe(123_456)
    expect(state.bucketSeconds).toBe(3600)
    // Money is what the bands stack, so each row carries its converted cost.
    expect(state.models).toEqual([
      { model: 'gpt-5.6-sol', tokens: 100_000, cost: 2 },
      { model: 'glm-5.3', tokens: 23_456, cost: 0.5 },
    ])
    // The quiet bucket keeps its place: the columns must stay time-aligned.
    expect(state.buckets.map(bucket => bucket.models.length)).toEqual([1, 0, 1])
    expect(state.buckets[2]?.models[0]?.cost).toBe(0.5)
  })

  it('asks for the window it was given', async () => {
    stubFetch(() => WINDOW)
    await readUsage(READ, 'month')
    expect(requests).toEqual(['GET /api/dsh/device/usage?range=month'])
  })

  it('drops rows that do not name a model, and keeps the ones that do', async () => {
    stubFetch(() => ({
      success: true,
      data: {
        ...WINDOW.data,
        models: [null, { model: '', tokens: 1 }, { model: 'glm-5.3', tokens: 5 }],
        buckets: [{ timestamp: 1_700_000_000, models: [null, { model: 'glm-5.3' }] }, { models: [] }],
      },
    }))
    const state = await readUsage(READ, 'day')
    if (!state.available) throw new Error('the site answered a window')
    // A row with a name but no counts is a model that billed nothing yet.
    expect(state.models).toEqual([{ model: 'glm-5.3', tokens: 5, cost: 0 }])
    expect(state.buckets).toEqual([{ timestamp: 1_700_000_000, models: [{ model: 'glm-5.3', tokens: 0, cost: 0 }] }])
  })

  it('reads an older deployment as unsupported, not as a broken key', async () => {
    stubFetch(() => new Response(
      JSON.stringify({ error: { message: 'Invalid URL (GET /api/dsh/device/usage)' } }),
      { status: 404, headers: { 'content-type': 'application/json' } },
    ))
    expect(await readUsage(READ, 'day')).toEqual({ available: false, reason: 'unsupported' })
  })

  it('reads an unreachable site as unreachable', async () => {
    globalThis.fetch = (async () => { throw new TypeError('fetch failed') }) as typeof fetch
    expect(await readUsage(READ, 'day')).toEqual({ available: false, reason: 'unreachable' })
  })

  it('does not accept an answer without a bucket width as a window', async () => {
    stubFetch(() => ({ success: true, data: { ...WINDOW.data, bucket_seconds: 0 } }))
    expect(await readUsage(READ, 'day')).toEqual({ available: false, reason: 'unsupported' })
  })
})
