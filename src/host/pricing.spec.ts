/**
 * The pricing half's two contracts: `group_refs` decides whether a route can
 * carry group intent at all, and the catalog id it mints is what the adapter
 * decodes back at dispatch. Both are asserted against one payload shaped like
 * the site's answer, including the non-latin1 group names it really uses.
 */
import { describe, expect, it } from 'vitest'
import { expandRoutes, parsePricing } from './pricing.ts'

/** One pricing answer with a referred group, an unreferred one, and a ratio table. */
const payload = {
  data: [{ model_name: 'grok-4.6', enable_groups: ['[低价] Grok', 'default'] }],
  group_ratio: { '[低价] Grok': 0.1, default: 1 },
  usable_group: { default: '默认分组' },
  group_refs: { '[低价] Grok': '#7', default: 'default' },
}

describe('parsePricing', () => {
  it('keeps only reference-shaped values out of group_refs', () => {
    const pricing = parsePricing(payload)
    expect(pricing.groupRefs['[低价] Grok']).toBe('#7')
    expect(pricing.groupRefs.default).toBeUndefined()
  })

  it('reads the ratio and description tables it consumes', () => {
    const pricing = parsePricing(payload)
    expect(pricing.groupRatio['[低价] Grok']).toBe(0.1)
    expect(pricing.groupDescription.default).toBe('默认分组')
  })

  it('ignores a payload whose rows are not model rows', () => {
    const pricing = parsePricing({ data: [{ model_name: 1 }, { enable_groups: [] }, 'row'] })
    expect(pricing.models).toEqual([])
  })
})

describe('declared capacities and surfaces', () => {
  it('reads the capacities an operator maintained in the console', () => {
    const pricing = parsePricing({ data: [{
      model_name: 'm', enable_groups: ['g'], context_window: 200_000, max_tokens: 64_000,
    }] })
    expect(pricing.models[0]).toMatchObject({ contextWindow: 200_000, maxTokens: 64_000 })
  })

  it('ignores a capacity that is not a positive integer', () => {
    const pricing = parsePricing({ data: [{
      model_name: 'm', enable_groups: ['g'], context_window: 0, max_tokens: '64000',
    }] })
    expect(pricing.models[0]?.contextWindow).toBeUndefined()
    expect(pricing.models[0]?.maxTokens).toBeUndefined()
  })

  it('carries the declared surfaces onto every group route of one model', () => {
    const routes = expandRoutes(parsePricing({ data: [{
      model_name: 'm', enable_groups: ['a', 'b'], supported_endpoint_types: ['anthropic', 'gemini'],
    }] }))
    expect(routes.map(route => route.endpoints)).toEqual([['anthropic', 'gemini'], ['anthropic', 'gemini']])
  })

  it('reads the input modalities an operator maintained in the console', () => {
    const pricing = parsePricing({ data: [{
      model_name: 'm', enable_groups: ['g'], input_modalities: ['text', 'image'],
    }] })
    expect(pricing.models[0]?.input).toEqual(['text', 'image'])
  })

  it('drops modalities this harness does not understand and keeps the rest', () => {
    const pricing = parsePricing({ data: [{
      model_name: 'm', enable_groups: ['g'], input_modalities: ['text', 'audio', 7],
    }] })
    expect(pricing.models[0]?.input).toEqual(['text'])
  })

  it('treats an empty modality list as no declaration at all', () => {
    const pricing = parsePricing({ data: [{ model_name: 'm', enable_groups: ['g'], input_modalities: [] }] })
    expect(pricing.models[0]?.input).toBeUndefined()
  })

  it('treats an empty surface list as no declaration at all', () => {
    const pricing = parsePricing({ data: [{ model_name: 'm', enable_groups: ['g'], supported_endpoint_types: [] }] })
    expect(pricing.models[0]?.endpoints).toBeUndefined()
  })

  it('reads the reasoning levels an operator maintained in the console', () => {
    const pricing = parsePricing({ data: [{
      model_name: 'm', enable_groups: ['g'], reasoning_levels: ['low', 'medium', 'high'],
    }] })
    expect(pricing.models[0]?.reasoning).toEqual(['low', 'medium', 'high'])
  })

  it('drops level names that are not strings and keeps the rest', () => {
    const pricing = parsePricing({ data: [{
      model_name: 'm', enable_groups: ['g'], reasoning_levels: ['medium', '', 3],
    }] })
    expect(pricing.models[0]?.reasoning).toEqual(['medium'])
  })

  it('treats an empty level list as no declaration at all', () => {
    const pricing = parsePricing({ data: [{ model_name: 'm', enable_groups: ['g'], reasoning_levels: [] }] })
    expect(pricing.models[0]?.reasoning).toBeUndefined()
  })

  it('carries declared levels onto every group route of one model', () => {
    const routes = expandRoutes(parsePricing({ data: [{
      model_name: 'm', enable_groups: ['a', 'b'], reasoning_levels: ['max'],
    }] }))
    expect(routes.map(route => route.reasoning)).toEqual([['max'], ['max']])
  })
})

describe('expandRoutes', () => {
  it('carries the group reference on the routes whose group published one', () => {
    const routes = expandRoutes(parsePricing(payload))
    expect(routes.map(route => route.groupRef)).toEqual(['#7', undefined])
  })

  it('encodes the catalog id and display name from the group and the model', () => {
    const [route] = expandRoutes(parsePricing(payload))
    expect(route?.id).toBe('[低价] Grok::grok-4.6')
    expect(route?.name).toBe('grok-4.6 @ [低价] Grok')
    expect(route?.description).toBe('分组倍率 0.1x')
  })

  it('expands one route per (group, model) pair, group order preserved', () => {
    const routes = expandRoutes(parsePricing({
      data: [
        { model_name: 'a', enable_groups: ['g1', 'g2'] },
        { model_name: 'b', enable_groups: ['g2'] },
      ],
    }))
    expect(routes.map(route => route.id)).toEqual(['g1::a', 'g2::a', 'g2::b'])
  })
})
