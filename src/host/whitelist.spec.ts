/**
 * The model whitelist's three contracts: an empty list advertises everything,
 * a stored list filters by bare model name, and a save writes the list into
 * this plugin's own profile entry through Settings — which is what makes it
 * survive a restart.
 */
import { describe, expect, it } from 'vitest'
import type { NearTokenRoute } from './pricing.ts'
import {
  NearTokenWhitelist, parseEnabled, parseMeta, selectedRoutes, summarizeModels,
} from './whitelist.ts'
import type { WhitelistSettings } from './whitelist.ts'

/** Two models over two groups, one group publishing a ratio caption. */
const ROUTES: readonly NearTokenRoute[] = [
  { id: '[低价] Grok::grok-4.6', name: 'grok-4.6 @ [低价] Grok', description: '分组倍率 0.1x', group: '[低价] Grok', groupRef: '#7', model: 'grok-4.6' },
  { id: 'default::grok-4.6', name: 'grok-4.6 @ default', description: '分组倍率 1x', group: 'default', model: 'grok-4.6' },
  { id: 'default::glm-5.3', name: 'glm-5.3 @ default', description: '分组倍率 2x', group: 'default', model: 'glm-5.3' },
]

/**
 * Build a whitelist over in-memory facts and a recording settings service.
 * @param enabled - the stored list handed to the whitelist.
 * @param meta - the stored meta overrides handed to the whitelist.
 * @param settings - the settings service a save reaches, when one exists.
 * @returns the whitelist and the writes it made.
 */
function whitelistOver(
  enabled: readonly string[] = [],
  meta: Readonly<Record<string, import('../protocol.ts').NearTokenModelMeta>> = {},
  settings: WhitelistSettings | undefined = undefined,
): { whitelist: NearTokenWhitelist; writes: { ns: string; patch: Record<string, unknown> }[] } {
  const writes: { ns: string; patch: Record<string, unknown> }[] = []
  const recorder: WhitelistSettings = settings ?? {
    async update(ns, patch) { writes.push({ ns, patch }) },
  }
  return {
    whitelist: new NearTokenWhitelist({
      enabled: () => enabled,
      meta: () => meta,
      routes: async () => ROUTES,
      entryId: 'ui-neartoken-provider',
      settings: () => recorder,
    }),
    writes,
  }
}

describe('selectedRoutes', () => {
  it('keeps the whole catalog when no whitelist is stored', () => {
    expect(selectedRoutes(ROUTES, [])).toBe(ROUTES)
  })

  it('keeps every group of a whitelisted model', () => {
    expect(selectedRoutes(ROUTES, ['grok-4.6']).map(route => route.id)).toEqual([
      '[低价] Grok::grok-4.6', 'default::grok-4.6',
    ])
  })

  it('drops a model the site no longer offers', () => {
    expect(selectedRoutes(ROUTES, ['retired'])).toEqual([])
  })
})

describe('summarizeModels', () => {
  it('folds one entry per model, in catalog order, with every group beside it', () => {
    expect(summarizeModels(ROUTES)).toEqual([
      {
        model: 'grok-4.6',
        groups: [{ group: '[低价] Grok', ratio: '0.1x' }, { group: 'default', ratio: '1x' }],
        minRatio: 0.1,
      },
      { model: 'glm-5.3', groups: [{ group: 'default', ratio: '2x' }], minRatio: 2 },
    ])
  })

  it('reports the cheapest of a model\'s groups, not the first', () => {
    const reversed = summarizeModels([ROUTES[1]!, ROUTES[0]!])
    expect(reversed[0]?.minRatio).toBe(0.1)
  })

  it('omits the ratio when a route carries no caption for it', () => {
    const [entry] = summarizeModels([{ ...ROUTES[2]!, description: 'no multiplier here' }])
    expect(entry?.groups).toEqual([{ group: 'default' }])
    expect(entry?.minRatio).toBeUndefined()
  })
})

describe('parseEnabled', () => {
  it('accepts a list of model names, trimmed and de-duplicated in order', () => {
    expect(parseEnabled([' glm-5.3 ', 'grok-4.6', 'glm-5.3'])).toEqual(['glm-5.3', 'grok-4.6'])
  })

  it('accepts the empty list, which is how "show everything" is stored', () => {
    expect(parseEnabled([])).toEqual([])
  })

  it.each([
    ['not an array', 'glm-5.3'],
    ['a non-string entry', ['glm-5.3', 3]],
    ['an empty name', ['  ']],
    ['an over-long name', ['m'.repeat(201)]],
  ])('rejects %s', (_label, value) => {
    expect(parseEnabled(value)).toBeUndefined()
  })
})

