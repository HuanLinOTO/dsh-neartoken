/**
 * The picture half of the catalog: which models draw, which request shape each
 * one speaks, and how the two possible answers are read back into bytes.
 */
import { describe, expect, it } from 'vitest'
import { extractImageReply, imageChannel, isImageModel, NearTokenImageClient, sniffImageMediaType } from './images.ts'

describe('isImageModel', () => {
  it('accepts the picture models the catalog offers', () => {
    expect(isImageModel('gpt-image-2.5-flare', ['image-generation', 'openai'])).toBe(true)
    expect(isImageModel('nano-banana-pro', ['gemini', 'openai'])).toBe(true)
    expect(isImageModel('gemini-3-pro-image', ['gemini'])).toBe(true)
    expect(isImageModel('grok-imagine-image')).toBe(true)
  })

  it('keeps every other media route out, however its name reads', () => {
    expect(isImageModel('tts-1-hd')).toBe(false)
    expect(isImageModel('whisper-1')).toBe(false)
    expect(isImageModel('text-embedding-3-large')).toBe(false)
    expect(isImageModel('veo-3')).toBe(false)
    expect(isImageModel('gpt-5.6-luna')).toBe(false)
    expect(isImageModel('claude-opus-5-5', ['anthropic'])).toBe(false)
  })

  it('trusts an explicit image-generation surface over the name', () => {
    expect(isImageModel('some-new-model', ['image-generation'])).toBe(true)
  })
})

describe('imageChannel', () => {
  it('routes an image-generation model to the images endpoint', () => {
    expect(imageChannel(['image-generation', 'openai'])).toBe('images')
  })

  it('routes a Gemini model to its own generateContent surface', () => {
    expect(imageChannel(['gemini', 'openai'])).toBe('genai')
  })

  it('routes anything else to chat completions', () => {
    expect(imageChannel(['openai'])).toBe('chat')
    expect(imageChannel(undefined)).toBe('chat')
  })
})

describe('extractImageReply', () => {
  it('reads the images endpoint base64 answer', () => {
    expect(extractImageReply({ data: [{ b64_json: 'AAAA' }] })).toEqual({ kind: 'base64', data: 'AAAA' })
  })

  it('reads the images endpoint url answer', () => {
    expect(extractImageReply({ data: [{ url: 'https://img.example/x.png' }] }))
      .toEqual({ kind: 'url', url: 'https://img.example/x.png' })
  })

  it('reads a chat answer that embeds the picture as a data URL', () => {
    const body = { choices: [{ message: { role: 'assistant', content: '![image](data:image/jpeg;base64,/9j/AAAA)' } }] }
    expect(extractImageReply(body)).toEqual({ kind: 'base64', data: '/9j/AAAA' })
  })

  it('reads a chat answer that links the picture', () => {
    const body = { choices: [{ message: { content: '![image 1](https://image.example/a/content?expires=1)' } }] }
    expect(extractImageReply(body)).toEqual({ kind: 'url', url: 'https://image.example/a/content?expires=1' })
  })

  it('reads a chat answer whose content is a part list', () => {
    const body = { choices: [{ message: { content: [{ type: 'text', text: 'here: ![i](https://image.example/b.png)' }] } }] }
    expect(extractImageReply(body)).toEqual({ kind: 'url', url: 'https://image.example/b.png' })
  })

  it('reads the alternate images member', () => {
    expect(extractImageReply({ choices: [{ message: { images: [{ image_url: { url: 'https://image.example/c' } }] } }] }))
      .toEqual({ kind: 'url', url: 'https://image.example/c' })
    expect(extractImageReply({ choices: [{ message: { images: ['https://image.example/d'] } }] }))
      .toEqual({ kind: 'url', url: 'https://image.example/d' })
  })

  it('answers nothing for an answer without a picture', () => {
    expect(extractImageReply({ choices: [{ message: { content: 'I cannot draw that.' } }] })).toBeUndefined()
    expect(extractImageReply({ data: [] })).toBeUndefined()
    expect(extractImageReply(null)).toBeUndefined()
    expect(extractImageReply('nope')).toBeUndefined()
  })
})

