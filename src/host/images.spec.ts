/**
 * The picture half of the catalog: which models draw, which request shape each
 * one speaks, and how the two possible answers are read back into bytes.
 */
import { describe, expect, it } from 'vitest'
import { extractImageReply, imageChannel, isImageModel, sniffImageMediaType } from './images.ts'

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

  it('routes everything else to chat completions', () => {
    expect(imageChannel(['gemini', 'openai'])).toBe('chat')
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
