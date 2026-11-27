/**
 * The browser half's refusal reading: a route failure has to reach the page as
 * the Host's own words. It used to arrive as `HTTP 500`, which told the reader
 * nothing about what broke, and the Host's empty 400 told them even less.
 */
import { describe, expect, it } from 'vitest'
import { createNearTokenApi } from './api.ts'

/**
 * @param body - the refusal body to answer.
 * @param status - the refusal status.
 * @returns a carrier that refuses once.
 */
function refusing(body: string, status: number): ReturnType<typeof createNearTokenApi> {
  return createNearTokenApi(async () => new Response(body, {
    status,
    headers: { 'content-type': 'application/json' },
  }))
}

describe('a refused route', () => {
  it('throws the whole failure the Host published', async () => {
    const published = "TypeError: cannot read properties of undefined (reading 'configured')\n    at NearTokenAccount.status"
    await expect(refusing(JSON.stringify({ code: 'internal', message: published }), 500).status())
      .rejects.toThrow(published)
  })

  it('reads a site refusal that arrives as error instead of message', async () => {
    await expect(refusing(JSON.stringify({ error: '无效的令牌' }), 401).status())
      .rejects.toThrow('无效的令牌')
  })

  it('falls back to the status code when the refusal carries no reason', async () => {
    // The Host's own fence answers an empty body; there is nothing to say but
    // the code.
    await expect(refusing('', 400).status()).rejects.toThrow('HTTP 400')
  })
})
