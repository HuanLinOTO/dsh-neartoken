/**
 * Host loader entry for the NearToken provider plugin: a sign-in surface for one
 * New API deployment, the provider route that sign-in inserts, and the browser
 * half (src/client) that renders both the settings page and the grouped model
 * seat.
 *
 * The route is inserted only while an API key is stored — see
 * {@link NearTokenProvider} — so a fresh install shows no NearToken models until
 * the user signs in from the settings page.
 */
import z from '@deepseek-ai/schemastery'
import type { Context, Volatile } from '@deepseek-ai/cordis'
import { credentialRef, isCredentialRefName } from '@deepseek-ai/dsh-credentials'
import { LlmError } from '@deepseek-ai/dsh-llm'
// Type-only: pulls the ctx.webServer merge for the settings-page routes.
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { NearTokenModelOverride } from './host/adapter.ts'
import { NearTokenAccount } from './host/account.ts'
import { NearTokenProvider } from './host/provider-mount.ts'
import { registerNearTokenRoutes } from './host/routes.ts'
import { NearTokenWhitelist } from './host/whitelist.ts'
import type { WhitelistSettings } from './host/whitelist.ts'

/** The single provider route this plugin owns. */
const PROVIDER = 'neartoken'

/** Display name of that route wherever the application lists it. */
const DISPLAY_NAME = 'NearToken'

/** Settings namespace the configurable-provider entry reports. */
const SETTINGS_NS = 'ui-neartoken-provider'

/**
 * The context window every model reports until something better answers.
 *
 * A harness model without one loses automatic compaction outright, so this
 * cannot be optional. 200K is the smallest capacity among the chat models the
 * site typically offers: guessing low costs an early summary, guessing high
 * costs a rejected request.
 */
const DEFAULT_CONTEXT_WINDOW = 200_000

/** One operator-stated fact about one bare model name. */
const modelOverride = z.object({
  /** Context capacity in tokens. */
  contextWindow: z.number().step(1).min(1),
  /** Output ceiling in tokens; the only source that puts `max_tokens` on the wire. */
  maxTokens: z.number().step(1).min(1),
  /** Selectable reasoning levels, for a model no catalog entry describes. */
  reasoning: z.array(z.string()),
})

/** The slice of the settings service this plugin uses. */
interface SettingsPresentation {
  /**
   * Register this plugin's settings-page policy.
   * @param presentation - whether the shell may generate a page of its own.
   * @param owner - the plugin instance the policy belongs to.
   * @returns the disposer, registering with the caller's effects.
   */
  configure(presentation: { auto?: boolean }, owner?: unknown): () => void
}

/** Resolved configuration shape the loader hands to {@link apply}. */
export interface Options {
  baseURL: string
  apiKeyEnv: string
  catalogTtlMs: number
  /** The capacity every model without a better answer reports, in tokens. */
  defaultContextWindow: number
  /** Operator-stated facts per bare model name: capacity and reasoning levels. */
  modelOverrides: Record<string, NearTokenModelOverride>
  /** Model names kept visible in the model picker; empty shows every model. */
  enabledModels: Volatile<string[]>
}

/** Configuration surface; prototype keeps every knob optional. */
export const Config = z.object({
  /** Site root without a trailing slash. */
  baseURL: z.string().default('https://llm.pko.svcfusion.com'),
  /** Credential reference the sign-in writes and the adapter resolves. */
  apiKeyEnv: z.string().default('NEARTOKEN_API_KEY'),
  /** How long one pricing load stays fresh, in milliseconds. */
  catalogTtlMs: z.number().default(300_000),
  /**
   * The capacity every model reports when neither the site nor the generated
   * catalog answers. Set it below the smallest model the site offers.
   */
  defaultContextWindow: z.number().step(1).min(1).default(DEFAULT_CONTEXT_WINDOW),
  /**
   * Per-model corrections, keyed by bare model name: the way to fix a capacity
   * or teach a brand-new model its reasoning levels without publishing a new
   * plugin version. Anything here wins over both the site and the catalog.
   */
  modelOverrides: z.dict(modelOverride).default({}),
  /**
   * The model whitelist: the catalog models the settings page keeps visible.
   * Empty means no whitelist, so every model the site offers is advertised.
   * Volatile, so the page's save reaches the running plugin through Settings
   * without remounting it.
   */
  enabledModels: z.array(z.string()).default([]).volatile(),
})