describe('parseMeta', () => {
  it('accepts per-model facts with any mix of the three members', () => {
    expect(parseMeta({
      'grok-4.6': { contextWindow: 500_000 },
      'glm-5.3': { maxTokens: 8_192, input: ['text', 'image'] },
    })).toEqual({
      'grok-4.6': { contextWindow: 500_000 },
      'glm-5.3': { maxTokens: 8_192, input: ['text', 'image'] },
    })
  })

  it('drops a model whose facts end up empty, which is how a removal is stated', () => {
    expect(parseMeta({ 'grok-4.6': {}, 'glm-5.3': { maxTokens: 4_096 } })).toEqual({ 'glm-5.3': { maxTokens: 4_096 } })
  })

  it('de-duplicates the modality names it accepts', () => {
    expect(parseMeta({ m: { input: ['image', 'image', 'text'] } })).toEqual({ m: { input: ['image', 'text'] } })
  })

  it.each([
    ['not an object', 'x'],
    ['a non-object member', { m: 3 }],
    ['a fractional count', { m: { contextWindow: 1.5 } }],
    ['a non-positive count', { m: { maxTokens: 0 } }],
    ['an unknown member', { m: { contextWindows: 5 } }],
    ['a non-array input', { m: { input: 'text' } }],
    ['an empty input array', { m: { input: [] } }],
    ['an unknown modality', { m: { input: ['audio'] } }],
    ['an over-long name', { [ 'm'.repeat(201) ]: { maxTokens: 5 } }],
  ])('rejects %s', (_label, value) => {
    expect(parseMeta(value)).toBeUndefined()
  })
})

describe('NearTokenWhitelist', () => {
  it('reports every model beside the stored list', async () => {
    const { whitelist } = whitelistOver(['grok-4.6'])
    const state = await whitelist.state()
    expect(state.enabled).toEqual(['grok-4.6'])
    expect(state.models.map(entry => entry.model)).toEqual(['grok-4.6', 'glm-5.3'])
  })

  it('reports no whitelist for a plugin whose configuration never carried one', async () => {
    const { whitelist } = whitelistOver()
    expect((await whitelist.state()).enabled).toEqual([])
  })

  it('writes the list into the profile entry this plugin owns', async () => {
    const { whitelist, writes } = whitelistOver()
    await whitelist.save(['glm-5.3'], undefined)
    expect(writes).toEqual([{ ns: 'ui-neartoken-provider', patch: { enabledModels: ['glm-5.3'] } }])
  })

  it('writes the list and the meta overrides in the same profile write', async () => {
    const { whitelist, writes } = whitelistOver()
    await whitelist.save(['glm-5.3'], { 'glm-5.3': { contextWindow: 500_000, input: ['text'] } })
    expect(writes).toEqual([{
      ns: 'ui-neartoken-provider',
      patch: {
        enabledModels: ['glm-5.3'],
        modelMeta: { 'glm-5.3': { contextWindow: 500_000, input: ['text'] } },
      },
    }])
  })

  it('writes an empty list to clear the whitelist', async () => {
    const { whitelist, writes } = whitelistOver(['glm-5.3'])
    await whitelist.save([], undefined)
    expect(writes).toEqual([{ ns: 'ui-neartoken-provider', patch: { enabledModels: [] } }])
  })

  it('reports the stored meta overrides beside the catalog', async () => {
    const { whitelist } = whitelistOver(['grok-4.6'], { 'grok-4.6': { contextWindow: 500_000 } })
    expect((await whitelist.state()).meta).toEqual({ 'grok-4.6': { contextWindow: 500_000 } })
  })

  it('fails loud when the composition has no settings service', async () => {
    const withoutSettings = new NearTokenWhitelist({
      enabled: () => [],
      meta: () => ({}),
      routes: async () => ROUTES,
      entryId: 'ui-neartoken-provider',
      settings: () => undefined,
    })
    await expect(withoutSettings.save([], undefined)).rejects.toThrow('settings service')
  })
})
