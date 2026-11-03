/**
 * The persistence contract behind the whitelist, asserted against the real
 * schema and the real Cordis config resolution.
 *
 * Settings can only write fields a Config marks `volatile`, and a volatile
 * field is what the Loader commits into a running plugin without remounting
 * it. Both facts decide the storage choice, so they are pinned here rather
 * than assumed: the whitelist field is volatile, its siblings are not, and the
 * resolved value the plugin reads is behind `.get()`.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { Config } from '../index.ts'
import { DEFAULT_DIRECT_ENDPOINT } from './relay.ts'

/**
 * Resolve the plugin configuration the way the Loader does.
 * @param input - raw configuration from the profile entry.
 * @returns the resolved configuration a plugin's apply receives.
 */
async function resolved(input: Record<string, unknown>): Promise<{
  baseURL: unknown
  directEndpoint: string
  directLink: { get(): boolean }
  defaultContextWindow: number
  modelOverrides: Record<string, unknown>
  enabledModels: { get(): readonly string[] }
}> {
  let resolvedConfig: unknown
  const ctx = new Context()
  try {
    await ctx.plugin({
      Config,
      apply(owner: Context, config: unknown) {
        resolvedConfig = config
        void owner
      },
    }, input)
    await ctx.fiber.await()
  } finally {
    await ctx.fiber.dispose()
  }
  return resolvedConfig as {
    baseURL: unknown
    directEndpoint: string
    directLink: { get(): boolean }
    defaultContextWindow: number
    modelOverrides: Record<string, unknown>
    enabledModels: { get(): readonly string[] }
  }
}

describe('Config', () => {
  it('marks the whitelist volatile, which is what lets Settings write it into a running plugin', () => {
    expect(Config.dict?.enabledModels?.meta.volatile).toBe(true)
  })

  it('marks the long-connection switch volatile, which is what lets the model picker write it', () => {
    expect(Config.dict?.directLink?.meta.volatile).toBe(true)
    // The endpoint itself is a deployment knob: changing it is a profile edit,
    // not something a toggle rewrites.
    expect(Config.dict?.directEndpoint?.meta.volatile).toBeUndefined()
  })

  it('resolves the switch off, so a fresh install talks to the site root', async () => {
    const config = await resolved({})
    expect(config.directLink.get()).toBe(false)
    expect(config.directEndpoint).toBe(DEFAULT_DIRECT_ENDPOINT)
  })

  it('keeps the deployment knobs out of the live-editable form', () => {
    for (const field of ['baseURL', 'apiKeyEnv', 'catalogTtlMs', 'defaultContextWindow', 'modelOverrides']) {
      expect(Config.dict?.[field]?.meta.volatile).toBeUndefined()
    }
  })

  it('answers every model with the configured fallback capacity when nothing else states one', async () => {
    // A model without a context window loses automatic compaction entirely, so
    // this default is what keeps a brand-new site model usable unchanged.
    expect((await resolved({})).defaultContextWindow).toBe(200_000)
  })

  it('resolves per-model corrections keyed by bare model name', async () => {
    const config = await resolved({ modelOverrides: { 'gemini-4-argon': { contextWindow: 1_048_576, reasoning: ['low', 'high'] } } })
    expect(config.modelOverrides['gemini-4-argon']).toMatchObject({ contextWindow: 1_048_576, reasoning: ['low', 'high'] })
  })

  it('resolves an unconfigured whitelist to the empty list, so every model shows', async () => {
    expect((await resolved({})).enabledModels.get()).toEqual([])
  })

  it('resolves a stored whitelist to the names it was saved with', async () => {
    expect((await resolved({ enabledModels: ['glm-5.3', 'grok-4.6'] })).enabledModels.get())
      .toEqual(['glm-5.3', 'grok-4.6'])
  })
})
