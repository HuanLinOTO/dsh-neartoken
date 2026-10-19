/**
 * Which models the provider offers, and what it says they can reason at.
 *
 * Both answers come from the generated pi-ai table: a name outside it is not
 * offered at all, and a name inside it without levels is offered bare.
 */
import { describe, expect, it } from 'vitest'
import {
  contextWindowOf, defaultReasoningLevel, inputModalitiesOf, isChatOffering, isOfferedModel, maxTokensOf,
  reasoningLevelLabel, reasoningLevels,
} from './model-caps.ts'
import { MODEL_CONTEXT_WINDOW } from './model-caps.generated.ts'

describe('isOfferedModel', () => {
  it('hides the coding variant the site pairs with a twin', () => {
    expect(isOfferedModel('claude-opus-5-c')).toBe(false)
    expect(isOfferedModel('claude-opus-5')).toBe(true)
  })

  it('hides media routes', () => {
    expect(isOfferedModel('gpt-image-2.5-flare')).toBe(false)
    expect(isOfferedModel('gemini-3.8-flash-tts')).toBe(false)
    expect(isOfferedModel('gemini-3.5-transcribe')).toBe(false)
  })

  it('hides a chat model the catalog does not describe', () => {
    expect(isOfferedModel('glm-5.0')).toBe(false)
    expect(isOfferedModel('some-private-model')).toBe(false)
  })

  it('offers a model the deployment published ahead of the catalog', () => {
    expect(isOfferedModel('gemini-4-argon')).toBe(true)
  })
})

describe('isChatOffering', () => {
  it('keeps a model the site declares as a chat surface, even one no catalog describes', () => {
    expect(isChatOffering('brand-new-model', ['openai'])).toBe(true)
    expect(isChatOffering('brand-new-model', ['anthropic'])).toBe(true)
    expect(isChatOffering('brand-new-model', ['openai-response', 'gemini'])).toBe(true)
  })

  it('hides a media route even when the site files it under a chat surface', () => {
    expect(isChatOffering('gpt-image-2.5-flare', ['openai'])).toBe(false)
    expect(isChatOffering('gemini-3.8-flash-tts', ['openai', 'gemini'])).toBe(false)
    expect(isChatOffering('claude-opus-5-c', ['anthropic'])).toBe(false)
  })

  it('hides a model whose declared surfaces never answer chat', () => {
    expect(isChatOffering('gpt-image-2.5-flare', ['image-generation'])).toBe(false)
    expect(isChatOffering('some-video', ['openai-video'])).toBe(false)
    expect(isChatOffering('some-rerank', ['jina-rerank', 'embeddings'])).toBe(false)
  })

  it('falls back to the name rules when the site declares no surfaces', () => {
    expect(isChatOffering('claude-opus-5-c')).toBe(false)
    expect(isChatOffering('claude-opus-5', [])).toBe(true)
  })
})

describe('inputModalitiesOf', () => {
  it('states what the catalog says a model accepts', () => {
    expect(inputModalitiesOf('claude-opus-5-5')).toContain('image')
    expect(inputModalitiesOf('deepseek-v4-pro')).toEqual(['text'])
  })

  it('splits a family whose members disagree, by majority of the listings', () => {
    // One gateway claims vision for glm-5.3; its vendor, and every other
    // listing, say text. The flash sibling is the vision model of the family.
    expect(inputModalitiesOf('glm-5.3')).toEqual(['text'])
    expect(inputModalitiesOf('glm-5.3-flash')).toContain('image')
  })

  it('states a model nothing describes as text-only rather than unknown', () => {
    // An absent list is what the harness reads as "no permission", so a text
    // answer here is what keeps an image out of a request that cannot take one.
    expect(inputModalitiesOf('no-such-model-anywhere')).toEqual(['text'])
  })

  it('lets a configured list win over the catalog', () => {
    expect(inputModalitiesOf('deepseek-v4-pro', ['text', 'image'])).toEqual(['text', 'image'])
  })

  it('knows the deployment-measured model takes images', () => {
    expect(inputModalitiesOf('gemini-4-argon')).toContain('image')
  })
})

describe('contextWindowOf', () => {
  it('prefers the operator override, then the site, then the catalog, then the fallback', () => {
    const model = 'gpt-5'
    expect(contextWindowOf(model, { override: 1, reported: 2, fallback: 3 })).toBe(1)
    expect(contextWindowOf(model, { reported: 2, fallback: 3 })).toBe(2)
    expect(contextWindowOf(model, { fallback: 3 })).toBe(MODEL_CONTEXT_WINDOW[model])
    expect(contextWindowOf('no-such-model-anywhere', { fallback: 3 })).toBe(3)
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
  it('reads the catalog levels for a model that declares them', () => {
    // One model id may appear under several providers; the generated table
    // keeps the first entry that names levels, so only the set membership is
    // asserted here.
    expect(reasoningLevels('gpt-5')).toContain('xhigh')
    expect(reasoningLevels('claude-opus-5-5')).toContain('max')
  })

  it('reports none for a model without a level map anywhere', () => {
    expect(reasoningLevels('some-private-model')).toBeUndefined()
  })

  it('reads the measured levels of a model published ahead of the catalog', () => {
    // Gemini 4 rejects a token budget and the minimal/xhigh level names.
    expect(reasoningLevels('gemini-4-argon')).toEqual(['low', 'medium', 'high', 'max'])
    expect(defaultReasoningLevel(reasoningLevels('gemini-4-argon') ?? [])).toBe('medium')
  })
})

describe('defaultReasoningLevel', () => {
  it('prefers the middle level when the list offers one', () => {
    expect(defaultReasoningLevel(['minimal', 'low', 'medium', 'high'])).toBe('medium')
  })

  it('falls back to the least intensive level', () => {
    expect(defaultReasoningLevel(['xhigh', 'max'])).toBe('xhigh')
  })
})

describe('reasoningLevelLabel', () => {
  it('capitalizes a level the table does not name', () => {
    expect(reasoningLevelLabel('xhigh')).toBe('XHigh')
    expect(reasoningLevelLabel('medium')).toBe('Medium')
  })
})
