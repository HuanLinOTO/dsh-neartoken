import type { NearTokenRoute } from './pricing.ts';
/** Billing model the site prices one search under. */
export declare const EXA_SEARCH_MODEL = "exa-search";
/** Billing model the site prices one page fetch under. */
export declare const EXA_CONTENTS_MODEL = "exa-contents";
/** Search depths the site prices: everything up to ten results costs the same. */
export type ExaSearchType = 'auto' | 'lite' | 'deep';
/** Which view of a page a fetch asks Exa for. */
export type ExaContentMode = 'text' | 'highlights' | 'summary';
/** One search hit as the model sees it, already trimmed to its budget. */
export interface ExaSearchHit {
    readonly url: string;
    readonly title?: string;
    readonly publishedDate?: string;
    /** Page excerpt Exa selected for this query, cut at the character budget. */
    readonly snippet?: string;
}
/** One finished search. */
export interface ExaSearchResult {
    readonly group: string;
    readonly requestId?: string;
    readonly results: ExaSearchHit[];
}
/** One page a fetch returned. */
export interface ExaFetchedPage {
    readonly url: string;
    readonly title?: string;
    readonly publishedDate?: string;
    /** The requested view of the page, cut at the character budget. */
    readonly content: string;
}
/** One finished page fetch. */
export interface ExaFetchResult {
    readonly group: string;
    readonly requestId?: string;
    readonly pages: ExaFetchedPage[];
}
/** What one search call asks for. */
export interface ExaSearchArgs {
    readonly query: string;
    readonly type: ExaSearchType;
    readonly numResults: number;
    readonly maxCharacters: number;
    readonly group?: string;
    readonly includeDomains?: readonly string[];
    readonly excludeDomains?: readonly string[];
    readonly startPublishedDate?: string;
    readonly endPublishedDate?: string;
    readonly signal?: AbortSignal;
}
/** What one page fetch asks for. */
export interface ExaFetchArgs {
    readonly urls: readonly string[];
    readonly mode: ExaContentMode;
    readonly maxCharacters: number;
    readonly group?: string;
    readonly signal?: AbortSignal;
}
/** External facts the client reads at call time. */
export interface ExaClientDeps {
    /** Origin the model-facing endpoints use, without a trailing slash. */
    readonly baseURL: () => string;
    /** The stored site key. */
    readonly apiKey: () => Promise<string>;
    /** The catalog routes, for the group a call bills to. */
    readonly routes: () => Promise<readonly NearTokenRoute[]>;
    /** How long one call may take, in milliseconds. */
    readonly timeoutMs: () => number;
    /** HTTP carrier, so a test can substitute one. */
    readonly fetch?: typeof fetch;
}
/**
 * Pick the catalog group one Exa call bills to.
 *
 * The same billing model can be offered by several groups at different prices,
 * and the site routes by the group reference header, so the caller may name one;
 * naming none takes the catalog's first offering rather than guessing at a price
 * band.
 * @param routes - the expanded catalog routes.
 * @param model - the billing model this call is priced under.
 * @param requested - the group the caller named, when it named one.
 * @returns the chosen group and its routing reference.
 * @throws {Error} when the site offers no such model, or not in that group.
 */
export declare function resolveExaGroup(routes: readonly NearTokenRoute[], model: string, requested?: string): {
    readonly group: string;
    readonly groupRef?: string;
};
/**
 * Cut one block of page text at the character budget.
 * @param value - the text as the vendor returned it.
 * @param maxCharacters - longest text one page may contribute.
 * @returns the text, with a marker when it was cut.
 */
export declare function cutAt(value: string, maxCharacters: number): string;
/**
 * Read the message out of a refusal, whichever envelope it uses.
 *
 * A gateway answers `{"error":{"message":…}}`; Exa itself answers
 * `{"error":"…"}` beside its own tag. Both mean the same thing to a caller, so
 * one reader serves both rather than making the shape the caller's problem.
 * @param body - the parsed refusal body, when it parsed.
 * @param status - the HTTP status.
 * @param fallback - the raw body text, used when nothing structured was found.
 * @returns the message to put in the thrown error.
 */
export declare function refusalMessage(body: unknown, status: number, fallback: string): string;
/**
 * The Exa payload one search sends.
 * @param args - the resolved search arguments.
 * @returns the vendor body.
 */
export declare function searchBody(args: ExaSearchArgs): Record<string, unknown>;
/**
 * The Exa payload one page fetch sends.
 * @param args - the resolved fetch arguments.
 * @returns the vendor body.
 */
export declare function contentsBody(args: ExaFetchArgs): Record<string, unknown>;
/**
 * Ask one New API deployment to search the web through Exa.
 *
 * One call is one billed search: the site prices it by the search depth and the
 * result count the body asks for, so the arguments decide the price before the
 * request is sent.
 */
export declare class NearTokenExaClient {
    private readonly deps;
    /**
     * @param deps - the site root, the key, the catalog, and the time budget.
     */
    constructor(deps: ExaClientDeps);
    /**
     * Search the web.
     * @param args - the query, the depth, the result count, and the caller's cancellation.
     * @returns the hits, trimmed to the character budget.
     * @throws {Error} when the site refuses the call or answers without results.
     */
    search(args: ExaSearchArgs): Promise<ExaSearchResult>;
    /**
     * Fetch pages the caller already has URLs for.
     * @param args - the URLs, the view to read them as, and the caller's cancellation.
     * @returns one page per URL Exa answered, trimmed to the character budget.
     * @throws {Error} when the site refuses the call.
     */
    contents(args: ExaFetchArgs): Promise<ExaFetchResult>;
    /**
     * POST one vendor body to the relay and read the answer.
     * @param path - the relay path of the Exa endpoint.
     * @param body - the vendor payload.
     * @param groupRef - the routing reference of the group that pays, when the site published one.
     * @param external - the caller's cancellation.
     * @returns the parsed answer.
     * @throws {Error} when the call fails, or the site answers something unreadable.
     */
    private post;
}
