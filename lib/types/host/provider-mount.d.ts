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
import type { Context } from '@deepseek-ai/cordis';
import type { NearTokenModelOverride } from './adapter.ts';
import type { NearTokenRoute } from './pricing.ts';
/** External facts the route is built from. */
export interface NearTokenProviderDeps {
    /** The one provider route this plugin owns, such as `neartoken`. */
    provider: string;
    /** Display name shown wherever the route is listed. */
    displayName: string;
    /** Settings namespace the configurable-provider entry reports. */
    settingsNs: string;
    /** Site root without a trailing slash. */
    baseURL: () => string;
    /** Resolves the stored bearer key; throws `MISSING_CREDENTIAL` when absent. */
    apiKey: () => Promise<string>;
    /** Model names the user keeps visible; empty advertises the whole catalog. */
    enabled: () => readonly string[];
    /** How long one pricing load stays fresh, in milliseconds. */
    catalogTtlMs: () => number;
    /** The capacity every model without a better answer reports, in tokens. */
    defaultContextWindow: () => number;
    /** The operator's configuration for one bare model name, when they wrote any. */
    modelOverride: (model: string) => NearTokenModelOverride | undefined;
}
/** The NearToken provider route, mounted at most once per process. */
export declare class NearTokenProvider {
    private readonly ctx;
    private readonly deps;
    private readonly pricing;
    private routes;
    private directory;
    /**
     * @param ctx - the owning plugin context carrying `llm`.
     * @param deps - the route name, site root, and credential lookup.
     */
    constructor(ctx: Context, deps: NearTokenProviderDeps);
    /** Whether the route is currently registered. */
    get mounted(): boolean;
    /**
     * Read the catalog the adapter advertises from, whitelist included.
     * @returns one route per (group, model), straight from the shared load.
     */
    catalog(): Promise<readonly NearTokenRoute[]>;
    /**
     * Register the adapter and its configurable-provider entry.
     * @returns after the route serves requests; a no-op when already mounted.
     */
    mount(): void;
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
    refresh(): void;
    /**
     * Release the route, and with it every model it advertised.
     * @returns after the route is gone; a no-op when not mounted.
     */
    unmount(): void;
}
