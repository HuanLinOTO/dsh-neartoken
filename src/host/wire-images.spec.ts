import { describe, expect, it } from 'vitest'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import { wireFor } from './protocol-router.ts'
import { inlineImages } from './wire-images.ts'
import type { ImageSource, WireImages } from './wire-images.ts'

/** One durable image reference, as a harness message carries it. */
const REF = { attachmentId: 'sha256:abc', mediaType: 'image/png', bytes: 3, width: 4, height: 4 }

/** The request's inlined images, keyed by the reference id. */
const IMAGES: WireImages = new Map([['sha256:abc', { mediaType: 'image/png', data: 'AAAA' }]])

/**
 * One request carrying the given content blocks.
 * @param content - the user turn's content.
 * @returns the harness request.
 */
function request(content: readonly unknown[]): GenerateOptions {
  return { messages: [{ role: 'user', content }] } as unknown as GenerateOptions
}

/** The user turn with one text block and one image block. */
const WITH_IMAGE = [{ type: 'text', text: 'what is this' }, { type: 'image', attachment: REF }]

describe('inlineImages', () => {
  it('stays empty for a request without pictures', async () => {
    const images = await inlineImages({ readImage: async () => ({ data: new Uint8Array() }) }, request([{ type: 'text', text: 'hi' }]).messages)
    expect(images.size).toBe(0)
  })

  it('inlines each distinct attachment once, as base64', async () => {
    const reads: string[] = []
    const attachments: ImageSource = {
      readImage: async (ref) => {
        reads.push(String(ref.attachmentId))
        return { data: new Uint8Array([1, 2, 3]) }
      },
    }
    const messages = [
      { role: 'user', content: WITH_IMAGE },
      { role: 'assistant', content: [{ type: 'text', text: 'hm' }] },
      { role: 'user', content: WITH_IMAGE },
    ] as never
    const images = await inlineImages(attachments, messages)
    expect(reads).toEqual(['sha256:abc'])
    expect(images.get('sha256:abc')).toEqual({ mediaType: 'image/png', data: Buffer.from([1, 2, 3]).toString('base64') })
  })

  it('fails the request instead of sending it text-only when no store is mounted', async () => {
    await expect(inlineImages(undefined, request(WITH_IMAGE).messages)).rejects.toThrow(/no attachment service is mounted/)
  })

  it('fails the request when the bytes cannot be read', async () => {
    const attachments: ImageSource = { readImage: async () => { throw new Error('gone') } }
    await expect(inlineImages(attachments, request(WITH_IMAGE).messages)).rejects.toThrow(/cannot read attachment "sha256:abc"/)
  })

  /**
   * One request carrying an image of the given intrinsic size.
   * @param width - intrinsic encoded width.
   * @param height - intrinsic encoded height.
   * @returns the request messages.
   */
  function sized(width: number, height: number) {
    return request([{ type: 'image', attachment: { ...REF, width, height } }]).messages
  }

  it('asks the store for a request version inside the configured bounds', async () => {
    const targets: Array<{ width: number; height: number; maxBytes: number }> = []
    const attachments: ImageSource = {
      readImage: async () => ({ data: new Uint8Array([9]) }),
      readImageRequest: async (_ref, target) => {
        targets.push(target)
        return { data: new Uint8Array([1, 2, 3]), mediaType: 'image/jpeg' }
      },
    }
    const images = await inlineImages(attachments, sized(4096, 2048), undefined, { maxEdge: 2048, maxBytes: 1_000 })
    // The long edge is what a visual encoder resamples by, so the short edge follows it.
    expect(targets).toEqual([{ width: 2048, height: 1024, maxBytes: 1_000 }])
    expect(images.get('sha256:abc')).toEqual({ mediaType: 'image/jpeg', data: 'AQID' })
  })

  it('keeps an image already inside the bounds at its own size', async () => {
    const targets: Array<{ width: number; height: number }> = []
    const attachments: ImageSource = {
      readImage: async () => ({ data: new Uint8Array([9]) }),
      readImageRequest: async (_ref, target) => {
        targets.push(target)
        return { data: new Uint8Array([1]), mediaType: 'image/png' }
      },
    }
    await inlineImages(attachments, sized(800, 600), undefined, { maxEdge: 2048, maxBytes: 1_000 })
    expect(targets).toEqual([{ width: 800, height: 600, maxBytes: 1_000 }])
  })

  it('sends the normalized original when the store has no request projection', async () => {
    const attachments: ImageSource = { readImage: async () => ({ data: new Uint8Array([4, 5]) }) }
    const images = await inlineImages(attachments, request(WITH_IMAGE).messages)
    expect(images.get('sha256:abc')).toEqual({ mediaType: 'image/png', data: Buffer.from([4, 5]).toString('base64') })
  })

  it('sends the normalized original when the store refuses request projection', async () => {
    const attachments: ImageSource = {
      readImage: async () => ({ data: new Uint8Array([4, 5]) }),
      readImageRequest: async () => {
        throw Object.assign(new Error('cannot derive model-request images'), { code: 'ATTACHMENT_PROJECTION_UNSUPPORTED' })
      },
    }
    const images = await inlineImages(attachments, request(WITH_IMAGE).messages)
    expect(images.get('sha256:abc')).toEqual({ mediaType: 'image/png', data: Buffer.from([4, 5]).toString('base64') })
  })

  it('fails the request when request projection breaks instead of degrading', async () => {
    const attachments: ImageSource = {
      readImage: async () => ({ data: new Uint8Array([4, 5]) }),
      readImageRequest: async () => { throw new Error('encoder exploded') },
    }
    await expect(inlineImages(attachments, request(WITH_IMAGE).messages))
      .rejects.toThrow(/cannot read attachment "sha256:abc".*encoder exploded/)
  })
})

