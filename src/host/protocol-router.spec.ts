/**
 * Which wire a model routes to, and what each wire puts on the socket: the
 * path, the credential header, and the body shape its API expects.
 */
import { describe, expect, it } from 'vitest'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import { wireFor } from './protocol-router.ts'

/** A minimal request: one user turn. */
function request(model: string): GenerateOptions {
  return {
    provider: 'NearToken',
    model,
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
  }
}

describe('wireFor', () => {
  it('routes the Claude family to the messages API', () => {
    expect(wireFor('claude-sonnet-4.5').protocol).toBe('anthropic')
    expect(wireFor('anthropic/claude-opus-4').protocol).toBe('anthropic')
  })

  it('routes the Gemini family to generateContent', () => {
    expect(wireFor('gemini-3.8-flash').protocol).toBe('genai')
    expect(wireFor('google/gemma-3-27b').protocol).toBe('genai')
  })

  it('routes GPT and the o-series to the Responses API', () => {
    expect(wireFor('gpt-5.2').protocol).toBe('responses')
    expect(wireFor('o3-mini').protocol).toBe('responses')
  })

  it('leaves everything else on chat completions', () => {
    expect(wireFor('deepseek-v4').protocol).toBe('chat')
    expect(wireFor('grok-4.6').protocol).toBe('chat')
    expect(wireFor('glm-5.3').protocol).toBe('chat')
    expect(wireFor('qwen3-max').protocol).toBe('chat')
  })

  it('ignores case and a vendor prefix', () => {
    expect(wireFor('CLAUDE-3.7-Sonnet').protocol).toBe('anthropic')
    expect(wireFor('openai/GPT-5').protocol).toBe('responses')
  })
})

describe('declared wire', () => {
  it('follows what the site declared over the model family name', () => {
    expect(wireFor('gpt-5.2', { apiStyle: 'chat' }).protocol).toBe('chat')
    expect(wireFor('grok-4.6', { apiStyle: 'responses' }).protocol).toBe('responses')
    expect(wireFor('deepseek-v4', { apiStyle: 'anthropic' }).protocol).toBe('anthropic')
    expect(wireFor('gpt-5.2', { apiStyle: 'genai' }).protocol).toBe('genai')
  })

  it('keeps the name-based choice for a route that declared nothing', () => {
    expect(wireFor('gpt-5.2', {}).protocol).toBe('responses')
    expect(wireFor('grok-4.6', { statefulResponses: true }).protocol).toBe('chat')
  })

  it('makes a Responses route stateful even when the site named no wire', () => {
    // Holding the turn is an override of its own: an operator who ticked only
    // responses_stateful gets it on a model whose name already resolves to
    // Responses, without having to declare api_style as well.
    const stateful = wireFor('gpt-5.2', { statefulResponses: true })
    expect(stateful.protocol).toBe('responses')
    expect(stateful.serialize(request('gpt-5.2'), 'gpt-5.2', new Map())).toMatchObject({ store: true })
    expect(Object.hasOwn(stateful.serialize(request('gpt-5.2'), 'gpt-5.2', new Map()), 'include')).toBe(false)
  })

  it('leaves a family that resolves elsewhere alone whatever the flag says', () => {
    expect(wireFor('claude-sonnet-4.5', { statefulResponses: true }).protocol).toBe('anthropic')
    expect(wireFor('gemini-3.8-flash', { statefulResponses: true }).protocol).toBe('genai')
  })

  it('leaves a declared non-Responses wire alone whatever the flag says', () => {
    expect(wireFor('gpt-5.2', { apiStyle: 'chat', statefulResponses: true }).protocol).toBe('chat')
  })

  it('asks for a stored turn only when the route declared stateful support', () => {
    const body = (declared: { apiStyle?: 'responses'; statefulResponses?: boolean }): Record<string, unknown> =>
      wireFor('gpt-5.2', declared).serialize(request('gpt-5.2'), 'gpt-5.2', new Map())
    expect(body({ apiStyle: 'responses' })).toMatchObject({ store: false })
    expect(Object.hasOwn(body({ apiStyle: 'responses' }), 'include')).toBe(false)
    // A stateful route keeps every turn on the site, so no ciphertext is asked for.
    const stateful = body({ apiStyle: 'responses', statefulResponses: true })
    expect(stateful).toMatchObject({ store: true })
    expect(Object.hasOwn(stateful, 'include')).toBe(false)
  })

  it('addresses and signs the stateful wire like the stateless one', () => {
    const stateful = wireFor('gpt-5.2', { apiStyle: 'responses', statefulResponses: true })
    expect(stateful.url('https://site.test', 'gpt-5.2')).toBe('https://site.test/v1/responses')
    expect(stateful.headers('k', '#7', 'sess-1')).toEqual(wireFor('gpt-5.2').headers('k', '#7', 'sess-1'))
  })
})

