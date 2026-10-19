/**
 * The generate_image tool's own decisions: which model a call reaches, and what
 * happens when the operator enabled none.
 */
import { describe, expect, it } from 'vitest'
import { formatGenerateImageOutput, resolveImageModel } from './image-tool.ts'

describe('resolveImageModel', () => {
  const selection = {
    'gpt-image-2.5-flare': '[低价][促销] GPT Image',
    'nano-banana-pro': '[生图] Gemini',
  }

  it('uses the first enabled model when the caller names none', () => {
    expect(resolveImageModel(selection)).toEqual({ model: 'gpt-image-2.5-flare', group: '[低价][促销] GPT Image' })
  })

  it('honours the model the caller named', () => {
    expect(resolveImageModel(selection, 'nano-banana-pro')).toEqual({ model: 'nano-banana-pro', group: '[生图] Gemini' })
  })

  it('names the enabled models when the call asks for another one', () => {
    expect(() => resolveImageModel(selection, 'gpt-6-astra'))
      .toThrow(/"gpt-6-astra" is not an enabled image model; enabled models: gpt-image-2.5-flare, nano-banana-pro/)
  })

  it('refuses a call that has no model at all', () => {
    expect(() => resolveImageModel({})).toThrow(/no image model is enabled/)
  })
})

describe('formatGenerateImageOutput', () => {
  it('states the model, the group, and the picture facts', () => {
    const text = formatGenerateImageOutput({
      model: 'gpt-image-2.5-flare',
      group: '[低价][促销] GPT Image',
      image: {
        attachmentId: 'sha256:abc',
        mediaType: 'image/png',
        bytes: 451_792,
        width: 1024,
        height: 1024,
        name: 'gpt-image-2.5-flare.png',
      },
    })
    expect(text).toContain('<model>gpt-image-2.5-flare</model>')
    expect(text).toContain('<group>[低价][促销] GPT Image</group>')
    expect(text).toContain('image/png image, 1024x1024 px, 451792 bytes')
  })
})
