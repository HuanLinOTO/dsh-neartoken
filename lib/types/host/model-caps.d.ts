/**
 * Whether the name-based fallback keeps this model.
 *
 * Three exclusions: a coding-suffixed twin, a media route, and any name neither
 * the catalog nor {@link UNCALLED_MODELS} describes — an unknown model would
 * otherwise be advertised with invented capabilities. Only a site that declares
 * no endpoint types reaches this rule; see {@link isChatOffering}.
 * @param model - a bare model name from the pricing endpoint.
 * @returns whether the model stays in the catalog.
 */
export declare function isOfferedModel(model: string): boolean;
/**
 * Whether the catalog should offer this model at all.
 *
 * The site's declared endpoint types decide when it declares any: that is what
 * lets a model the catalog has never heard of appear the day the site adds it,
 * instead of waiting for a plugin release. A site that declares nothing falls
 * back to the name rules, which is the only answer available there.
 * @param model - a bare model name from the pricing endpoint.
 * @param endpoints - the site's declared downstream surfaces, if any.
 * @returns whether the model stays in the catalog.
 */
export declare function isChatOffering(model: string, endpoints?: readonly string[]): boolean;
/**
 * The selectable reasoning levels for one model.
 * @param model - a bare model name.
 * @param declared - levels configured for this exact model, which win when given.
 * @returns the level names, or undefined when nothing names any.
 */
export declare function reasoningLevels(model: string, declared?: readonly string[]): readonly string[] | undefined;
/**
 * The input modalities one model accepts.
 *
 * The harness treats a declared modality list as the only permission a request
 * has: the `read_image` tool refuses to load a file for a model without
 * `image`, and a request carrying an image is rejected before it is sent. So
 * this answers for every model — a name nothing describes is stated as text-only
 * rather than left unknown, which is what the site actually serves in practice
 * and keeps an image out of a request that would fail.
 * @param model - a bare model name.
 * @param declared - modalities configured for this exact model, which win when given.
 * @returns the modalities, always including `text`.
 */
export declare function inputModalitiesOf(model: string, declared?: readonly string[]): readonly string[];
/** Everything that can answer one model's context capacity. */
export interface CapacitySources {
    /** What the site declared for this exact model, in tokens. */
    reported?: number;
    /** The operator's configuration for this bare model name, in tokens. */
    override?: number;
    /** The configured answer when nothing else knows, in tokens. */
    fallback: number;
}
/**
 * Resolve one model's context window.
 *
 * A harness model without a context window loses automatic compaction entirely
 * — the compaction backend refuses to size a summary budget it cannot bound —
 * so this always answers, falling back to the configured capacity rather than
 * declining. Priority: operator override, then the site's own declaration, then
 * the generated catalog, then the configured fallback.
 * @param model - a bare model name.
 * @param sources - the four candidate answers.
 * @returns a positive token count.
 */
export declare function contextWindowOf(model: string, sources: CapacitySources): number;
/**
 * Resolve one model's maximum output tokens.
 *
 * Only an explicit answer counts: the generated catalog's `maxTokens` is the
 * vendor's own ceiling, and the site may route the name to a channel with a
 * lower one, so sending it would trade a truncated reply for a rejected
 * request. Without an explicit answer the request omits the field and the
 * upstream default applies.
 * @param reported - what the site declared for this exact model.
 * @param override - the operator's configuration for this bare model name.
 * @returns the output ceiling, or undefined to leave it to the upstream.
 */
export declare function maxTokensOf(reported?: number, override?: number): number | undefined;
/**
 * The level a request uses until the human picks another.
 * @param levels - the model's selectable levels, which is never empty.
 * @returns `medium` when offered, otherwise the least intensive level.
 */
export declare function defaultReasoningLevel(levels: readonly string[]): string;
/**
 * Display name of one level.
 * @param level - a level id from the catalog.
 * @returns the capitalized name the selector shows.
 */
export declare function reasoningLevelLabel(level: string): string;
