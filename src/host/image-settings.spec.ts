/**
 * The image-generation setting: which picture models the site offers, and what
 * a saved choice may name. A model or group the catalog no longer has is a
 * refusal, because storing it would leave the tool pointing at a dead route.
 */
import { describe, expect, it } from 'vitest'
import { imageCatalog, NearTokenImageSettings, parseImagePatch } from './image-settings.ts'
import type { NearTokenRoute } from './pricing.ts'

/**
 * Build one catalog route.
 * @param group - the group offering the model.
 * @param model - the bare model name.
 * @param overrides - fields to replace.
 * @returns the route.
 */
function route(group: string, model: string, overrides: Partial<NearTokenRoute> = {}): NearTokenRoute {
  return {
    id: `${group}::${model}`,
    name: `${model} @ ${group}`,
    description: '分组倍率 1x',
    group,
    model,
    ...overrides,
  }
}

const CATALOG = imageCatalog([
  route('[低价][促销] GPT Image', 'gpt-image-2.5-flare', {
    description: '分组倍率 0.8x', endpoints: ['image-generation', 'openai'],
  }),
  route('[生图] GPT Image', 'gpt-image-2.5-flare', { endpoints: ['image-generation', 'openai'] }),
  route('[生图] Gemini', 'nano-banana-pro', { endpoints: ['gemini', 'openai'] }),
  route('[低价] DeepSeek', 'deepseek-v4-pro', { endpoints: ['openai'] }),
  route('[低价] 语音合成 TTS', 'tts-1-hd', { endpoints: ['openai'] }),
])

describe('imageCatalog', () => {
  it('keeps the picture models and folds their groups into one entry each', () => {
    expect(CATALOG.map(entry => entry.model)).toEqual(['gpt-image-2.5-flare', 'nano-banana-pro'])
    expect(CATALOG[0]).toEqual({
      model: 'gpt-image-2.5-flare',
      channel: 'images',
      groups: [{ group: '[低价][促销] GPT Image', ratio: '0.8x' }, { group: '[生图] GPT Image', ratio: '1x' }],
      minRatio: 0.8,
    })
  })

  it('names the request shape each model speaks', () => {
    expect(CATALOG[1]).toEqual({
      model: 'nano-banana-pro',
      channel: 'chat',
      groups: [{ group: '[生图] Gemini', ratio: '1x' }],
      minRatio: 1,
    })
  })
})

describe('parseImagePatch', () => {
  it('accepts a model with one of its own groups', () => {
    expect(parseImagePatch({
      enabled: true,
      models: { 'gpt-image-2.5-flare': '[低价][促销] GPT Image' },
    }, CATALOG)).toEqual({ enabled: true, models: { 'gpt-image-2.5-flare': '[低价][促销] GPT Image' } })
  })

  it('accepts a switch with nothing selected yet', () => {
    expect(parseImagePatch({ enabled: false, models: {} }, CATALOG)).toEqual({ enabled: false, models: {} })
  })

  it('refuses a model the site does not offer', () => {
    expect(parseImagePatch({ enabled: true, models: { 'gpt-image-9': 'x' } }, CATALOG)).toBeUndefined()
  })

  it('refuses a group that model does not route through', () => {
    expect(parseImagePatch({ enabled: true, models: { 'nano-banana-pro': '[低价] DeepSeek' } }, CATALOG))
      .toBeUndefined()
  })

  it('refuses a body without the two members it stores', () => {
    expect(parseImagePatch({ models: {} }, CATALOG)).toBeUndefined()
    expect(parseImagePatch({ enabled: 'yes', models: {} }, CATALOG)).toBeUndefined()
    expect(parseImagePatch({ enabled: true, models: [] }, CATALOG)).toBeUndefined()
    expect(parseImagePatch({ enabled: true, models: { 'gpt-image-2.5-flare': 3 } }, CATALOG)).toBeUndefined()
    expect(parseImagePatch(null, CATALOG)).toBeUndefined()
  })
})

describe('NearTokenImageSettings', () => {
  it('answers the stored value beside the site catalog', async () => {
    const settings = new NearTokenImageSettings({
      stored: () => ({ enabled: true, models: { 'nano-banana-pro': '[生图] Gemini' } }),
      catalog: async () => CATALOG,
      entryId: 'ui-neartoken-provider',
      settings: () => undefined,
    })
    expect(await settings.state()).toEqual({
      enabled: true,
      models: CATALOG,
      selection: { 'nano-banana-pro': '[生图] Gemini' },
    })
  })

  it('writes the value into the plugin entry', async () => {
    const writes: { ns: string; patch: Record<string, unknown> }[] = []
    const settings = new NearTokenImageSettings({
      stored: () => ({ enabled: false, models: {} }),
      catalog: async () => CATALOG,
      entryId: 'ui-neartoken-provider',
      settings: () => ({ update: async (ns, patch) => { writes.push({ ns, patch }) } }),
    })
    await settings.save({ enabled: true, models: { 'gpt-image-2.5-flare': '[生图] GPT Image' } })
    expect(writes).toEqual([{
      ns: 'ui-neartoken-provider',
      patch: { imageGeneration: { enabled: true, models: { 'gpt-image-2.5-flare': '[生图] GPT Image' } } },
    }])
  })

  it('refuses to pretend a save happened without a settings service', async () => {
    const settings = new NearTokenImageSettings({
      stored: () => ({ enabled: false, models: {} }),
      catalog: async () => CATALOG,
      entryId: 'ui-neartoken-provider',
      settings: () => undefined,
    })
    await expect(settings.save({ enabled: true, models: {} })).rejects.toThrow(/settings service/)
  })
})
