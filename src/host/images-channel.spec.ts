import { describe, expect, it } from 'vitest'
import { NearTokenImageClient } from './images.ts'

/** The minimal Response surface the client reads. */
function answer(body: unknown, status = 200): Response {
  return {
    ok: status < 400,
    status,
    async json() { return body },
    async text() { return typeof body === 'string' ? body : JSON.stringify(body) },
    async arrayBuffer() { return new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer },
  } as unknown as Response
}

/**
 * The generation client over one route and one fake carrier.
 * @param send - the carrier double.
 * @param chat - serve a chat-completions picture model instead of an image-generation one.
 * @returns the client.
 */
function clientOver(send: typeof fetch, chat = false): NearTokenImageClient {
  const model = chat ? 'nano-banana-pro' : 'gpt-image-2.5-flare'
  return new NearTokenImageClient({
    baseURL: () => 'https://site.example',
    apiKey: async () => 'sk-test',
    routes: async () => [{
      id: 'promo::' + model,
      name: model + ' @ promo',
      description: '分组倍率 0.8x',
      group: 'promo',
      groupRef: '#39',
      model,
      endpoints: chat ? ['gemini', 'openai'] : ['image-generation', 'openai'],
    }],
    timeoutMs: () => 1_000,
    fetch: send,
  })
}

describe('the request each channel sends', () => {
  it('carries reference pictures and the images-only members on the images endpoint', async () => {
    const bodies: unknown[] = []
    const send = ((_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)))
      const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1])
      return Promise.resolve(answer({ data: [{ b64_json: png.toString('base64') }] }))
    }) as unknown as typeof fetch
    await clientOver(send).generate({
      model: 'gpt-image-2.5-flare',
      group: 'promo',
      prompt: 'add a red hat',
      size: '1024x1024',
      quality: 'high',
      background: 'transparent',
      images: ['data:image/png;base64,AAAA'],
    })
    expect(bodies[0]).toEqual({
      model: 'gpt-image-2.5-flare',
      prompt: 'add a red hat',
      n: 1,
      size: '1024x1024',
      quality: 'high',
      background: 'transparent',
      image: ['data:image/png;base64,AAAA'],
    })
  })

  it('sends reference pictures as chat content parts', async () => {
    const bodies: unknown[] = []
    const send = ((_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)))
      return Promise.resolve(answer({ choices: [{ message: { content: '![i](data:image/jpeg;base64,/9j/AA)' } }] }))
    }) as unknown as typeof fetch
    const image = await clientOver(send, true).generate({
      model: 'nano-banana-pro',
      group: 'promo',
      prompt: 'add a red hat',
      images: ['data:image/png;base64,AAAA'],
    })
    expect(image.mediaType).toBe('image/jpeg')
    expect(bodies[0]).toEqual({
      model: 'nano-banana-pro',
      stream: false,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'add a red hat' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
        ],
      }],
    })
  })

  it('refuses a member a chat model cannot carry', async () => {
    const send = (() => Promise.resolve(answer({}))) as unknown as typeof fetch
    await expect(clientOver(send, true).generate({
      model: 'nano-banana-pro', group: 'promo', prompt: 'x', quality: 'high', background: 'transparent',
    })).rejects.toThrow(/quality, background can only be sent to an image-generation model/)
  })

  it('leaves the chat content a plain string when there is no reference', async () => {
    const bodies: unknown[] = []
    const send = ((_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)))
      return Promise.resolve(answer({ choices: [{ message: { content: '![i](data:image/png;base64,/9j/AA)' } }] }))
    }) as unknown as typeof fetch
    await clientOver(send, true).generate({ model: 'nano-banana-pro', group: 'promo', prompt: 'a cat' })
    expect((bodies[0] as { messages: { content: unknown }[] }).messages[0]?.content).toBe('a cat')
  })
})
