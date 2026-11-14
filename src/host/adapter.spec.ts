/**
 * The dispatch half's two contracts: a catalog id decodes back to the exact
 * (group, model) pair that minted it, and the group travels as the site's
 * ASCII reference rather than as a group name, which is not a legal HTTP
 * header value.
 */
import { brotliDecompressSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import { NearTokenAdapter, decodeRoute } from './adapter.ts'
import { FILE_REFERENCE_GUIDANCE, FILE_REFERENCE_GUIDANCE_ZH } from './anti-degrade.ts'
import type { NearTokenRoute } from './pricing.ts'
import { expandRoutes, parsePricing } from './pricing.ts'
import { DEFAULT_IMAGE_REQUEST_POLICY } from './wire-images.ts'

/** Every request the adapter sent during one test, newest last. */
const sent: Array<Record<string, string>> = []

/** The payload the routing fixtures expand, one referred and one unreferred group. */
const payload = {
  data: [{ model_name: 'grok-4.6', enable_groups: ['[低价] Grok', 'default'] }],
  group_refs: { '[低价] Grok': '#7' },
}

/** A minimal request: the wire writer only needs the message list and the session. */
function request(model: string, sessionId?: string): GenerateOptions {
  return { model, messages: [], signal: undefined, sessionId } as unknown as GenerateOptions
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
    defaultContextWindow: () => 200_000,
    modelOverride: () => undefined,
    attachments: () => undefined,
    imagePolicy: () => DEFAULT_IMAGE_REQUEST_POLICY,
    antiDegrade: () => false,
  })
}

/**
 * Drive one dispatch to completion.
 * @param adapter - the adapter to stream through.
 * @param model - the catalog id to send.
 * @param sessionId - the harness session the request claims, when it has one.
 */
