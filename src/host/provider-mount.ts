/**
 * The provider route's lifetime: the NearToken adapter exists only while a
 * stored API key can serve it.
 *
 * Mounting is what "the plugin inserts the provider" means — before a sign-in
 * the route is absent from the LLM registry, so no model list offers models that
 * cannot be called. Signing out removes it again.
 *
 * @module
 */
import type { Context } from '@deepseek-ai/cordis'
import type { AdapterRegistrationHandle, DirectoryRegistrationHandle } from '@deepseek-ai/dsh-llm'
import { NearTokenAdapter } from './adapter.ts'
import type { NearTokenModelOverride } from './adapter.ts'
import type { ImageRequestPolicy, ImageSource } from './wire-images.ts'
import type { NearTokenRoute } from './pricing.ts'
import { PricingDirectory } from './pricing.ts'

/** External facts the route is built from. */
export interface NearTokenProviderDeps {
  /** The one provider route this plugin owns, such as `neartoken`. */
  provider: string
  /** Display name shown wherever the route is listed. */
  displayName: string
  /** Settings namespace the configurable-provider entry reports. */
  settingsNs: string
  /** Site root without a trailing slash. */
  baseURL: () => string
  /** Resolves the stored bearer key; throws `MISSING_CREDENTIAL` when absent. */
  apiKey: () => Promise<string>
  /** Model names the user keeps visible; empty advertises the whole catalog. */
  enabled: () => readonly string[]
  /** How long one pricing load stays fresh, in milliseconds. */
  catalogTtlMs: () => number
  /** The capacity every model without a better answer reports, in tokens. */
  defaultContextWindow: () => number
  /** The operator's configuration for one bare model name, when they wrote any. */
  modelOverride: (model: string) => NearTokenModelOverride | undefined
  /** The attachment service, when the composition provides one. */
  attachments: () => ImageSource | undefined
  /** The bounds every request image is re-encoded to before it is sent. */
  imagePolicy: () => ImageRequestPolicy
}

/** The NearToken provider route, mounted at most once per process. */
export class NearTokenProvider {
  private readonly pricing: PricingDirectory
  private routes: AdapterRegistrationHandle | undefined
  private directory: DirectoryRegistrationHandle | undefined

  /**
   * @param ctx - the owning plugin context carrying `llm`.
   * @param deps - the route name, site root, and credential lookup.
   */
  constructor(private readonly ctx: Context, private readonly deps: NearTokenProviderDeps) {
    // One directory per plugin mount: a sign-out/sign-in cycle reuses the
    // catalog it already loaded instead of fetching it again.
    this.pricing = new PricingDirectory(ctx, deps.baseURL, deps.catalogTtlMs)
  }

  /** Whether the route is currently registered. */
  get mounted(): boolean {
    return this.routes !== undefined
  }

  /**
   * Read the catalog the adapter advertises from, whitelist included.
   * @returns one route per (group, model), straight from the shared load.
   */
  async catalog(): Promise<readonly NearTokenRoute[]> {
    return await this.pricing.load()
  }

  /**
   * Read every route the site publishes, picture models included. The model
   * seat and the adapter only ever see the chat routes.
   * @returns one route per (group, model), from the shared load.
   */
  async fullCatalog(): Promise<readonly NearTokenRoute[]> {
    return await this.pricing.catalog()
  }

  /**
   * Register the adapter and its configurable-provider entry.
   * @returns after the route serves requests; a no-op when already mounted.
   */
  mount(): void {
    if (this.routes !== undefined) return
    const adapter = new NearTokenAdapter({
      routes: () => this.pricing.load(),
      enabled: this.deps.enabled,
      apiKey: this.deps.apiKey,
      baseURL: this.deps.baseURL,
      defaultContextWindow: this.deps.defaultContextWindow,
      modelOverride: this.deps.modelOverride,
      attachments: this.deps.attachments,
      imagePolicy: this.deps.imagePolicy,
    })
    this.routes = this.ctx.llm.registerAdapter([this.deps.provider], adapter)
    this.directory = this.ctx.llm.registerConfigurableProviders([{
      provider: this.deps.provider,
      displayName: this.deps.displayName,
      settingsNs: this.deps.settingsNs,
      settingsPath: [],
      defaultBaseURL: this.deps.baseURL(),
    }])
  }

  /**
   * Announce the route again without dropping it.
   *
   * The catalog the adapter serves changed (the model whitelist), and a client
   * only refetches its model list after `llm/adapters-updated`. Re-declaring
   * the same route publishes that event in one synchronous section, so no
   * caller ever observes a provider that is missing — unlike unmount/mount,
   * which would leave a gap and make the picker flash.
   * @returns after the event was published; a no-op when not mounted.
   */
  refresh(): void {
    if (this.routes === undefined) return
    this.routes.replace([this.deps.provider])
  }

  /**
   * Release the route, and with it every model it advertised.
   * @returns after the route is gone; a no-op when not mounted.
   */
  unmount(): void {
    this.directory?.()
    this.routes?.()
    this.directory = undefined
    this.routes = undefined
  }
}