describe('sniffImageMediaType', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])
  const gif = new Uint8Array([...Buffer.from('GIF89a')])
  const webp = new Uint8Array([...Buffer.from('RIFF'), 0, 0, 0, 0, ...Buffer.from('WEBP')])

  it('names the format from the bytes', () => {
    expect(sniffImageMediaType(png)).toBe('image/png')
    expect(sniffImageMediaType(jpeg)).toBe('image/jpeg')
    expect(sniffImageMediaType(gif)).toBe('image/gif')
    expect(sniffImageMediaType(webp)).toBe('image/webp')
  })

  it('answers nothing for bytes that are not a supported picture', () => {
    expect(sniffImageMediaType(new Uint8Array([1, 2, 3]))).toBeUndefined()
    expect(sniffImageMediaType(new Uint8Array([]))).toBeUndefined()
  })
})
/** The minimal Response surface the client reads. */
function answer(body: unknown, status = 200): Response {
  return {
    ok: status < 400,
    status,
    async json() { return body },
    async text() { return typeof body === 'string' ? body : JSON.stringify(body) },
    async arrayBuffer() { return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]).buffer },
  } as unknown as Response
}

/** A minimal PNG, as the site would base64 it. */
const PNG_BASE64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64')

/**
 * The generation client over one route and one fake carrier.
 * @param send - the fake HTTP carrier.
 * @param timeoutMs - the generation budget.
 * @param poll - the poll cadence; zero polls without waiting, as a test wants.
 */
function clientOver(
  send: typeof fetch, timeoutMs = 1_000, poll = { firstMs: 0, maxMs: 0 },
): NearTokenImageClient {
  return new NearTokenImageClient({
    baseURL: () => 'https://site.example',
    apiKey: async () => 'sk-test',
    routes: async () => [{
      id: 'promo::gpt-image-2.5-flare',
      name: 'gpt-image-2.5-flare @ promo',
      description: '分组倍率 0.8x',
      group: 'promo',
      groupRef: '#39',
      model: 'gpt-image-2.5-flare',
      endpoints: ['image-generation', 'openai'],
    }],
    timeoutMs: () => timeoutMs,
    poll: () => poll,
    fetch: send,
  })
}

