/**
 * Whether the provider should offer this model at all.
 *
 * Three exclusions: a coding-suffixed twin, a media route, and any name the
 * catalog does not describe — an unknown model would otherwise be advertised
 * with invented capabilities.
 * @param model - a bare model name from the pricing endpoint.
 * @returns whether the model stays in the catalog.
 */
export declare function isOfferedModel(model: string): boolean;
/**
 * The selectable reasoning levels for one model.
 * @param model - a bare model name.
 * @returns the catalog's level names, or undefined when it names none.
 */
export declare function reasoningLevels(model: string): readonly string[] | undefined;
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
