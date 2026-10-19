/**
 * The NearToken pricing directory: one shared load of the New API
 * `/api/pricing` endpoint, expanded into per-(group, model) catalog routes.
 *
 * The endpoint is public (no key) and already answers everything the group
 * dimension needs: the model list, each model's `enable_groups`, and the
 * `group_ratio` multiplier table. Group names carry their own badge prefix
 * convention (`[低价][反重力] Claude`), which the browser half parses for
 * display; here they stay opaque strings.
 */
/** One model row from `/api/pricing`. */
interface PricingModel {
    readonly model_name: string;
    readonly enable_groups: readonly string[];
}
/** The parts of `/api/pricing` this adapter consumes. */
export interface NearTokenPricing {
    readonly models: readonly PricingModel[];
    readonly groupRatio: Readonly<Record<string, number>>;
    readonly groupDescription: Readonly<Record<string, string>>;
    /** Opaque, ASCII-only routing reference per group name (`"#3"`). */
    readonly groupRefs: Readonly<Record<string, string>>;
}
/** One expanded catalog route: one group's take on one model. */
export interface NearTokenRoute {
    /** Catalog model id: `"<group>::<model>"`. */
    readonly id: string;
    /** Display name: `"<model> @ <group>"`. */
    readonly name: string;
    /** Ratio caption carried through the catalog's description field. */
    readonly description: string;
    readonly group: string;
    /**
     * The group's routing reference (`"#3"`), sent as the dispatch header value.
     * Absent when the site published no reference for this group, in which case
     * the request carries no group intent at all.
     */
    readonly groupRef?: string;
    readonly model: string;
}
/**
 * Expand one pricing payload into one route per (group, model) pair.
 * @param pricing - the loaded endpoint payload.
 * @returns routes in endpoint order, group order preserved per model.
 */
export declare function expandRoutes(pricing: NearTokenPricing): readonly NearTokenRoute[];
/**
 * Parse the endpoint's JSON into the consumed shape; unknown extra fields are
 * ignored so the New API side can evolve.
 * @param value - the parsed JSON body.
 * @returns the normalized payload.
 */
export declare function parsePricing(value: unknown): NearTokenPricing;
/** Loads and caches the pricing payload for one adapter instance. */
export declare class PricingDirectory {
    private readonly ctx;
    private readonly baseURL;
    private readonly ttlMs;
    private cache;
    private inflight;
    /**
     * @param ctx - the owning plugin context (logging only).
     * @param baseURL - the site root, e.g. `https://llm.pko.svcfusion.com`.
     * @param ttlMs - how long one load stays fresh.
     */
    constructor(ctx: {
        logger: {
            warn: (message: string, ...args: unknown[]) => void;
        };
    }, baseURL: () => string, ttlMs: () => number);
    /**
     * Return the expanded routes, reloading when the cache is older than the TTL.
     * @param force - bypass the TTL and reload now.
     * @returns one route per (group, model); empty when the endpoint is unreachable.
     */
    load(force?: boolean): Promise<readonly NearTokenRoute[]>;
}
export {};
