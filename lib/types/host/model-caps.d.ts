/**
 * What one site model name can actually do: whether it answers chat at all, and
 * how much context it holds.
 *
 * The site is the only authority. `/api/pricing` answers everything an operator
 * maintains in the New API console: `supported_endpoint_types` says which
 * downstream surfaces the model serves, and `context_window` / `max_tokens` /
 * `input_modalities` / `reasoning_levels` are the facts behind the picker (see
 * the capacity section of `HANDOFF-new-api.md`). This plugin ships no model
 * table of its own: a model the console does not describe is offered bare —
 * configured context window, text-only input, no effort selector — instead of
 * with capabilities nothing declared.
 *
 * The plugin configuration still sits on top (`modelOverrides` per bare model
 * name, `defaultContextWindow` for everything else), so a value the console gets
 * wrong can be corrected without publishing a new plugin version.
 *
 * @module
 */
/**
 * Whether the catalog should offer this model at all.
 *
 * The site's declared endpoint types decide it. A model declared without any is
 * a media route whatever its name looks like; a model whose declaration is
 * missing entirely is offered, because a site too old to declare surfaces must
 * not lose its whole catalog over it. Two name rules outlive every declaration:
 * a media route filed under a chat surface (see {@link NON_TEXT}), and a
 * coding-suffixed twin.
 * @param model - a bare model name from the pricing endpoint.
 * @param endpoints - the site's declared downstream surfaces, if any.
 * @returns whether the model stays in the catalog.
 */
export declare function isChatOffering(model: string, endpoints?: readonly string[]): boolean;
/** Everything that can answer one model's input modalities. */
export interface ModalitySources {
    /** What the site's console states for this exact model. */
    reported?: readonly string[];
    /** The operator's configuration for this bare model name. */
    declared?: readonly string[];
}
/**
 * The input modalities one model accepts.
 *
 * The harness treats a declared modality list as the only permission a request
 * has: the `read_image` tool refuses to load a file for a model without
 * `image`, and a request carrying an image is rejected before it is sent. So
 * this answers for every model — a model the site does not describe is stated as
 * text-only rather than left unknown, which keeps an image out of a request that
 * would fail.
 *
 * Priority: operator configuration, then the site's own statement, then text.
 * @param sources - the two candidates supplied at call time.
 * @returns the modalities, always including `text`.
 */
export declare function inputModalitiesOf(sources?: ModalitySources): readonly string[];
/** Everything that can answer one model's reasoning levels. */
export interface ReasoningSources {
    /** What the site's console states for this exact model. */
    reported?: readonly string[];
    /** The operator's configuration for this bare model name. */
    declared?: readonly string[];
}
/**
 * The selectable reasoning levels for one model.
 *
 * Only an explicit answer counts. The site is where an operator declares which
 * effort names a model takes; a model without that declaration is offered with
 * no selector at all, because a level the upstream rejects turns every request
 * into a 400.
 * @param sources - the two candidates supplied at call time.
 * @returns the level names in the site's order, or undefined when nothing names any.
 */
export declare function reasoningLevels(sources?: ReasoningSources): readonly string[] | undefined;
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
 * the configured fallback.
 * @param sources - the three candidate answers.
 * @returns a positive token count.
 */
export declare function contextWindowOf(sources: CapacitySources): number;
/**
 * Resolve one model's maximum output tokens.
 *
 * Only an explicit answer counts: the site may route a name to a channel with a
 * lower ceiling than the vendor states, so a guessed value would trade a
 * truncated reply for a rejected request. Without an explicit answer the request
 * omits the field and the upstream default applies.
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
 * @param level - a level id declared by the site.
 * @returns the capitalized name the selector shows.
 */
export declare function reasoningLevelLabel(level: string): string;
