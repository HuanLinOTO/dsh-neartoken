/**
 * Refusal classification: the shared taxonomy the retry policy executes.
 *
 * The default policy retries RATE_LIMIT, SERVER, TIMEOUT, TRANSPORT, and
 * EMPTY_RESPONSE only; these tests pin each refusal onto the code that policy
 * waits out, and the ones it deliberately does not.
 */
import { describe, expect, it } from 'vitest'
import { LlmError } from '@deepseek-ai/dsh-llm'
import { gatewayError, streamFailure, transportFailure } from './wire-error.ts'

describe('gateway refusals', () => {
  it('classifies throttling as retryable RATE_LIMIT with the provider delay', () => {
    const error = gatewayError('{"error":{"message":"too many requests","type":"new_api_error"}}', 429, new Headers({ 'retry-after': '2' }))
    expect(error.code).toBe('RATE_LIMIT')
    expect(error.failure).toMatchObject({ status: 429, providerRetryAfterMs: 2000 })
    expect(error.message).toContain('too many requests')
  })

  it('classifies a gateway failure as retryable SERVER', () => {
    expect(gatewayError('bad gateway', 502).code).toBe('SERVER')
    expect(gatewayError('{"error":{"type":"overloaded_error","message":"overloaded"}}', 529).code).toBe('SERVER')
  })

  it('classifies an exhausted balance as QUOTA', () => {
    const error = gatewayError('{"error":{"message":"insufficient balance","type":"new_api_error"}}', 402)
    expect(error.code).toBe('QUOTA')
    expect(error.failure.providerRetryAfterMs).toBeUndefined()
  })

  it('classifies refused credentials as AUTH, which no retry can fix', () => {
    expect(gatewayError('unauthorized', 401).code).toBe('AUTH')
    expect(gatewayError('forbidden', 403).code).toBe('AUTH')
  })

  it('classifies a request the gateway will always reject as INVALID_REQUEST', () => {
    expect(gatewayError('unknown group reference #58', 400).code).toBe('INVALID_REQUEST')
  })

  it('recognizes the context-window wording providers use', () => {
    const error = gatewayError('{"error":{"message":"maximum context length of 100000 tokens exceeded","type":"invalid_request_error"}}', 400)
    expect(error.code).toBe('CONTEXT_WINDOW_EXCEEDED')
  })

  it('keeps an unrecognized status distinct rather than guessing', () => {
    expect(gatewayError('nope', 404).code).toBe('HTTP_404')
  })

  it('carries the request identity the gateway reported', () => {
    const error = gatewayError('boom', 500, new Headers({ 'x-request-id': 'req-7' }))
    expect(error.failure.requestId).toBe('req-7')
  })

  it('rejects nothing for a healthy-looking status class it never sees', () => {
    // 599 is still a >=500 gateway failure; the boundary is the status itself.
    expect(gatewayError('gateway timeout', 599).code).toBe('SERVER')
  })
})

describe('mid-stream and transport failures', () => {
  it('classifies a stream that died after a healthy start as retryable SERVER', () => {
    const error = streamFailure('upstream disconnected')
    expect(error.code).toBe('SERVER')
    expect(error.message).toContain('upstream disconnected')
  })

  it('classifies a request that never produced a response as retryable TRANSPORT, cause intact', () => {
    const cause = new TypeError('fetch failed', { cause: new Error('getaddrinfo ENOTFOUND llm.example') })
    const error = transportFailure(cause)
    expect(error.code).toBe('TRANSPORT')
    expect(error.message).toContain('getaddrinfo ENOTFOUND')
    expect(error.cause).toBe(cause)
  })

  it('produces LlmError values throughout', () => {
    expect(gatewayError('x', 500)).toBeInstanceOf(LlmError)
    expect(streamFailure('x')).toBeInstanceOf(LlmError)
    expect(transportFailure(new Error('x'))).toBeInstanceOf(LlmError)
  })
})
