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
import z from '@deepseek-ai/schemastery';
import type { Context, Volatile } from '@deepseek-ai/cordis';
import type { NearTokenModelOverride } from './host/adapter.ts';
/** Resolved configuration shape the loader hands to {@link apply}. */
export interface Options {
    baseURL: string;
    apiKeyEnv: string;
    catalogTtlMs: number;
    /** The capacity every model without a better answer reports, in tokens. */
    defaultContextWindow: number;
    /** Operator-stated facts per bare model name: capacity and reasoning levels. */
    modelOverrides: Record<string, NearTokenModelOverride>;
    /** Model names kept visible in the model picker; empty shows every model. */
    enabledModels: Volatile<string[]>;
}
/** Configuration surface; prototype keeps every knob optional. */
export declare const Config: z<Schemastery.ObjectS<NoInfer<{
    /** Site root without a trailing slash. */
    baseURL: z<string, string, "defined">;
    /** Credential reference the sign-in writes and the adapter resolves. */
    apiKeyEnv: z<string, string, "defined">;
    /** How long one pricing load stays fresh, in milliseconds. */
    catalogTtlMs: z<number, number, "defined">;
    /**
     * The capacity every model reports when neither the site nor the generated
     * catalog answers. Set it below the smallest model the site offers.
     */
    defaultContextWindow: z<number, number, "defined">;
    /**
     * Per-model corrections, keyed by bare model name: the way to fix a capacity
     * or teach a brand-new model its reasoning levels without publishing a new
     * plugin version. Anything here wins over both the site and the catalog.
     */
    modelOverrides: z<import("@deepseek-ai/cosmokit").Dict<{
        contextWindow?: number | null | undefined;
        maxTokens?: number | null | undefined;
        reasoning?: string[] | null | undefined;
        input?: string[] | null | undefined;
    } & import("@deepseek-ai/cosmokit").Dict, string>, import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectT<NoInfer<{
        /** Context capacity in tokens. */
        contextWindow: z<number, number, "plain">;
        /** Output ceiling in tokens; the only source that puts `max_tokens` on the wire. */
        maxTokens: z<number, number, "plain">;
        /** Selectable reasoning levels, for a model no catalog entry describes. */
        reasoning: z<string[], string[], "plain">;
        /** Input modalities (`text` / `image`); without `image` the harness refuses image requests. */
        input: z<string[], string[], "plain">;
    }>>, string>, "defined">;
    /**
     * The model whitelist: the catalog models the settings page keeps visible.
     * Empty means no whitelist, so every model the site offers is advertised.
     * Volatile, so the page's save reaches the running plugin through Settings
     * without remounting it.
     */
    enabledModels: z<NoInfer<string[]>, NoInfer<string[]>, "volatile-defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    /** Site root without a trailing slash. */
    baseURL: z<string, string, "defined">;
    /** Credential reference the sign-in writes and the adapter resolves. */
    apiKeyEnv: z<string, string, "defined">;
    /** How long one pricing load stays fresh, in milliseconds. */
    catalogTtlMs: z<number, number, "defined">;
    /**
     * The capacity every model reports when neither the site nor the generated
     * catalog answers. Set it below the smallest model the site offers.
     */
    defaultContextWindow: z<number, number, "defined">;
    /**
     * Per-model corrections, keyed by bare model name: the way to fix a capacity
     * or teach a brand-new model its reasoning levels without publishing a new
     * plugin version. Anything here wins over both the site and the catalog.
     */
    modelOverrides: z<import("@deepseek-ai/cosmokit").Dict<{
        contextWindow?: number | null | undefined;
        maxTokens?: number | null | undefined;
        reasoning?: string[] | null | undefined;
        input?: string[] | null | undefined;
    } & import("@deepseek-ai/cosmokit").Dict, string>, import("@deepseek-ai/cosmokit").Dict<Schemastery.ObjectT<NoInfer<{
        /** Context capacity in tokens. */
        contextWindow: z<number, number, "plain">;
        /** Output ceiling in tokens; the only source that puts `max_tokens` on the wire. */
        maxTokens: z<number, number, "plain">;
        /** Selectable reasoning levels, for a model no catalog entry describes. */
        reasoning: z<string[], string[], "plain">;
        /** Input modalities (`text` / `image`); without `image` the harness refuses image requests. */
        input: z<string[], string[], "plain">;
    }>>, string>, "defined">;
    /**
     * The model whitelist: the catalog models the settings page keeps visible.
     * Empty means no whitelist, so every model the site offers is advertised.
     * Volatile, so the page's save reaches the running plugin through Settings
     * without remounting it.
     */
    enabledModels: z<NoInfer<string[]>, NoInfer<string[]>, "volatile-defined">;
}>>, "plain">;
/** Required services: the LLM registry the adapter mounts into. */
export declare const inject: string[];
/**
 * Register the account, the provider route, and the settings-page routes.
 * @param ctx - host context.
 * @param config - resolved plugin configuration.
 */
export declare function apply(ctx: Context, config: Options): void;