describe('each wire sends the picture', () => {
  it('chat completions uses an image_url part', () => {
    const body = wireFor('grok-4.6').serialize(request(WITH_IMAGE), 'grok-4.6', IMAGES) as { messages: { content: unknown }[] }
    expect(body.messages[0]?.content).toEqual([
      { type: 'text', text: 'what is this' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
    ])
  })

  it('the messages API uses a base64 source block', () => {
    const body = wireFor('claude-sonnet-4.5').serialize(request(WITH_IMAGE), 'claude-sonnet-4.5', IMAGES) as { messages: { content: unknown }[] }
    expect(body.messages[0]?.content).toEqual([
      { type: 'text', text: 'what is this' },
      // The picture is the last block, so it carries the request's tail cache
      // breakpoint: the bytes are re-inlined identically on every call.
      {
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: 'AAAA' },
        cache_control: { type: 'ephemeral' },
      },
    ])
  })

  it('generateContent uses inlineData', () => {
    const body = wireFor('gemini-3.8-flash').serialize(request(WITH_IMAGE), 'gemini-3.8-flash', IMAGES) as { contents: { parts: unknown }[] }
    expect(body.contents[0]?.parts).toEqual([
      { text: 'what is this' },
      { inlineData: { mimeType: 'image/png', data: 'AAAA' } },
    ])
  })

  it('the responses API uses an input_image part', () => {
    const body = wireFor('gpt-5.2').serialize(request(WITH_IMAGE), 'gpt-5.2', IMAGES) as { input: { content: unknown }[] }
    expect(body.input[0]?.content).toEqual([
      { type: 'input_text', text: 'what is this' },
      { type: 'input_image', image_url: 'data:image/png;base64,AAAA' },
    ])
  })

  it('keeps a text-only turn as a plain string on every wire', () => {
    const text = request([{ type: 'text', text: 'hi' }])
    const chat = wireFor('grok-4.6').serialize(text, 'grok-4.6', new Map()) as { messages: { content: unknown }[] }
    expect(chat.messages[0]?.content).toBe('hi')
    const gpt = wireFor('gpt-5.2').serialize(text, 'gpt-5.2', new Map()) as { input: { content: unknown }[] }
    expect(gpt.input[0]?.content).toBe('hi')
  })
})

