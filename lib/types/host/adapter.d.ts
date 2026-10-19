import { LlmAdapter } from '@deepseek-ai/dsh-llm';
import type { GenerateOptions, LlmModelInfo, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm';
import type { NearTokenRoute } from './pricing.ts';
/** Display name of the single provider route this adapter owns. */
export declare const NEARTOKEN_PROVIDER_NAME = "NearToken";
/** External facts the adapter reads at call time. */
export interface NearTokenDeps {
    /** The expanded (group, model) routes, loaded and cached by the host entry. */
    routes: () => Promise<readonly NearTokenRoute[]>;
    /**
     * The model names the user keeps visible; empty advertises the whole catalog.
     * Dispatch ignores it: a session already on a now-hidden model still routes.
     */
    enabled: () => readonly string[];
    /** Resolves the bearer key; throws MISSING_CREDENTIAL when absent. */
    apiKey: () => Promise<string>;
    /** Site root without a trailing slash. */
    baseURL: () => string;
}
/**
 * Decode one catalog model id into its routing parts.
 * @param id - a catalog id ("`[低价] Grok::grok-4.6`") or a bare model name.
 * @returns the group (when the id carries one) and the real model name.
 */
export declare function decodeRoute(id: string): {
    group?: string;
    model: string;
};
/** The NearToken provider adapter. */
export declare class NearTokenAdapter extends LlmAdapter {
    private readonly deps;
    /**
     * @param deps - routing, credential, and endpoint facts from the host entry.
     */
    constructor(deps: NearTokenDeps);
    /**
     * @param provider - the route this adapter registered (`neartoken`).
     * @returns detached display metadata.
     */
    providerInfo(provider: string): {
        id: string;
        name: string;
    };
    /**
     * Advertise the visible (group, model) routes as the provider catalog.
     * @param provider - the route this adapter registered.
     * @returns one model entry per group offering, in endpoint order.
     */
    listModels(provider: string): Promise<readonly LlmModelInfo[]>;
    /**
     * Resolve one exact route's metadata from the same generation as dispatch.
     * @param provider - the route this adapter registered.
     * @param model - the catalog id passed to `GenerateOptions.model`.
     * @returns route identity plus that model's real reasoning levels.
     */
    resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo>;
    /**
     * Stream one model call through the OpenAI chat-completions endpoint.
     * @param options - the fully-assembled request; the abort signal is honored.
     * @returns the parsed chunk stream.
     */
    stream(options: GenerateOptions): AsyncGenerator<StreamChunk>;
}