/** Required services: the LLM registry the adapter mounts into. */
export const inject = ['llm']

/**
 * Register the account, the provider route, and the settings-page routes.
 * @param ctx - host context.
 * @param config - resolved plugin configuration.
 */
export function apply(ctx: Context, config: Options): void {
  // A reference outside the grammar can never have a stored value, so this is
  // a load-time configuration error rather than a sign-in that writes nowhere.
  if (!isCredentialRefName(config.apiKeyEnv)) {
    throw new LlmError(
      `neartoken: apiKeyEnv "${config.apiKeyEnv}" is not a credential reference name`,
      'CONFIG_REFERENCE_INVALID',
    )
  }
  const resolveApiKey = async (): Promise<string> => {
    const credentials = ctx.get('credentials')
    const hit = credentials === undefined
      ? undefined
      : await credentials.resolve(credentialRef(config.apiKeyEnv))
    const value = hit?.value ?? process.env[config.apiKeyEnv]
    if (typeof value !== 'string' || value.length === 0) {
      throw new LlmError(
        `neartoken: no API key for provider route "${PROVIDER}"; connect NearToken on the settings page`
        + ` (it stores ${config.apiKeyEnv} through the credentials service), or export that variable`
        + ' in the launching environment',
        'MISSING_CREDENTIAL',
      )
    }
    return value
  }
  const provider = new NearTokenProvider(ctx, {
    provider: PROVIDER,
    displayName: DISPLAY_NAME,
    settingsNs: SETTINGS_NS,
    baseURL: () => config.baseURL,
    apiKey: resolveApiKey,
    enabled: () => config.enabledModels.get(),
    catalogTtlMs: () => config.catalogTtlMs,
    defaultContextWindow: () => config.defaultContextWindow,
    modelOverride: (model) => config.modelOverrides[model],
  })
  // The whitelist lives in this plugin's own profile entry, so a save is an
  // ordinary Settings write: it persists in the profile patch and the Loader
  // commits the volatile field into this already-running fiber.
  const whitelist = new NearTokenWhitelist({
    enabled: () => config.enabledModels.get(),
    routes: () => provider.catalog(),
    // The id of this plugin's own row: the bundle patch inserts it under this
    // name, and Settings addresses configuration by that row id.
    entryId: SETTINGS_NS,
    settings: () => ctx.get('settings') as WhitelistSettings | undefined,
  })
  // A finished authorization is the moment the route appears: the site just
  // minted the key for this plugin, so the provider can serve immediately.
  const account = new NearTokenAccount(ctx, {
    baseURL: () => config.baseURL,
    apiKeyRef: () => config.apiKeyEnv,
  }, () => { provider.mount() })
  // The route follows the stored key, not the other way round: mounting it for
  // an account with no key would advertise models whose every call fails.
  const sync = (): void => {
    void account.configured().then((configured) => {
      if (configured) provider.mount()
      else provider.unmount()
    }, (error: unknown) => {
      ctx.logger.warn('neartoken: could not read the stored API key', error)
    })
  }
  sync()
  // The credential store may activate after this plugin does; the first read
  // would then see no key and leave the route unmounted for the whole process.
  // Re-reading once the service exists costs nothing and removes that ordering
  // dependency.
  ctx.inject(['credentials'], () => { sync() })
  // Without a web server there is no settings page to sign in from; the route
  // still serves an exported key from the launching environment.
  ctx.inject(['webServer'], (webCtx) => {
    registerNearTokenRoutes(webCtx, {
      account,
      onDisconnect: () => { provider.unmount() },
      models: () => whitelist.state(),
      // A save changes what `listModels` answers, and a browser only refetches
      // after `llm/adapters-updated` — so the route is re-announced here. Doing
      // it from the route (not from a listener) keeps the ordering obvious: the
      // stored list is the one the next fetch sees.
      saveModels: async (enabled) => {
        await whitelist.save(enabled)
        provider.refresh()
      },
    })
  })
  // The whitelist field is what makes this entry configurable at all, and the
  // NearToken page renders it. Without this the shell would also offer a
  // generated form for the same entry.
  ctx.inject(['settings'], () => {
    const settings = ctx.get('settings') as SettingsPresentation | undefined
    if (settings === undefined) return
    ctx.effect(() => settings.configure({ auto: false }, ctx.fiber))
  })
}
