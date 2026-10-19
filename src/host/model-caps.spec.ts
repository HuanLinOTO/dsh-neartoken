/**
 * Which models the provider offers, and what it says they can reason at.
 *
 * Both answers come from the generated pi-ai table: a name outside it is not
 * offered at all, and a name inside it without levels is offered bare.
 */
import { describe, expect, it } from 'vitest'
import { defaultReasoningLevel, isOfferedModel, reasoningLevelLabel, reasoningLevels } from './model-caps.ts'

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
