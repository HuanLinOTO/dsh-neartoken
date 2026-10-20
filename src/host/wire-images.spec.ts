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
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
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
