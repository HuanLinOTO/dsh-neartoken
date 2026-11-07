/**
 * The model-facing Exa tools: `exa_search` for finding pages and `exa_fetch`
 * for reading ones the caller already has URLs for.
 *
 * They are named after the vendor instead of `web_search` / `web_fetch`
 * because a profile may mount another search provider beside this one, and two
 * tools with one name would replace each other. Each call is billed by the site
 * under the tool's own model (`exa-search` / `exa-contents`), so the operator's
 * switch and its default group are what decide the price band.
 *
 * @module
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ExaFetchResult, ExaSearchResult, NearTokenExaClient } from './exa-client.ts';
/** The operator's stored setting for these tools. */
export interface ExaToolSettings {
    /** Whether the tools are mounted at all. */
    readonly enabled: boolean;
    /** Group every call bills to unless the caller names one; empty means the catalog's first. */
    readonly group: string;
    /** Most results one search may return. */
    readonly maxResults: number;
    /** Longest text one hit or page may contribute, in characters. */
    readonly maxCharacters: number;
}
/** External facts the tools read at call time. */
export interface ExaToolDeps {
    /** The stored setting: the switch, the default group, and the two budgets. */
    readonly settings: () => ExaToolSettings;
    /** The client shared with the rest of the plugin. */
    readonly client: NearTokenExaClient;
    /** How long one call may take, in milliseconds; also sizes the tool deadline. */
    readonly timeoutMs: () => number;
}
/**
 * Resolve the group one call bills to.
 * @param settings - the operator's stored setting.
 * @param requested - the group the caller named, when it named one.
 * @returns the group to bill, or undefined to take the catalog's first offering.
 */
export declare function pickExaGroup(settings: ExaToolSettings, requested?: string): string | undefined;
/**
 * Bound a caller's result count by the operator's budget.
 * @param settings - the operator's stored setting.
 * @param requested - the count the caller asked for.
 * @returns a count between one and the operator's ceiling.
 */
export declare function boundResultCount(settings: ExaToolSettings, requested?: number): number;
/**
 * Format one search as the model-facing envelope.
 * @param value - the finished search.
 * @returns the text block the tool result carries.
 */
export declare function formatSearchOutput(value: ExaSearchResult): string;
/**
 * Format one page fetch as the model-facing envelope.
 * @param value - the finished fetch.
 * @returns the text block the tool result carries.
 */
export declare function formatFetchOutput(value: ExaFetchResult): string;
/**
 * Register `exa_search` and `exa_fetch`.
 * @param ctx - a context carrying `tools`.
 * @param deps - the stored setting and the Exa client.
 * @returns the disposer that unmounts both tools.
 */
export declare function registerExaTools(ctx: Context, deps: ExaToolDeps): () => void;
