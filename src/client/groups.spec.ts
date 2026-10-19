/**
 * The browser half's folding contract: the catalog names the host mints are
 * split back into (model, group), one row per model, and the row routes to the
 * group the human last picked when that group still offers the model.
 */
import { describe, expect, it } from 'vitest'
import {
  chooseVariant, displayModelName, foldModels, parseGroupLabel, ratioOf, splitModelName,
} from './groups.ts'

/** One catalog model, as the shared directory reports it. */
interface Entry { readonly id: string; readonly name: string }

/** The grouped provider's catalog: two groups offering one model, plus a second model. */
const catalog: readonly Entry[] = [
  { id: '[低价] Grok::grok-4.6', name: 'grok-4.6 @ [低价] Grok' },
  { id: 'default::grok-4.6', name: 'grok-4.6 @ default' },
  { id: 'default::glm-5.3', name: 'glm-5.3 @ default' },
]

describe('splitModelName', () => {
  it('splits the group suffix off the model name', () => {
    expect(splitModelName('glm-5.3 @ [低价][满血] 国模')).toEqual({ model: 'glm-5.3', group: '[低价][满血] 国模' })
  })

  it('leaves a name without a suffix alone', () => {
    expect(splitModelName('grok-4.6')).toEqual({ model: 'grok-4.6' })
  })

  it('does not split when either side would be empty', () => {
    expect(splitModelName('glm-5.3 @ ')).toEqual({ model: 'glm-5.3 @ ' })
  })
})

describe('foldModels', () => {
  it('folds one row per model, keeping every group as a variant', () => {
    const options = foldModels('neartoken', catalog)
    expect(options.map(option => option.label)).toEqual(['grok-4.6', 'glm-5.3'])
    expect(options[0]?.variants.map(variant => variant.group)).toEqual(['[低价] Grok', 'default'])
  })

  it('keeps a 1:1 mapping for a provider whose names carry no group', () => {
    const options = foldModels('deepseek-official', catalog)
    expect(options.map(option => option.key)).toEqual(catalog.map(entry => entry.id))
    expect(options[0]?.variants[0]?.group).toBeUndefined()
  })
})

describe('chooseVariant', () => {
  it('keeps the group the human last picked when it still offers the model', () => {
    const [option] = foldModels('neartoken', catalog)
    expect(option === undefined ? undefined : chooseVariant(option, 'neartoken', 'default')?.group).toBe('default')
  })

  it('falls back to the first variant when the preferred group is gone', () => {
    const [option] = foldModels('neartoken', catalog)
    expect(option === undefined ? undefined : chooseVariant(option, 'neartoken', 'retired')?.group).toBe('[低价] Grok')
  })
})

describe('ratioOf', () => {
  it('reads the multiplier out of the catalog description', () => {
    expect(ratioOf('分组倍率 0.4x')).toBe('0.4x')
    expect(ratioOf(undefined)).toBeUndefined()
  })
})

describe('parseGroupLabel', () => {
  it('gives the site\'s tier tags their fixed hues', () => {
    expect(parseGroupLabel('[低价][反重力] Gemini')).toEqual({
      badges: [{ text: '低价', tone: 'emerald' }, { text: '反重力', tone: 'cyan' }],
      label: 'Gemini',
    })
  })

  it('derives a stable hue for a tag with no tier meaning', () => {
    const first = parseGroupLabel('[野生] Foo').badges[0]?.tone
    expect(first).toBeDefined()
    expect(parseGroupLabel('[野生] Foo').badges[0]?.tone).toBe(first)
  })

  it('leaves a name with no tags as the label alone', () => {
    expect(parseGroupLabel('default')).toEqual({ badges: [], label: 'default' })
  })
})

describe('displayModelName', () => {
  it('reads a hyphenated name as capitalized words', () => {
    expect(displayModelName('gemini-3.7-flash')).toBe('Gemini 3.7 Flash')
    expect(displayModelName('claude-opus-5-c')).toBe('Claude Opus 5 C')
  })

  it('keeps each vendor own spelling', () => {
    expect(displayModelName('gpt-5.5')).toBe('GPT 5.5')
    expect(displayModelName('gpt-6-astra')).toBe('GPT 6 Astra')
    expect(displayModelName('glm-5.3-flash')).toBe('GLM 5.3 Flash')
    expect(displayModelName('deepseek-v4-pro')).toBe('DeepSeek V4 Pro')
  })

  it('keeps the -c word, so a model stays distinguishable from its twin', () => {
    expect(displayModelName('claude-opus-5')).not.toBe(displayModelName('claude-opus-5-c'))
  })
})