describe('wire targets', () => {
  it('addresses each API at its own path', () => {
    expect(wireFor('claude-sonnet-4.5').url('https://site.test', 'claude-sonnet-4.5')).toBe('https://site.test/v1/messages')
    expect(wireFor('gpt-5.2').url('https://site.test', 'gpt-5.2')).toBe('https://site.test/v1/responses')
    expect(wireFor('gemini-3.8-flash').url('https://site.test', 'gemini-3.8-flash'))
      .toBe('https://site.test/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse')
    // A vendor-prefixed id keeps its separator: the gateway routes on the path.
    expect(wireFor('google/gemini-3-flash').url('https://site.test', 'google/gemini-3-flash'))
      .toBe('https://site.test/v1beta/models/google/gemini-3-flash:streamGenerateContent?alt=sse')
    expect(wireFor('grok-4.6').url('https://site.test', 'grok-4.6')).toBe('https://site.test/v1/chat/completions')
  })

  it('signs with the header each API reads', () => {
    expect(wireFor('claude-sonnet-4.5').headers('k', undefined, undefined)['x-api-key']).toBe('k')
    expect(wireFor('gemini-3.8-flash').headers('k', undefined, undefined)['x-goog-api-key']).toBe('k')
    expect(wireFor('gpt-5.2').headers('k', undefined, undefined).authorization).toBe('Bearer k')
  })

  it('carries the group reference on every wire', () => {
    for (const model of ['claude-sonnet-4.5', 'gemini-3.8-flash', 'gpt-5.2', 'grok-4.6']) {
      expect(wireFor(model).headers('k', '#7', undefined)['x-neartoken-group']).toBe('#7')
    }
  })

  it('builds a body in each API own vocabulary', () => {
    const claude = wireFor('claude-sonnet-4.5').serialize(request('claude-sonnet-4.5'), 'claude-sonnet-4.5', new Map())
    expect(claude).toMatchObject({ model: 'claude-sonnet-4.5', stream: true })
    // The gateway does not require max_tokens; inventing one would truncate.
    expect(claude.max_tokens).toBeUndefined()

    const gemini = wireFor('gemini-3.8-flash').serialize(request('gemini-3.8-flash'), 'gemini-3.8-flash', new Map())
    expect(gemini).toMatchObject({ contents: [{ role: 'user', parts: [{ text: 'hi' }] }] })

    const gpt = wireFor('gpt-5.2').serialize(request('gpt-5.2'), 'gpt-5.2', new Map())
    expect(gpt).toMatchObject({ model: 'gpt-5.2', input: [{ role: 'user', content: 'hi' }], stream: true })
    expect(gpt).not.toHaveProperty('messages')

    const chat = wireFor('grok-4.6').serialize(request('grok-4.6'), 'grok-4.6', new Map())
    expect(chat).toMatchObject({ model: 'grok-4.6', messages: [{ role: 'user', content: 'hi' }] })
  })
})

describe('wire identity headers', () => {
  /** One model per wire, so a loop covers all four. */
  const models = ['claude-sonnet-4.5', 'gemini-3.8-flash', 'gpt-5.2', 'grok-4.6']

  it('announces the client on every wire', () => {
    for (const model of models) {
      const headers = wireFor(model).headers('k', undefined, undefined)
      expect(headers['x-dsh-client']).toContain('dsh-neartoken/')
      expect(headers).not.toHaveProperty('x-dsh-session-id')
    }
  })

  it('carries the session on every wire when the call has one', () => {
    for (const model of models) {
      expect(wireFor(model).headers('k', undefined, 'sess-1')['x-dsh-session-id']).toBe('sess-1')
    }
  })

  it('drops a session id a header value cannot carry and keeps the rest', () => {
    const headers = wireFor('grok-4.6').headers('k', '#7', '会话\n换行')
    expect(headers).not.toHaveProperty('x-dsh-session-id')
    expect(headers['x-dsh-client']).toContain('dsh-neartoken/')
    expect(headers['x-neartoken-group']).toBe('#7')
    expect(headers.authorization).toBe('Bearer k')
  })
})
