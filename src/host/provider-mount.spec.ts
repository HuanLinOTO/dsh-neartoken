/**
 * The route's lifetime and its re-announcement: the adapter exists only while a
 * key can serve it, and a whitelist save must publish `llm/adapters-updated`
 * (through `replace`) so a browser refetches its model list without a reload.
 */
import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { NearTokenProvider } from './provider-mount.ts'

/** One provider over a registry that records what the plugin asked of it. */
function providerOver() {
  const replacements: string[][] = []
  let registered = 0
  let released = 0
  const handle = () => { released += 1 }
  const llm = {
    registerAdapter: () => {
      registered += 1
      const registration = Object.assign(() => { handle() }, {
        replace: (providers: string[]) => { replacements.push(providers) },
      })
      return registration
    },
    registerConfigurableProviders: () => () => { /* withdrawn with the fiber */ },
  }
  const ctx = { llm, logger: { warn: () => { /* nothing to report */ } } } as unknown as Context
  const provider = new NearTokenProvider(ctx, {
    provider: 'neartoken',
    displayName: 'NearToken',
    settingsNs: 'ui-neartoken-provider',
    baseURL: () => 'https://example.test',
    apiKey: async () => 'k'.repeat(48),
    enabled: () => [],
    catalogTtlMs: () => 300_000,
    defaultContextWindow: () => 200_000,
    modelOverride: () => undefined,
  })
  return { provider, replacements, counts: () => ({ registered, released }) }
}

describe('NearTokenProvider.refresh', () => {
  it('re-announces the same route instead of dropping it', () => {
    const { provider, replacements, counts } = providerOver()
    provider.mount()
    provider.refresh()
    expect(replacements).toEqual([['neartoken']])
    expect(counts()).toEqual({ registered: 1, released: 0 })
    expect(provider.mounted).toBe(true)
  })

  it('does nothing while the route is unmounted', () => {
    const { provider, replacements } = providerOver()
    provider.refresh()
    expect(replacements).toEqual([])
  })
})