describe('images a tool returned', () => {
  /** The attachment service the tool-result tests inline through. */
  const attachments: ImageSource = {
    readImage: async () => ({ data: new Uint8Array([1, 2, 3]) }),
  }

  /** One read_image call and its result carrying a picture. */
  const TOOL_TURN = [
    { role: 'assistant', content: [{ type: 'tool-call', id: 'call_1', name: 'read_image', arguments: '{}' }] },
    {
      role: 'tool',
      toolCallId: 'call_1',
      content: [{ type: 'text', text: 'read 1 image' }, { type: 'image', attachment: REF }],
    },
  ]

  /**
   * One request over the tool turn.
   * @param model - the model whose wire serializes it.
   * @returns the harness request.
   */
  function toolRequest(model: string): GenerateOptions {
    return { provider: 'NearToken', model, messages: TOOL_TURN } as unknown as GenerateOptions
  }

  it('inlines the picture a tool result carries at its top level', async () => {
    const images = await inlineImages(attachments, TOOL_TURN as never)
    expect(images.get('sha256:abc')).toEqual({ mediaType: 'image/png', data: 'AQID' })
  })

  it('keeps the picture inside the Anthropic tool_result block', async () => {
    const images = await inlineImages(attachments, TOOL_TURN as never)
    const body = wireFor('claude-opus-5-5').serialize(toolRequest('claude-opus-5-5'), 'claude-opus-5-5', images)
    const messages = body.messages as Array<{ content: Array<Record<string, unknown>> }>
    const result = messages.at(-1)?.content[0] as { type: string; content: Array<Record<string, unknown>> }
    expect(result.type).toBe('tool_result')
    expect(result.content.map(part => part.type)).toEqual(['text', 'image'])
  })

  it('adds the picture as a user turn after the tool result on chat completions', async () => {
    const images = await inlineImages(attachments, TOOL_TURN as never)
    const body = wireFor('grok-4.6').serialize(toolRequest('grok-4.6'), 'grok-4.6', images)
    const messages = body.messages as Array<{ role: string; content: unknown }>
    expect(messages.map(message => message.role)).toEqual(['assistant', 'tool', 'user'])
    expect(JSON.stringify(messages.at(-1))).toContain('data:image/png;base64,AQID')
  })

  it('adds the picture as a user item on the Responses API', async () => {
    const images = await inlineImages(attachments, TOOL_TURN as never)
    const body = wireFor('gpt-5.2').serialize(toolRequest('gpt-5.2'), 'gpt-5.2', images)
    const input = body.input as Array<Record<string, unknown>>
    expect(input.map(item => item.type ?? item.role)).toEqual(['function_call', 'function_call_output', 'user'])
    expect(JSON.stringify(input.at(-1))).toContain('data:image/png;base64,AQID')
  })

  it('adds the picture as an inline part on generateContent', async () => {
    const images = await inlineImages(attachments, TOOL_TURN as never)
    const body = wireFor('gemini-3.8-flash').serialize(toolRequest('gemini-3.8-flash'), 'gemini-3.8-flash', images)
    const contents = body.contents as Array<{ parts: Array<Record<string, unknown>> }>
    const parts = contents.at(-1)?.parts ?? []
    expect(parts.some(part => part.inlineData !== undefined)).toBe(true)
  })

  /** Two tools called in parallel; only the first hands back a picture. */
  const PARALLEL_TURN = [
    {
      role: 'assistant',
      content: [
        { type: 'tool-call', id: 'call_1', name: 'read_image', arguments: '{}' },
        { type: 'tool-call', id: 'call_2', name: 'read', arguments: '{}' },
      ],
    },
    {
      role: 'tool',
      toolCallId: 'call_1',
      content: [{ type: 'text', text: 'read 1 image' }, { type: 'image', attachment: REF }],
    },
    { role: 'tool', toolCallId: 'call_2', content: [{ type: 'text', text: 'plain' }] },
  ]

  /**
   * One request over the given messages.
   * @param messages - the conversation.
   * @param model - the model whose wire serializes it.
   * @returns the harness request.
   */
  function over(messages: readonly unknown[], model: string): GenerateOptions {
    return { provider: 'NearToken', model, messages } as unknown as GenerateOptions
  }

  it('keeps a parallel tool run together on chat completions', async () => {
    const images = await inlineImages(attachments, PARALLEL_TURN as never)
    const body = wireFor('grok-4.6').serialize(over(PARALLEL_TURN, 'grok-4.6'), 'grok-4.6', images)
    const messages = body.messages as Array<{ role: string }>
    expect(messages.map(message => message.role)).toEqual(['assistant', 'tool', 'tool', 'user'])
  })

  it('keeps a parallel tool run together on the Responses API', async () => {
    const images = await inlineImages(attachments, PARALLEL_TURN as never)
    const body = wireFor('gpt-5.2').serialize(over(PARALLEL_TURN, 'gpt-5.2'), 'gpt-5.2', images)
    const input = body.input as Array<Record<string, unknown>>
    expect(input.map(item => item.type ?? item.role))
      .toEqual(['function_call', 'function_call', 'function_call_output', 'function_call_output', 'user'])
  })

  it('adds no user turn when a tool result carries text only', async () => {
    const images = await inlineImages(attachments, PARALLEL_TURN.slice(0, 2) as never)
    const chat = wireFor('grok-4.6').serialize(over([PARALLEL_TURN[0], PARALLEL_TURN[2]], 'grok-4.6'), 'grok-4.6', images)
    expect((chat.messages as Array<{ role: string }>).map(message => message.role)).toEqual(['assistant', 'tool'])
    const gpt = wireFor('gpt-5.2').serialize(over([PARALLEL_TURN[0], PARALLEL_TURN[2]], 'gpt-5.2'), 'gpt-5.2', images)
    expect((gpt.input as Array<Record<string, unknown>>).map(item => item.type ?? item.role))
      .toEqual(['function_call', 'function_call', 'function_call_output'])
  })

  it('sends no bytes for an image the session offloaded', async () => {
    const offloaded = [{ role: 'user', content: [{ type: 'image', attachment: REF, offloaded: true }] }]
    const reads: string[] = []
    const images = await inlineImages({ readImage: async (ref) => { reads.push(String(ref.attachmentId)); return { data: new Uint8Array([1]) } } }, offloaded as never)
    expect(reads).toEqual([])
    expect(images.size).toBe(0)
    const body = wireFor('grok-4.6').serialize(over(offloaded, 'grok-4.6'), 'grok-4.6', images)
    expect(JSON.stringify(body)).not.toContain('base64')
  })
})
