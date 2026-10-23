/**
 * Which models the provider offers, and what it says they can reason at.
 *
 * The site is the only authority: what `/api/pricing` declares is the answer,
 * the operator's configuration sits on top of it, and a model nothing describes
 * is offered bare rather than with invented capabilities.
 */
import { describe, expect, it } from 'vitest'
import {
  contextWindowOf, defaultReasoningLevel, inputModalitiesOf, isChatOffering, maxTokensOf,
  reasoningLevelLabel, reasoningLevels,
} from './model-caps.ts'

describe('isChatOffering', () => {
  it('keeps a model the site declares as a chat surface', () => {
    expect(isChatOffering('brand-new-model', ['openai'])).toBe(true)
    expect(isChatOffering('brand-new-model', ['anthropic'])).toBe(true)
    expect(isChatOffering('brand-new-model', ['openai-response', 'gemini'])).toBe(true)
  })

  it('hides a media route even when the site files it under a chat surface', () => {
    expect(isChatOffering('gpt-image-2.5-flare', ['openai'])).toBe(false)
    expect(isChatOffering('gemini-3.8-flash-tts', ['openai', 'gemini'])).toBe(false)
  })

  it('hides the media models the site declares on the chat surface itself', () => {
    // The console files image, embedding, music, and video models under the same
    // openai/gemini surfaces they are really called on, so the declaration alone
    // cannot keep them out of the chat picker.
    for (const name of [
      'nano-banana-2', 'nano-banana-pro', 'lyria-3-pro-preview', 'midjourney',
      'gemini-embedding-2', 'veo-3.1', 'sd2.5-2',
    ]) expect(isChatOffering(name, ['gemini', 'openai'])).toBe(false)
  })

  it('hides the coding variant the site pairs with a twin', () => {
    expect(isChatOffering('claude-opus-5-c', ['anthropic'])).toBe(false)
    expect(isChatOffering('claude-opus-5', ['anthropic'])).toBe(true)
  })

  it('hides a model whose declared surfaces never answer chat', () => {
    expect(isChatOffering('some-video', ['openai-video'])).toBe(false)
    expect(isChatOffering('some-rerank', ['jina-rerank', 'embeddings'])).toBe(false)
  })

  it('offers an undeclared model instead of guessing at its capabilities', () => {
    // A site too old to declare surfaces must not lose its whole catalog; the
    // media and coding-twin name rules still apply.
    expect(isChatOffering('some-private-model')).toBe(true)
    expect(isChatOffering('some-private-model', [])).toBe(true)
    expect(isChatOffering('gemini-3.5-transcribe')).toBe(false)
  })
})

describe('inputModalitiesOf', () => {
  it('states what the site declares for this model', () => {
    expect(inputModalitiesOf({ reported: ['text', 'image'] })).toEqual(['text', 'image'])
    expect(inputModalitiesOf({ reported: ['text'] })).toEqual(['text'])
  })

  it('states a model the site does not describe as text-only rather than unknown', () => {
    // An absent list is what the harness reads as 'no permission', so a text
    // answer here is what keeps an image out of a request that cannot take one.
    expect(inputModalitiesOf()).toEqual(['text'])
    expect(inputModalitiesOf({})).toEqual(['text'])
    expect(inputModalitiesOf({ reported: [] })).toEqual(['text'])
  })

  it('lets the operator override the site', () => {
    expect(inputModalitiesOf({ declared: ['text', 'image'], reported: ['text'] })).toEqual(['text', 'image'])
    expect(inputModalitiesOf({ declared: ['text'], reported: ['text', 'image'] })).toEqual(['text'])
  })
})

describe('contextWindowOf', () => {
  it('prefers the operator override, then the site, then the configured fallback', () => {
    expect(contextWindowOf({ override: 1, reported: 2, fallback: 3 })).toBe(1)
    expect(contextWindowOf({ reported: 2, fallback: 3 })).toBe(2)
    expect(contextWindowOf({ fallback: 3 })).toBe(3)
  })
})

describe('maxTokensOf', () => {
  it('answers only when an explicit output ceiling exists', () => {
    expect(maxTokensOf()).toBeUndefined()
    expect(maxTokensOf(8_192)).toBe(8_192)
    expect(maxTokensOf(8_192, 65_536)).toBe(65_536)
  })
})

describe('reasoningLevels', () => {
  it('reads the levels the site declares, in publication order', () => {
    expect(reasoningLevels({ reported: ['low', 'medium', 'high', 'max'] })).toEqual(['low', 'medium', 'high', 'max'])
  })

  it('reports none for a model the site does not describe', () => {
    // An undeclared model gets no selector: a level the upstream rejects would
    // turn every request carrying it into an error.
    expect(reasoningLevels()).toBeUndefined()
    expect(reasoningLevels({})).toBeUndefined()
    expect(reasoningLevels({ reported: [] })).toBeUndefined()
  })

  it('lets the operator override the site', () => {
    expect(reasoningLevels({ declared: ['medium'], reported: ['low', 'high'] })).toEqual(['medium'])
  })
})

describe('defaultReasoningLevel', () => {
  it('prefers the middle level when the list offers one', () => {
    expect(defaultReasoningLevel(['minimal', 'low', 'medium', 'high'])).toBe('medium')
    expect(defaultReasoningLevel(['low', 'medium', 'high', 'max'])).toBe('medium')
  })

  it('falls back to the least intensive level', () => {
    expect(defaultReasoningLevel(['xhigh', 'max'])).toBe('xhigh')
  })
})

describe('reasoningLevelLabel', () => {
  it('capitalizes a level the label table does not name', () => {
    expect(reasoningLevelLabel('xhigh')).toBe('XHigh')
    expect(reasoningLevelLabel('medium')).toBe('Medium')
  })
})
