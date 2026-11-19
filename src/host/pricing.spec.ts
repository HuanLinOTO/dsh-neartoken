/**
 * The pricing half's two contracts: `group_refs` decides whether a route can
 * carry group intent at all, and the catalog id it mints is what the adapter
 * decodes back at dispatch. Both are asserted against one payload shaped like
 * the site's answer, including the non-latin1 group names it really uses.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PricingDirectory, expandRoutes, parsePricing } from './pricing.ts'

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

describe('declared wire and stateful responses', () => {
  it('reads the api_style an operator maintained in the console', () => {
    const pricing = parsePricing({ data: [{ model_name: 'm', enable_groups: ['g'], api_style: 'responses' }] })
    expect(pricing.models[0]?.apiStyle).toBe('responses')
  })

  it('reads the site spelling of the Gemini wire as this plugin own name', () => {
    const pricing = parsePricing({ data: [{ model_name: 'm', enable_groups: ['g'], api_style: 'gemini' }] })
    expect(pricing.models[0]?.apiStyle).toBe('genai')
  })

  it('ignores a wire name it does not dispatch through', () => {
    for (const value of ['openai', '', 3, null]) {
      const pricing = parsePricing({ data: [{ model_name: 'm', enable_groups: ['g'], api_style: value }] })
      expect(pricing.models[0]?.apiStyle).toBeUndefined()
    }
  })

  it('treats only an explicit true as a stateful declaration', () => {
    const read = (value: unknown) => parsePricing({
      data: [{ model_name: 'm', enable_groups: ['g'], responses_stateful: value }],
    }).models[0]?.statefulResponses
    expect(read(true)).toBe(true)
    // A site older than this field answers nothing, and nothing means stateless.
    for (const value of [false, 'true', 1, undefined]) expect(read(value)).toBeUndefined()
  })

  it('carries the declared wire and its state onto every group route of one model', () => {
    const routes = expandRoutes(parsePricing({ data: [{
      model_name: 'm', enable_groups: ['a', 'b'], api_style: 'responses', responses_stateful: true,
    }] }))
    expect(routes.map(route => [route.apiStyle, route.statefulResponses])).toEqual([
      ['responses', true],
      ['responses', true],
    ])
  })
})

describe('per-group client overrides', () => {
  it('reads the declarations a model carries per group', () => {
    const pricing = parsePricing({ data: [{
      model_name: 'm', enable_groups: ['default', '内部'],
      client_endpoints: { 内部: { api_style: 'chat', responses_stateful: true } },
    }] })
    expect(pricing.models[0]?.client).toEqual({ 内部: { apiStyle: 'chat', statefulResponses: true } })
  })

  it('normalizes an override member exactly like the global field', () => {
    const pricing = parsePricing({ data: [{
      model_name: 'm', enable_groups: ['g'], client_endpoints: { g: { api_style: 'gemini' } },
    }] })
    expect(pricing.models[0]?.client?.g).toEqual({ apiStyle: 'genai' })
  })

  it('drops an override that states nothing this plugin dispatches through', () => {
    const pricing = parsePricing({ data: [{
      model_name: 'm',
      enable_groups: ['g'],
      client_endpoints: { g: { api_style: 'openai', responses_stateful: 'true' }, '  ': { api_style: 'chat' }, h: null },
    }] })
    expect(pricing.models[0]?.client).toBeUndefined()
  })

  it('treats a payload without the overrides as a model declaring none', () => {
    for (const value of [undefined, '', [], ['g'], 3]) {
      const pricing = parsePricing({ data: [{ model_name: 'm', enable_groups: ['g'], client_endpoints: value }] })
      expect(pricing.models[0]?.client).toBeUndefined()
    }
  })
})

describe('a group override outranks the global declaration', () => {
  /**
   * Expand one model served by two groups.
   * @param row - the model's own declarations.
   * @returns the group, wire and state of each route.
   */
  function routes(row: Record<string, unknown>): (string | boolean | undefined)[][] {
    return expandRoutes(parsePricing({
      data: [{ model_name: 'm', enable_groups: ['plain', 'special'], ...row }],
    })).map(route => [route.group, route.apiStyle, route.statefulResponses])
  }

  it('routes a group that pins chat while the model globally answers Responses', () => {
    expect(routes({ api_style: 'responses', client_endpoints: { special: { api_style: 'chat' } } })).toEqual([
      ['plain', 'responses', undefined],
      ['special', 'chat', undefined],
    ])
  })

  it('turns Responses storing on for one group of a globally stateless model', () => {
    expect(routes({ api_style: 'responses', client_endpoints: { special: { responses_stateful: true } } })).toEqual([
      ['plain', 'responses', undefined],
      ['special', 'responses', true],
    ])
  })

  it('turns Responses storing off for one group of a globally stateful model', () => {
    const declared = { api_style: 'responses', responses_stateful: true, client_endpoints: { special: { responses_stateful: false } } }
    expect(routes(declared)).toEqual([
      ['plain', 'responses', true],
      ['special', 'responses', undefined],
    ])
  })

  it('leaves a group the model never listed on the global declaration', () => {
    const declared = { api_style: 'anthropic', responses_stateful: true, client_endpoints: { other: { api_style: 'chat' } } }
    expect(routes(declared)).toEqual([
      ['plain', 'anthropic', true],
      ['special', 'anthropic', true],
    ])
  })

  it('ignores an override it cannot dispatch through and keeps the global one', () => {
    expect(routes({ api_style: 'responses', client_endpoints: { special: { api_style: 'openai' } } })).toEqual([
      ['plain', 'responses', undefined],
      ['special', 'responses', undefined],
    ])
  })

  it('states a group wire even when the model declares no global one', () => {
    // The site's own spelling of the Gemini wire, which the route names differently.
    const declared = { client_endpoints: { special: { api_style: 'gemini', responses_stateful: true } } }
    expect(routes(declared)).toEqual([
      ['plain', undefined, undefined],
      ['special', 'genai', true],
    ])
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

describe('PricingDirectory', () => {
  /** One catalog answer, shaped like the site's. */
  const catalogBody = {
    data: [{ model_name: 'glm-5.3', enable_groups: ['default', '内部'] }],
    group_ratio: { default: 1, 内部: 1 },
    usable_group: { default: '默认分组', 内部: 'Internal test group' },
  }

  /**
   * Answer every catalog request and record what each one carried.
   * @param answer - the response for one requested URL.
   * @returns the recorded requests, in order.
   */
  function stubFetch(answer: (url: string) => Response): { url: string; authorization?: string }[] {
    const calls: { url: string; authorization?: string }[] = []
    vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
      calls.push({ url: input, authorization: (init?.headers as Record<string, string> | undefined)?.authorization })
      return answer(input)
    })
    return calls
  }

  /** A directory whose site root and freshness never change. */
  function directory(apiKey: () => Promise<string | undefined>): PricingDirectory {
    return new PricingDirectory({ logger: { warn: () => {} } }, () => 'https://site.test', () => 60_000, apiKey)
  }

  afterEach(() => { vi.unstubAllGlobals() })

  it('reads the account catalog with the stored key', async () => {
    const calls = stubFetch(() => new Response(JSON.stringify(catalogBody), { status: 200 }))
    const routes = await directory(async () => 'sk-account').catalog()
    expect(calls).toEqual([{ url: 'https://site.test/api/dsh/device/pricing', authorization: 'Bearer sk-account' }])
    expect(routes.map(route => route.group)).toEqual(['default', '内部'])
  })

  it('reads the public catalog while signed out', async () => {
    const calls = stubFetch(() => new Response(JSON.stringify(catalogBody), { status: 200 }))
    await directory(async () => undefined).catalog()
    expect(calls).toEqual([{ url: 'https://site.test/api/pricing', authorization: undefined }])
  })

  it('falls back to the public catalog when the account route is unavailable', async () => {
    const calls = stubFetch(url => new Response(JSON.stringify(catalogBody), { status: url.endsWith('/api/pricing') ? 200 : 404 }))
    const routes = await directory(async () => 'sk-account').catalog()
    expect(calls.map(call => call.url)).toEqual([
      'https://site.test/api/dsh/device/pricing',
      'https://site.test/api/pricing',
    ])
    expect(routes).not.toEqual([])
  })

  it('reloads when the key changes instead of serving the cached catalog', async () => {
    const calls = stubFetch(() => new Response(JSON.stringify(catalogBody), { status: 200 }))
    let key: string | undefined = 'sk-first'
    const pricing = directory(async () => key)
    await pricing.catalog()
    key = 'sk-second'
    await pricing.catalog()
    expect(calls.map(call => call.authorization)).toEqual(['Bearer sk-first', 'Bearer sk-second'])
  })
})

