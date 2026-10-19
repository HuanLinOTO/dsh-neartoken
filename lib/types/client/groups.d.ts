/**
 * The group dimension, folded out of catalog names.
 *
 * The NearToken provider (this plugin's own host half) expands the site's
 * `/api/pricing` into one catalog model per (group, model) pair, named
 * `"<model> @ <group>"`. The picker folds those back into one row per model
 * and turns the group into its own selectable level.
 *
 * Group names carry a badge convention on the site: a run of bracketed tags
 * before the group's own name (`[低价][反重力] Claude`). Those render as
 * colored capsules; the ratio comes through the catalog entry's description
 * (`分组倍率 0.4x`).
 *
 * Prototype scope: the provider allowlist and the name separator are
 * hardcoded. They become Config fields once the shape settles.
 */
/** Providers whose catalog names carry a group suffix. */
export declare const GROUPED_PROVIDERS: readonly string[];
/**
 * Capsule tone of one group badge. Tier tags keep a fixed hue so a long list
 * reads at a glance; any other tag takes a hue derived from its own text.
 */
export type BadgeTone = 'rose' | 'emerald' | 'violet' | 'sky' | 'amber' | 'cyan' | 'fuchsia' | 'indigo' | 'teal' | 'lime' | 'orange' | 'pink';
/** One capsule rendered before the group's own name. */
export interface GroupBadge {
    readonly text: string;
    readonly tone: BadgeTone;
}
/** One group label split into its badge capsules and its own name. */
export interface ParsedGroup {
    readonly badges: readonly GroupBadge[];
    readonly label: string;
}
/**
 * Split one catalog name into the model's own name and the optional group.
 * @param name - the catalog model name, e.g. `glm-5.3 @ [低价][满血] 国模`.
 * @returns the model name without the suffix, plus the group when present.
 */
export declare function splitModelName(name: string): {
    model: string;
    group?: string;
};
/**
 * Parse one group name's bracketed badge prefix.
 * @param name - the raw group name, e.g. `[低价][反重力] Claude`.
 * @returns the badge capsules (in order) and the group's own name.
 */
export declare function parseGroupLabel(name: string): ParsedGroup;
/**
 * Render a model name the way the pickers show it: hyphens become separators
 * and every word is capitalized, so `claude-opus-5-c` reads `Claude Opus 5 C`.
 * A vendor's own spelling wins over that rule (`gpt-5.5` reads `GPT 5.5`).
 *
 * The trailing `-c` stays a word on purpose: the site pairs every such model
 * with a twin that lacks the suffix (`claude-opus-5` beside `claude-opus-5-c`),
 * so dropping it from the display would leave two different models with the
 * same name. {@link isCodingUnfriendly} is what tells the reader which one it
 * is looking at.
 * @param model - a bare model name.
 * @returns the display name.
 */
export declare function displayModelName(model: string): string;
/**
 * Read the group ratio out of the host-provided catalog description.
 * @param description - the catalog entry's description (`分组倍率 0.4x`).
 * @returns the ratio caption, or undefined when the entry carries none.
 */
export declare function ratioOf(description: string | undefined): string | undefined;
/**
 * @param provider - a catalog provider id.
 * @returns whether this provider's model names carry group suffixes.
 */
export declare function isGroupedProvider(provider: string): boolean;
/** One group's take on a model: the exact catalog entry that routes it. */
export interface ModelVariant<M> {
    readonly provider: string;
    readonly group?: string;
    readonly model: M;
}
/** One model row: the display name plus every group that offers it. */
export interface ModelOption<M> {
    /** Fold key: the model name without its group suffix. */
    readonly key: string;
    /** Displayed model name. */
    readonly label: string;
    readonly variants: readonly ModelVariant<M>[];
}
/**
 * Fold one provider's models into rows, one per model name.
 *
 * A provider outside {@link GROUPED_PROVIDERS} keeps a 1:1 mapping (no suffix
 * parsing), so its rows behave exactly like the built-in picker's.
 * @param provider - the catalog provider id.
 * @param models - that provider's catalog models, in catalog order.
 * @returns one option per distinct model name, in first-seen order.
 */
export declare function foldModels<M extends {
    readonly id: string;
    readonly name: string;
}>(provider: string, models: readonly M[]): ModelOption<M>[];
/**
 * Pick the variant a model row should route to.
 * @param option - the row being chosen.
 * @param preferredProvider - the currently selected provider, kept when it offers the model.
 * @param preferredGroup - the currently selected group, kept when that provider offers it.
 * @returns the variant to submit.
 */
export declare function chooseVariant<M>(option: ModelOption<M>, preferredProvider: string | undefined, preferredGroup: string | undefined): ModelVariant<M> | undefined;