async function dispatch(adapter: NearTokenAdapter, model: string, sessionId?: string): Promise<void> {
  for await (const chunk of adapter.stream(request(model, sessionId))) void chunk
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
      { model_name: 'grok-4.6', enable_groups: ['[低价] Grok', 'default'], input_modalities: ['text', 'image'] },
      { model_name: 'glm-5.3', enable_groups: ['default'], input_modalities: ['text'] },
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

  it('declares the input modalities of every advertised model', async () => {
    const models = await adapterOver(expandRoutes(parsePricing(catalog))).listModels('neartoken')
    // An image-capable model must say so, or the harness refuses read_image and
    // strips the picture before the request leaves.
    expect(models.find(model => model.id === 'default::grok-4.6')?.inputModalities).toContain('image')
    expect(models.find(model => model.id === 'default::glm-5.3')?.inputModalities).toContain('text')
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

describe('resolveModel capacity', () => {
  /** One model whose site row states both capacities. */
  const stated = {
    data: [{ model_name: 'grok-4.6', enable_groups: ['default'], context_window: 131_072, max_tokens: 8_192 }],
  }

  /** An adapter over routes that states one configured fact and one fallback. */
  const configured = (routes: readonly NearTokenRoute[]) => new NearTokenAdapter({
    routes: async () => routes,
    enabled: () => [],
    apiKey: async () => 'test-key',
    baseURL: () => 'https://example.test',
    defaultContextWindow: () => 64_000,
    modelOverride: (model) => model === 'grok-4.6' ? { contextWindow: 1_048_576, maxTokens: 65_536, reasoning: ['low', 'high'] } : undefined,
    attachments: () => undefined,
    imagePolicy: () => DEFAULT_IMAGE_REQUEST_POLICY,
    antiDegrade: () => false,
  })

  it('reports the capacity the site declared', async () => {
    const resolved = await adapterOver(expandRoutes(parsePricing(stated))).resolveModel('neartoken', 'default::grok-4.6')
    expect(resolved.context).toEqual({ contextWindow: 131_072 })
    expect(resolved.defaultMaxTokens).toBe(8_192)
  })

  it('lets a configured override win over the site', async () => {
    const resolved = await configured(expandRoutes(parsePricing(stated))).resolveModel('neartoken', 'default::grok-4.6')
    expect(resolved.context).toEqual({ contextWindow: 1_048_576 })
    expect(resolved.defaultMaxTokens).toBe(65_536)
    expect(resolved.reasoning?.efforts.map(effort => effort.id)).toEqual(['low', 'high'])
  })

  it('falls back to the configured capacity for a model nothing describes', async () => {
    const routes = expandRoutes(parsePricing({ data: [{ model_name: 'brand-new-model', enable_groups: ['default'] }] }))
    const resolved = await configured(routes).resolveModel('neartoken', 'default::brand-new-model')
    expect(resolved.context).toEqual({ contextWindow: 64_000 })
    // No explicit output ceiling means the request omits max_tokens entirely.
    expect(resolved.defaultMaxTokens).toBeUndefined()
    // Nothing declared an effort name, so the selector stays off.
    expect(resolved.reasoning).toBeUndefined()
    expect(resolved.inputModalities).toEqual(['text'])
  })

  it('reports the reasoning levels the site declared', async () => {
    const routes = expandRoutes(parsePricing({
      data: [
        { model_name: 'grok-4.6', enable_groups: ['default'], reasoning_levels: ['low', 'medium', 'high'] },
        { model_name: 'glm-5.3', enable_groups: ['default'] },
      ],
    }))
    const adapter = adapterOver(routes)
    const declared = await adapter.resolveModel('neartoken', 'default::grok-4.6')
    expect(declared.reasoning?.efforts.map(effort => effort.id)).toEqual(['low', 'medium', 'high'])
    expect(declared.reasoning?.defaultEffort).toBe('medium')
    const undeclared = await adapter.resolveModel('neartoken', 'default::glm-5.3')
    expect(undeclared.reasoning).toBeUndefined()
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

  it('announces the client and the session on the request the site receives', async () => {
    const routes = expandRoutes(parsePricing(payload))
    await dispatch(adapterOver(routes), 'default::grok-4.6', 'sess-01J8ZQ')
    const headers = sent[0] ?? {}
    expect(headers['x-dsh-client']).toContain('dsh-neartoken/')
    // The site's sticky-session rule reads this, and it is the same value the
    // body already carries as the prompt cache key.
    expect(headers['x-dsh-session-id']).toBe('sess-01J8ZQ')
  })

  it('sends the client alone when the call has no session', async () => {
    const routes = expandRoutes(parsePricing(payload))
    await dispatch(adapterOver(routes), 'default::grok-4.6')
    const headers = sent[0] ?? {}
    expect(headers['x-dsh-client']).toContain('dsh-neartoken/')
    expect(headers).not.toHaveProperty('x-dsh-session-id')
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
      defaultContextWindow: () => 200_000, modelOverride: () => undefined,
      attachments: () => undefined,
    imagePolicy: () => DEFAULT_IMAGE_REQUEST_POLICY,
    antiDegrade: () => false,
    })
    await dispatch(adapter, '[低价] Grok::grok-4.6')
    expect((body as { model?: string }).model).toBe('grok-4.6')
  })

  it('reports a body read that dies mid-answer as a retryable TRANSPORT failure', async () => {
    const adapter = adapterOver(expandRoutes(parsePricing(payload)))
    // The shape undici reports a dropped socket with once the response exists: a
    // bare TypeError that carries no code, so nothing downstream could classify
    // it and the turn ended as an unclassified "UNKNOWN" instead of being retried.
    globalThis.fetch = (async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"type":"x"}\n\n'))
        controller.error(new TypeError('terminated'))
      },
    }), { status: 200, headers: { 'content-type': 'text/event-stream' } })) as typeof fetch
    const reading = (async () => {
      for await (const chunk of adapter.stream(request('default::grok-4.6'))) void chunk
    })()
    await expect(reading).rejects.toMatchObject({
      code: 'TRANSPORT',
      message: expect.stringContaining('terminated'),
    })
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
      defaultContextWindow: () => 200_000, modelOverride: () => undefined,
      attachments: () => undefined,
    imagePolicy: () => DEFAULT_IMAGE_REQUEST_POLICY,
    antiDegrade: () => false,
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

describe('stream body encoding', () => {
  /** One request the adapter posted: what it sent, and how it was encoded. */
  interface Posted { readonly headers: Record<string, string>, readonly body: unknown }

  /**
   * Build an adapter whose fetch records every request and answers the given
   * statuses in order, the last one repeating.
   * @param routes - the catalog routes this adapter serves.
   * @param statuses - the status each successive request is answered with.
   * @returns the adapter and the requests it posts.
   */
  function adapterRecording(
    routes: readonly NearTokenRoute[], statuses: readonly number[],
  ): { adapter: NearTokenAdapter, posted: Posted[] } {
    const posted: Posted[] = []
    globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
      posted.push({ headers: { ...init?.headers as Record<string, string> }, body: init?.body })
      const status = statuses[posted.length - 1] ?? statuses[statuses.length - 1] ?? 200
      return status === 200
        ? new Response('data: [DONE]\n\n', { status })
        : new Response('{"error":"invalid JSON request body"}', { status })
    }) as typeof fetch
    const adapter = new NearTokenAdapter({
      routes: async () => routes, enabled: () => [], apiKey: async () => 'test-key', baseURL: () => 'https://example.test',
      defaultContextWindow: () => 200_000, modelOverride: () => undefined,
      attachments: () => undefined, imagePolicy: () => DEFAULT_IMAGE_REQUEST_POLICY,
      antiDegrade: () => false,
    })
    return { adapter, posted }
  }

  /**
   * A request large enough that its body is worth compressing.
   * @param id - the catalog id to dispatch.
   * @returns the harness request.
   */
  function bigRequest(id: string): GenerateOptions {
    return {
      model: id,
      signal: undefined,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'the quick brown fox. '.repeat(2_000) }] }],
    } as unknown as GenerateOptions
  }

  const routes = expandRoutes(parsePricing(payload))

  it('sends a body past the threshold as brotli that decodes back to the request', async () => {
    const { adapter, posted } = adapterRecording(routes, [200])
    for await (const chunk of adapter.stream(bigRequest('[低价] Grok::grok-4.6'))) void chunk
    const one = posted[0]
    expect(one?.headers['content-encoding']).toBe('br')
    const json = brotliDecompressSync(one?.body as Uint8Array).toString('utf8')
    expect(JSON.parse(json).model).toBe('grok-4.6')
  })

  it('leaves a small body in the clear', async () => {
    const { adapter, posted } = adapterRecording(routes, [200])
    await dispatch(adapter, 'default::grok-4.6')
    expect(posted[0]?.headers['content-encoding']).toBeUndefined()
    expect(typeof posted[0]?.body).toBe('string')
  })

  it('re-sends the same body in the clear when the gateway rejects the encoding', async () => {
    const { adapter, posted } = adapterRecording(routes, [400, 200])
    for await (const chunk of adapter.stream(bigRequest('[低价] Grok::grok-4.6'))) void chunk
    expect(posted).toHaveLength(2)
    expect(posted[0]?.headers['content-encoding']).toBe('br')
    expect(posted[1]?.headers['content-encoding']).toBeUndefined()
    expect(typeof posted[1]?.body).toBe('string')
    expect(JSON.parse(posted[1]?.body as string).model).toBe('grok-4.6')
  })
})


