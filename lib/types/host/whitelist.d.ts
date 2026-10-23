/**
 * The model whitelist: which catalog models the provider advertises, kept in
 * the plugin's own profile configuration.
 *
 * The list is a `volatile` Config field (`enabledModels`), so a save reaches
 * the running plugin through the `settings` service without remounting it: the
 * Loader commits the new value into the live fiber, and the resulting settings
 * change is what reloads every client model list. It persists in the profile
 * patch with the rest of the user's configuration.
 *
 * An empty list means "no whitelist": every model is advertised, which is the
 * behavior before the user ever opened the page and the one a save of nothing
 * restores.
 *
 * @module
 */
import type { NearTokenModelEntry, NearTokenModelMeta, NearTokenModelsState } from '../protocol.ts';
import type { NearTokenRoute } from './pricing.ts';
/** The slice of the settings service a save uses. */
export interface WhitelistSettings {
    /**
     * Merge fields into one plugin entry's configuration.
     * @param ns - the profile entry id.
     * @param patch - fields to merge.
     * @returns resolution after the profile write and its live application.
     */
    update(ns: string, patch: Record<string, unknown>): Promise<void>;
}
/** What the whitelist reads and writes. */
export interface NearTokenWhitelistDeps {
    /** The stored whitelist; empty when the user never set one. */
    enabled: () => readonly string[];
    /** The stored per-model meta overrides; empty when the user never set one. */
    meta: () => Readonly<Record<string, NearTokenModelMeta>>;
    /** The full catalog, unfiltered. */
    routes: () => Promise<readonly NearTokenRoute[]>;
    /** The profile entry id this plugin's configuration lives in. */
    entryId: string;
    /** The settings service, when the composition provides one. */
    settings: () => WhitelistSettings | undefined;
}
/**
 * Keep only the routes whose model the user left visible.
 * @param routes - the full catalog.
 * @param enabled - the stored whitelist; empty keeps every route.
 * @returns the routes the provider advertises.
 */
export declare function selectedRoutes(routes: readonly NearTokenRoute[], enabled: readonly string[]): readonly NearTokenRoute[];
/**
 * Fold the catalog's per-group routes into one entry per model.
 * @param routes - the full catalog, in endpoint order.
 * @returns one entry per model name, in first-seen order.
 */
export declare function summarizeModels(routes: readonly NearTokenRoute[]): readonly NearTokenModelEntry[];
/**
 * Validate one `POST /neartoken/models` body's model list.
 * @param value - the raw `enabled` member.
 * @returns the trimmed, de-duplicated names in order, or undefined when the
 * value is not a list of short non-empty strings.
 */
export declare function parseEnabled(value: unknown): string[] | undefined;
/**
 * Validate one `POST /neartoken/models` body's meta overrides.
 *
 * A model whose value carries no member is dropped: an empty entry would read
 * as an override while overriding nothing, and the page's "clear this model's
 * override" action is exactly a value that ends up empty.
 * @param value - the raw `meta` member.
 * @returns the cleaned overrides keyed by model name, or undefined when the
 * value is not an object of well-formed per-model facts.
 */
export declare function parseMeta(value: unknown): Record<string, NearTokenModelMeta> | undefined;
/** The whitelist's read and write faces, mounted on the settings routes. */
export declare class NearTokenWhitelist {
    private readonly deps;
    /**
     * @param deps - the stored list, the catalog, and the profile entry a save writes.
     */
    constructor(deps: NearTokenWhitelistDeps);
    /**
     * Read the catalog, the stored whitelist, and the stored meta overrides.
     * @returns every model the site offers, plus the list and meta the user kept.
     */
    state(): Promise<NearTokenModelsState>;
    /**
     * Persist one whitelist, and the meta overrides when the save names them.
     * @param enabled - model names to keep visible; empty restores every model.
     * @param meta - the complete meta overrides; absent keeps the stored ones.
     * @returns resolution after the profile write and its live application.
     * @throws {Error} when the composition has no settings service, so nothing
     * could persist the list.
     */
    save(enabled: readonly string[], meta: Readonly<Record<string, NearTokenModelMeta>> | undefined): Promise<void>;
}