describe('NearTokenImageClient', () => {
  it('sends the group reference and returns the picture bytes', async () => {
    const calls: { url: string; init?: RequestInit }[] = []
    const send = ((url: string, init?: RequestInit) => {
      calls.push({ url, init })
      return Promise.resolve(answer({ data: [{ b64_json: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64') }] }))
    }) as unknown as typeof fetch
    const image = await clientOver(send).generate({ model: 'gpt-image-2.5-flare', group: 'promo', prompt: 'a cat' })
    expect(image.mediaType).toBe('image/png')
    expect(calls[0]?.url).toBe('https://site.example/v1/images/tasks')
    expect((calls[0]?.init?.headers as Record<string, string>)['x-neartoken-group']).toBe('#39')
  })

  it('announces the client but no session, which an image call has none of', async () => {
    const calls: { headers: Record<string, string> }[] = []
    const send = ((_url: string, init?: RequestInit) => {
      calls.push({ headers: { ...init?.headers as Record<string, string> } })
      return Promise.resolve(answer({ data: [{ b64_json: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64') }] }))
    }) as unknown as typeof fetch
    await clientOver(send).generate({ model: 'gpt-image-2.5-flare', group: 'promo', prompt: 'a cat' })
    expect(calls[0]?.headers['x-dsh-client']).toContain('dsh-neartoken/')
    expect(calls[0]?.headers).not.toHaveProperty('x-dsh-session-id')
  })

  it('compresses the body of a request that carries a reference picture', async () => {
    const calls: { headers: Record<string, string>; body: unknown }[] = []
    const send = ((_url: string, init?: RequestInit) => {
      calls.push({ headers: { ...init?.headers as Record<string, string> }, body: init?.body })
      return Promise.resolve(answer({ data: [{ b64_json: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64') }] }))
    }) as unknown as typeof fetch
    // A reference picture is the case that makes this body big: base64 bytes in
    // a JSON string, past the compression threshold on their own.
    await clientOver(send).generate({
      model: 'gpt-image-2.5-flare', group: 'promo', prompt: 'edit this',
      images: [{ mediaType: 'image/png', data: 'A'.repeat(24_000) }],
    })
    expect(calls[0]?.headers['content-encoding']).toBe('br')
    expect(typeof calls[0]?.body).not.toBe('string')
  })


  it('explains a budget that ran out instead of surfacing the abort', async () => {
    const send = ((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(new DOMException('The operation was aborted due to timeout', 'TimeoutError'))
      })
    })) as unknown as typeof fetch
    await expect(clientOver(send, 5).generate({ model: 'gpt-image-2.5-flare', group: 'promo', prompt: 'a cat' }))
      .rejects.toThrow(/did not return an image within 0s \(imageTimeoutMs\)/)
  })

  it('reports a refusal with the status and the site\'s own words', async () => {
    const send = (() => Promise.resolve(answer('{"error":{"message":"no channel"}}', 503))) as unknown as typeof fetch
    await expect(clientOver(send).generate({ model: 'gpt-image-2.5-flare', group: 'promo', prompt: 'a cat' }))
      .rejects.toThrow(/refused gpt-image-2.5-flare with HTTP 503: .*no channel/)
  })

  it('refuses an answer that carries no picture', async () => {
    const send = (() => Promise.resolve(answer({ choices: [{ message: { content: 'nope' } }] }))) as unknown as typeof fetch
    await expect(clientOver(send).generate({ model: 'gpt-image-2.5-flare', group: 'promo', prompt: 'a cat' }))
      .rejects.toThrow(/answered without an image/)
  })
})

describe('NearTokenImageClient durable tasks', () => {
  it('waits for a submitted task and reads the picture its result carries', async () => {
    const calls: string[] = []
    const send = ((url: string) => {
      calls.push(url)
      if (url === 'https://site.example/v1/images/tasks') {
        return Promise.resolve(answer({ task_id: 'task_1', status: 'SUBMITTED' }, 202))
      }
      const polls = calls.filter(call => call.endsWith('/task_1')).length
      return Promise.resolve(polls === 1
        ? answer({ task_id: 'task_1', status: 'IN_PROGRESS', progress: '40%' })
        : answer({ task_id: 'task_1', status: 'SUCCESS', data: [{ b64_json: PNG_BASE64 }] }))
    }) as unknown as typeof fetch

    const image = await clientOver(send).generate({ model: 'gpt-image-2.5-flare', group: 'promo', prompt: 'a cat' })

    expect(image.mediaType).toBe('image/png')
    expect(calls).toEqual([
      'https://site.example/v1/images/tasks',
      'https://site.example/v1/images/tasks/task_1',
      'https://site.example/v1/images/tasks/task_1',
    ])
  })

  it('downloads the picture a finished task answers as a url', async () => {
    const send = ((url: string) => Promise.resolve(url === 'https://site.example/v1/images/tasks'
      ? answer({ task_id: 'task_2', status: 'SUBMITTED' }, 202)
      : url === 'https://site.example/v1/images/tasks/task_2'
        ? answer({ task_id: 'task_2', status: 'SUCCESS', data: [{ url: 'https://cdn.example/1.png' }] })
        : answer({}))) as unknown as typeof fetch

    const image = await clientOver(send).generate({ model: 'gpt-image-2.5-flare', group: 'promo', prompt: 'a cat' })

    expect(image.mediaType).toBe('image/png')
  })

  it('reports the reason the site gave for a failed task', async () => {
    const send = ((url: string) => Promise.resolve(url === 'https://site.example/v1/images/tasks'
      ? answer({ task_id: 'task_3', status: 'SUBMITTED' }, 202)
      : answer({
        task_id: 'task_3',
        status: 'FAILURE',
        fail_reason: 'DataInspectionFailed: content rejected',
        error: { message: 'DataInspectionFailed: content rejected' },
      }))) as unknown as typeof fetch

    await expect(clientOver(send).generate({ model: 'gpt-image-2.5-flare', group: 'promo', prompt: 'a cat' }))
      .rejects.toThrow(/reported task task_3 as FAILURE: DataInspectionFailed/)
  })

  it('falls back to the synchronous route on a site that does not know tasks', async () => {
    const calls: string[] = []
    const send = ((url: string) => {
      calls.push(url)
      return Promise.resolve(url === 'https://site.example/v1/images/tasks'
        ? answer('{"error":{"message":"not found"}}', 404)
        : answer({ data: [{ b64_json: PNG_BASE64 }] }))
    }) as unknown as typeof fetch

    const image = await clientOver(send).generate({ model: 'gpt-image-2.5-flare', group: 'promo', prompt: 'a cat' })

    expect(image.mediaType).toBe('image/png')
    expect(calls).toEqual([
      'https://site.example/v1/images/tasks',
      'https://site.example/v1/images/generations',
    ])
  })

  it('re-reads the same task through a gateway failure instead of submitting again', async () => {
    const calls: string[] = []
    const send = ((url: string) => {
      calls.push(url)
      if (url === 'https://site.example/v1/images/tasks') {
        return Promise.resolve(answer({ task_id: 'task_4', status: 'SUBMITTED' }, 202))
      }
      const polls = calls.filter(call => call.endsWith('/task_4')).length
      return Promise.resolve(polls === 1
        ? answer('{"error":{"message":"bad gateway"}}', 503)
        : answer({ task_id: 'task_4', status: 'SUCCESS', data: [{ b64_json: PNG_BASE64 }] }))
    }) as unknown as typeof fetch

    const image = await clientOver(send).generate({ model: 'gpt-image-2.5-flare', group: 'promo', prompt: 'a cat' })

    expect(image.mediaType).toBe('image/png')
    expect(calls.filter(call => call === 'https://site.example/v1/images/tasks')).toHaveLength(1)
  })

  it('polls an edit the site answered as a task, exactly like a generation', async () => {
    const calls: string[] = []
    const send = ((url: string) => {
      calls.push(url)
      if (url === 'https://site.example/v1/images/edits') {
        return Promise.resolve(answer({ task_id: 'task_6', status: 'SUBMITTED' }, 202))
      }
      const polls = calls.filter(call => call.endsWith('/task_6')).length
      return Promise.resolve(polls === 1
        ? answer({ task_id: 'task_6', status: 'IN_PROGRESS' })
        : answer({ task_id: 'task_6', status: 'SUCCESS', data: [{ b64_json: PNG_BASE64 }] }))
    }) as unknown as typeof fetch

    const image = await clientOver(send).generate({
      model: 'gpt-image-2.5-flare', group: 'promo', prompt: 'add a red hat',
      images: [{ mediaType: 'image/png', data: 'AAAA' }],
    })

    expect(image.mediaType).toBe('image/png')
    expect(calls).toEqual([
      'https://site.example/v1/images/edits',
      'https://site.example/v1/images/tasks/task_6',
      'https://site.example/v1/images/tasks/task_6',
    ])
  })

  it('reports a refused edit instead of resubmitting it as a generation', async () => {
    const calls: string[] = []
    const send = ((url: string) => {
      calls.push(url)
      return Promise.resolve(answer('{"error":{"message":"prompt was rejected"}}', 400))
    }) as unknown as typeof fetch

    await expect(clientOver(send).generate({
      model: 'gpt-image-2.5-flare', group: 'promo', prompt: 'add a red hat',
      images: [{ mediaType: 'image/png', data: 'AAAA' }],
    })).rejects.toThrow(/refused gpt-image-2.5-flare with HTTP 400: .*prompt was rejected/)
    expect(calls).toEqual(['https://site.example/v1/images/edits'])
  })

  it('stops polling when the caller cancels, leaving the task to the site', async () => {
    const controller = new AbortController()
    const calls: string[] = []
    const send = ((url: string) => {
      calls.push(url)
      if (url === 'https://site.example/v1/images/tasks') {
        return Promise.resolve(answer({ task_id: 'task_5', status: 'SUBMITTED' }, 202))
      }
      controller.abort(new Error('the turn was stopped'))
      return Promise.resolve(answer({ task_id: 'task_5', status: 'IN_PROGRESS' }))
    }) as unknown as typeof fetch

    await expect(clientOver(send).generate({
      model: 'gpt-image-2.5-flare', group: 'promo', prompt: 'a cat', signal: controller.signal,
    })).rejects.toThrow(/the turn was stopped/)
    expect(calls).toHaveLength(2)
  })
})
