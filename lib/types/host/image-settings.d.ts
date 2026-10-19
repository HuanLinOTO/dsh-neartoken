/**
 * The image-generation setting: which picture models the `generate_image` tool
 * may call, and which group each one routes through.
 *
 * The value lives in this plugin's own profile configuration, beside the model
 * whitelist, so a save is an ordinary Settings write that reaches the running
 * plugin without a remount. An empty selection is a legal state — the tool then
 * has no model to call — which is why "enabled" is stored separately rather
 * than inferred from the selection.
 *
 * @module
 */
import type { NearTokenImageModelEntry, NearTokenImagesPatch, NearTokenImagesState } from '../protocol.ts';
import type { NearTokenRoute } from './pricing.ts';
import type { WhitelistSettings } from './whitelist.ts';
/**
 * Fold the catalog's per-group routes into one entry per picture model.
 * @param routes - every catalog route, chat models included.
 * @returns one entry per picture model, in first-seen order.
 */
export declare function imageCatalog(routes: readonly NearTokenRoute[]): readonly NearTokenImageModelEntry[];
/**
 * Validate one `POST /neartoken/images` body against the catalog it must refer to.
 *
 * A model the site stopped offering, and a group that model no longer has, are
 * both refusals: storing either would leave the tool pointing at a route the
 * next call cannot use.
 * @param value - the parsed request body.
 * @param catalog - the picture models the site offers now.
 * @returns the normalized patch, or undefined when the body cannot be stored.
 */
export declare function parseImagePatch(value: unknown, catalog: readonly NearTokenImageModelEntry[]): NearTokenImagesPatch | undefined;
/** What the image setting reads and writes. */
export interface NearTokenImageSettingsDeps {
    /** The stored value; `enabled` false until the user turns the tool on. */
    stored: () => {
        readonly enabled: boolean;
        readonly models: Readonly<Record<string, string>>;
    };
    /** The picture models the site offers right now. */
    catalog: () => Promise<readonly NearTokenImageModelEntry[]>;
    /** The profile entry id this plugin's configuration lives in. */
    entryId: string;
    /** The settings service, when the composition provides one. */
    settings: () => WhitelistSettings | undefined;
}
/** The image setting's read and write faces, mounted on the settings routes. */
export declare class NearTokenImageSettings {
    private readonly deps;
    /**
     * @param deps - the stored value, the catalog, and the profile entry a save writes.
     */
    constructor(deps: NearTokenImageSettingsDeps);
    /**
     * Read the setting beside the site's picture models.
     * @returns the stored state plus every picture model the site offers.
     */
    state(): Promise<NearTokenImagesState>;
    /**
     * Persist one setting.
     * @param patch - whether the tool is enabled and the group each model routes through.
     * @returns resolution after the profile write and its live application.
     * @throws {Error} when the composition has no settings service, so nothing could persist it.
     */
    save(patch: NearTokenImagesPatch): Promise<void>;
}
