/**
 * What the wire sends: a body below the threshold goes out as the JSON text
 * itself, one past it goes out as brotli, and both decode back to the request
 * that was built.
 */
import { brotliCompressSync, brotliDecompressSync, constants } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { encodeBody, MIN_COMPRESS_BYTES, postJson } from './request-body.ts'

/**
 * A request body of exactly the given size, filled with the kind of text a
 * request carries.
 * @param bytes - exact serialized size.
 * @returns the JSON text.
 */
function bodyOf(bytes: number): string {
  const head = '{"messages":[{"role":"user","content":"'
  const tail = '"}]}'
  const filler = Math.max(0, bytes - head.length - tail.length)
  const line = 'the quick brown fox jumps over the lazy dog. '
  return head + line.repeat(Math.ceil(filler / line.length)).slice(0, filler) + tail
}

/**
 * A body of varied text, so two brotli qualities differ measurably on it.
 * @param bytes - approximate serialized size.
 * @returns the JSON text.
 */
function variedBodyOf(bytes: number): string {
  const words: string[] = []
  let length = 0
  let seed = 7
  while (length < bytes) {
    seed = (seed * 1103515245 + 12345) % 2147483648
    const word = seed.toString(36)
    words.push(word)
    length += word.length + 1
  }
  return JSON.stringify({ messages: [{ role: 'user', content: words.join(' ') }] })
}

describe('encodeBody', () => {
  it('sends a small body in the clear', async () => {
    const json = JSON.stringify({ model: 'grok-4.6', messages: [] })
    expect(await encodeBody(json)).toEqual({ body: json, headers: {}, compressed: false })
  })

  it('leaves a body under the threshold alone', async () => {
    const json = bodyOf(MIN_COMPRESS_BYTES - 1)
    expect(Buffer.byteLength(json)).toBe(MIN_COMPRESS_BYTES - 1)
    expect(await encodeBody(json)).toEqual({ body: json, headers: {}, compressed: false })
  })

  it('compresses a body at the threshold into brotli that decodes back to it', async () => {
    const json = bodyOf(MIN_COMPRESS_BYTES)
    const encoded = await encodeBody(json)
    expect(encoded.compressed).toBe(true)
    expect(encoded.headers).toEqual({ 'content-encoding': 'br' })
    expect(typeof encoded.body).not.toBe('string')
    const packed = encoded.body as Uint8Array
    expect(packed.byteLength).toBeLessThan(Buffer.byteLength(json) / 2)
    expect(brotliDecompressSync(packed).toString('utf8')).toBe(json)
  })

  it('encodes at quality 5, not at the runtime default of 11', async () => {
    const json = variedBodyOf(MIN_COMPRESS_BYTES * 8)
    const input = Buffer.from(json, 'utf8')
    const atQuality5 = brotliCompressSync(input, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } })
    // The default is 11; on a body this size it costs seconds instead of
    // milliseconds, which is why the level is pinned rather than left implicit.
    const atDefault = brotliCompressSync(input)
    expect(atDefault.byteLength).not.toBe(atQuality5.byteLength)
    const encoded = await encodeBody(json)
    expect((encoded.body as Uint8Array).byteLength).toBe(atQuality5.byteLength)
  })
})

describe('postJson', () => {
  /** One POST a fake carrier received. */
  interface Call { readonly headers: Record<string, string>, readonly body: unknown }

  /**
   * A carrier that records what it was handed and answers the given statuses in
   * order, the last one repeating.
   * @param statuses - the status each successive call is answered with.
   * @returns the carrier and the calls it received.
   */
  function carrier(statuses: readonly number[]): { send: typeof fetch, calls: Call[] } {
    const calls: Call[] = []
    const send = (async (_url: unknown, init?: RequestInit) => {
      calls.push({ headers: { ...init?.headers as Record<string, string> }, body: init?.body })
      const status = statuses[calls.length - 1] ?? statuses[statuses.length - 1] ?? 200
      return new Response(status === 200 ? '{}' : '{"error":"invalid JSON request body"}', { status })
    }) as typeof fetch
    return { send, calls }
  }

  const headers = { authorization: 'Bearer k', 'content-type': 'application/json' }
  const big = bodyOf(MIN_COMPRESS_BYTES * 4)
  const url = 'https://example.test/v1/chat/completions'

  it('posts a small body in the clear, once', async () => {
    const { send, calls } = carrier([200])
    const small = JSON.stringify({ model: 'grok-4.6' })
    const response = await postJson(send, url, { headers, json: small })
    expect(response.status).toBe(200)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.headers['content-encoding']).toBeUndefined()
    expect(calls[0]?.body).toBe(small)
  })

  it('posts a large body as brotli under the caller headers', async () => {
    const { send, calls } = carrier([200])
    await postJson(send, url, { headers, json: big })
    expect(calls[0]?.headers['content-encoding']).toBe('br')
    expect(calls[0]?.headers.authorization).toBe('Bearer k')
    expect(brotliDecompressSync(calls[0]?.body as Uint8Array).toString('utf8')).toBe(big)
  })

  it('re-posts the same body in the clear when the gateway answers 400', async () => {
    const { send, calls } = carrier([400, 200])
    const response = await postJson(send, url, { headers, json: big })
    expect(response.status).toBe(200)
    expect(calls).toHaveLength(2)
    expect(calls[1]?.headers['content-encoding']).toBeUndefined()
    expect(calls[1]?.body).toBe(big)
  })

  it('does not retry a failure the encoding cannot explain', async () => {
    const { send, calls } = carrier([500])
    const response = await postJson(send, url, { headers, json: big })
    expect(response.status).toBe(500)
    expect(calls).toHaveLength(1)
  })

  it('does not retry a 400 for a body that was never compressed', async () => {
    const { send, calls } = carrier([400])
    const response = await postJson(send, url, { headers, json: JSON.stringify({ model: 'grok-4.6' }) })
    expect(response.status).toBe(400)
    expect(calls).toHaveLength(1)
  })
})

