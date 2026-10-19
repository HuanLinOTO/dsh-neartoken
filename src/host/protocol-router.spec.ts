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

describe('wire targets', () => {
  it('addresses each API at its own path', () => {
    expect(wireFor('claude-sonnet-4.5').url('https://site.test')).toBe('https://site.test/v1/messages')
    expect(wireFor('gpt-5.2').url('https://site.test')).toBe('https://site.test/v1/responses')
    expect(wireFor('gemini-3.8-flash').url('https://site.test', 'gemini-3.8-flash'))
      .toBe('https://site.test/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse')
    expect(wireFor('grok-4.6').url('https://site.test')).toBe('https://site.test/v1/chat/completions')
  })

  it('signs with the header each API reads', () => {
    expect(wireFor('claude-sonnet-4.5').headers('k', undefined)['x-api-key']).toBe('k')
    expect(wireFor('gemini-3.8-flash').headers('k', undefined)['x-goog-api-key']).toBe('k')
    expect(wireFor('gpt-5.2').headers('k', undefined).authorization).toBe('Bearer k')
  })

  it('carries the group reference on every wire', () => {
    for (const model of ['claude-sonnet-4.5', 'gemini-3.8-flash', 'gpt-5.2', 'grok-4.6']) {
      expect(wireFor(model).headers('k', '#7')['x-neartoken-group']).toBe('#7')
    }
  })

  it('builds a body in each API own vocabulary', () => {
    const claude = wireFor('claude-sonnet-4.5').serialize(request('claude-sonnet-4.5'), 'claude-sonnet-4.5')
    expect(claude).toMatchObject({ model: 'claude-sonnet-4.5', stream: true })
    expect(claude.max_tokens).toBeTypeOf('number')

    const gemini = wireFor('gemini-3.8-flash').serialize(request('gemini-3.8-flash'), 'gemini-3.8-flash')
    expect(gemini).toMatchObject({ contents: [{ role: 'user', parts: [{ text: 'hi' }] }] })

    const gpt = wireFor('gpt-5.2').serialize(request('gpt-5.2'), 'gpt-5.2')
    expect(gpt).toMatchObject({ model: 'gpt-5.2', input: [{ role: 'user', content: 'hi' }], stream: true })
    expect(gpt).not.toHaveProperty('messages')

    const chat = wireFor('grok-4.6').serialize(request('grok-4.6'), 'grok-4.6')
    expect(chat).toMatchObject({ model: 'grok-4.6', messages: [{ role: 'user', content: 'hi' }] })
  })
})
