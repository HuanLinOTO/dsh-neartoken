/**
 * The dispatch half's two contracts: a catalog id decodes back to the exact
 * (group, model) pair that minted it, and the group travels as the site's
 * ASCII reference rather than as a group name, which is not a legal HTTP
 * header value.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import { NearTokenAdapter, decodeRoute } from './adapter.ts'
import type { NearTokenRoute } from './pricing.ts'
import { expandRoutes, parsePricing } from './pricing.ts'

/** Every request the adapter sent during one test, newest last. */
const sent: Array<Record<string, string>> = []

/** The payload the routing fixtures expand, one referred and one unreferred group. */
const payload = {
  data: [{ model_name: 'grok-4.6', enable_groups: ['[低价] Grok', 'default'] }],
  group_refs: { '[低价] Grok': '#7' },
}

/** A minimal request: the wire writer only needs the message list. */
function request(model: string): GenerateOptions {
  return { model, messages: [], signal: undefined } as unknown as GenerateOptions
}

/**
 * Build the adapter over fixed routes, replacing fetch with one that records
 * the headers and answers an immediately-finished stream.
 * @param routes - the catalog routes this adapter serves.
 * @param enabled - the stored whitelist; empty advertises the whole catalog.
 * @returns the adapter to dispatch through.
 */
function adapterOver(routes: readonly NearTokenRoute[], enabled: readonly string[] = []): NearTokenAdapter {
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    sent.push({ ...init?.headers as Record<string, string> })
    return new Response('data: [DONE]\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } })
  }) as typeof fetch
  return new NearTokenAdapter({
    routes: async () => routes,
    enabled: () => enabled,
    apiKey: async () => 'test-key',
    baseURL: () => 'https://example.test',
  })
}

/**
 * Drive one dispatch to completion.
 * @param adapter - the adapter to stream through.
 * @param model - the catalog id to send.
 */
async function dispatch(adapter: NearTokenAdapter, model: string): Promise<void> {
  for await (const chunk of adapter.stream(request(model))) void chunk
}

afterEach(() => { sent.length = 0 })

describe('decodeRoute', () => {
  it('is the inverse of the catalog id that expandRoutes minted', () => {
    for (const route of expandRoutes(parsePricing(payload))) {
      expect(decodeRoute(route.id)).toEqual({ group: route.group, model: route.model })
    }
  })

  it('splits at the last separator, so a group name may contain one', () => {
    expect(decodeRoute('[a::b] G::m')).toEqual({ group: '[a::b] G', model: 'm' })
  })

  it('treats a bare model name as a model with no group', () => {
    expect(decodeRoute('grok-4.6')).toEqual({ model: 'grok-4.6' })
  })
})

describe('listModels', () => {
  /** Two models over two groups, so a whitelist can hide one and keep both of another's groups. */
  const catalog = {
    data: [
      { model_name: 'grok-4.6', enable_groups: ['[低价] Grok', 'default'] },
      { model_name: 'glm-5.3', enable_groups: ['default'] },
    ],
  }

  it('advertises the whole catalog when no whitelist is stored', async () => {
    const models = await adapterOver(expandRoutes(parsePricing(catalog))).listModels('neartoken')
    expect(models.map(model => model.id)).toEqual(['[低价] Grok::grok-4.6', 'default::grok-4.6', 'default::glm-5.3'])
  })

  it('keeps every group of a whitelisted model and drops the rest', async () => {
    const models = await adapterOver(expandRoutes(parsePricing(catalog)), ['grok-4.6']).listModels('neartoken')
    expect(models.map(model => model.id)).toEqual(['[低价] Grok::grok-4.6', 'default::grok-4.6'])
  })

  it('advertises nothing when the whitelist names only models the site no longer offers', async () => {
    const models = await adapterOver(expandRoutes(parsePricing(catalog)), ['retired']).listModels('neartoken')
    expect(models).toEqual([])
  })

  it('resolves metadata only for a whitelisted model', async () => {
    const adapter = adapterOver(expandRoutes(parsePricing(catalog)), ['glm-5.3'])
    expect(await adapter.resolveModel('neartoken', 'default::glm-5.3')).toMatchObject({
      id: 'default::glm-5.3', name: 'glm-5.3 @ default',
    })
    expect(await adapter.resolveModel('neartoken', 'default::grok-4.6')).toMatchObject({
      id: 'default::grok-4.6', name: 'default::grok-4.6',
    })
  })
})