describe('stream anti-degradation', () => {
  /** One gemini-4 model and one from another family, so the switch's scope is testable. */
  const routes = expandRoutes(parsePricing({ data: [
    { model_name: 'gemini-4.6-pro', enable_groups: ['default'] },
    { model_name: 'grok-4.6', enable_groups: ['default'] },
  ] }))

  /**
   * Send one request with the switch in a given state.
   * @param antiDegrade - the switch state the adapter reads.
   * @param id - the catalog id to dispatch.
   * @param extra - further request members, such as the tool set.
   * @returns the request body the adapter posted, parsed.
   */
  async function postedBody(
    antiDegrade: boolean, id: string, extra: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    let posted: Record<string, unknown> = {}
    globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
      posted = JSON.parse(String(init?.body)) as Record<string, unknown>
      return new Response('data: [DONE]\n\n', { status: 200 })
    }) as typeof fetch
    const adapter = new NearTokenAdapter({
      routes: async () => routes, enabled: () => [], apiKey: async () => 'test-key', baseURL: () => 'https://example.test',
      defaultContextWindow: () => 200_000, modelOverride: () => undefined,
      attachments: () => undefined, imagePolicy: () => DEFAULT_IMAGE_REQUEST_POLICY,
      antiDegrade: () => antiDegrade,
    })
    const call = {
      model: id,
      system: `Rules. ${FILE_REFERENCE_GUIDANCE}`,
      messages: [{ role: 'user', content: [{ type: 'text', text: FILE_REFERENCE_GUIDANCE }] }],
      signal: undefined,
      ...extra,
    } as unknown as GenerateOptions
    for await (const chunk of adapter.stream(call)) void chunk
    return posted
  }

  /** The text one genai system instruction or content part carries. */
  function systemText(body: Record<string, unknown>): string | undefined {
    const parts = (body.systemInstruction as { parts: { text: string }[] } | undefined)?.parts
    return parts?.[0]?.text
  }

  it('rewrites the guidance of a gemini-4 request while the switch is on', async () => {
    const body = await postedBody(true, 'default::gemini-4.6-pro')
    expect(systemText(body)).toBe(`Rules. ${FILE_REFERENCE_GUIDANCE_ZH}`)
    expect(JSON.stringify(body.contents)).toContain(FILE_REFERENCE_GUIDANCE_ZH)
    expect(JSON.stringify(body)).not.toContain('Tokens prefixed with @')
  })

  it('leaves the guidance English while the switch is off', async () => {
    const body = await postedBody(false, 'default::gemini-4.6-pro')
    expect(systemText(body)).toBe(`Rules. ${FILE_REFERENCE_GUIDANCE}`)
  })

  it('rewrites a body whose tool schema the harness handed over frozen', async () => {
    // The harness freezes a tool's parameter schema, so writing a member back —
    // even with the value it already holds — throws "Cannot assign to read only
    // property 'type'". The swap therefore runs on the serialized body.
    const parameters = Object.freeze({ type: 'object', properties: Object.freeze({}) })
    const body = await postedBody(true, 'default::gemini-4.6-pro', {
      tools: [{ name: 'read', description: FILE_REFERENCE_GUIDANCE, parameters }],
    })
    const declarations = (body.tools as { functionDeclarations: { description: string }[] }[])[0]?.functionDeclarations
    expect(declarations?.[0]?.description).toBe(FILE_REFERENCE_GUIDANCE_ZH)
  })

  it('leaves another family alone even while the switch is on', async () => {
    const body = await postedBody(true, 'default::grok-4.6')
    const messages = JSON.stringify(body.messages)
    expect(messages).toContain('Tokens prefixed with @')
    expect(messages).not.toContain(FILE_REFERENCE_GUIDANCE_ZH)
  })
})