describe('stream', () => {
  it('sends the ASCII group reference as the routing header', async () => {
    const routes = expandRoutes(parsePricing(payload))
    await dispatch(adapterOver(routes), '[低价] Grok::grok-4.6')
    const headers = sent[0] ?? {}
    expect(headers['x-neartoken-group']).toBe('#7')
    expect(headers['x-neartoken-group']).toMatch(/^#[0-9]+$/)
  })

  it('sends no routing header for a group that published no reference', async () => {
    const routes = expandRoutes(parsePricing(payload))
    await dispatch(adapterOver(routes), 'default::grok-4.6')
    expect(sent[0]?.['x-neartoken-group']).toBeUndefined()
  })

  it('sends the bare model name in the body, never the catalog id', async () => {
    const routes = expandRoutes(parsePricing(payload))
    let body: unknown
    globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
      body = JSON.parse(String(init?.body))
      return new Response('data: [DONE]\n\n', { status: 200 })
    }) as typeof fetch
    const adapter = new NearTokenAdapter({
      routes: async () => routes, enabled: () => [], apiKey: async () => 'test-key', baseURL: () => 'https://example.test',
    })
    await dispatch(adapter, '[低价] Grok::grok-4.6')
    expect((body as { model?: string }).model).toBe('grok-4.6')
  })
})

describe('stream wire selection', () => {
  /** The URL and body of the one request the adapter sent. */
  interface Sent { url: string; body: Record<string, unknown>; headers: Record<string, string> }

  /**
   * Dispatch one call and capture where it went.
   * @param routes - the catalog routes this adapter serves.
   * @param id - the catalog id to dispatch.
   * @returns the captured request.
   */
  async function capture(routes: readonly NearTokenRoute[], id: string): Promise<Sent> {
    const one: Sent = { url: '', body: {}, headers: {} }
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      one.url = String(input)
      one.body = JSON.parse(String(init?.body))
      one.headers = { ...init?.headers as Record<string, string> }
      return new Response('data: [DONE]\n\n', { status: 200 })
    }) as typeof fetch
    const adapter = new NearTokenAdapter({
      routes: async () => routes, enabled: () => [], apiKey: async () => 'test-key', baseURL: () => 'https://example.test',
    })
    await dispatch(adapter, id)
    return one
  }

  const catalog = { data: [
    { model_name: 'claude-sonnet-4.5', enable_groups: ['default'] },
    { model_name: 'gemini-3.8-flash', enable_groups: ['default'] },
    { model_name: 'gpt-5.2', enable_groups: ['default'] },
    { model_name: 'grok-4.6', enable_groups: ['default'] },
  ] }
  const routes = expandRoutes(parsePricing(catalog))

  it('sends Claude to the messages API', async () => {
    const one = await capture(routes, 'default::claude-sonnet-4.5')
    expect(one.url).toBe('https://example.test/v1/messages')
    expect(one.body.messages).toBeDefined()
    expect(one.headers['x-api-key']).toBe('test-key')
  })

  it('sends Gemini to generateContent', async () => {
    const one = await capture(routes, 'default::gemini-3.8-flash')
    expect(one.url).toBe('https://example.test/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse')
    expect(one.body.contents).toBeDefined()
  })

  it('sends GPT to the Responses API', async () => {
    const one = await capture(routes, 'default::gpt-5.2')
    expect(one.url).toBe('https://example.test/v1/responses')
    expect(one.body.input).toBeDefined()
    expect(one.body.messages).toBeUndefined()
  })

  it('leaves everything else on chat completions', async () => {
    const one = await capture(routes, 'default::grok-4.6')
    expect(one.url).toBe('https://example.test/v1/chat/completions')
    expect(one.body.messages).toBeDefined()
  })
})
