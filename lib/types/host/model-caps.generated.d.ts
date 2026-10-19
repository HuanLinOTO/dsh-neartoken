/**
 * Generated from @earendil-works/pi-ai@1.1.0. Run node scripts/gen-model-caps.mjs; do not edit.
 *
 * CHAT_MODELS is every chat model the catalog describes: a name outside it has no
 * known capabilities, and the provider hides it rather than guess. TIER_SETS holds
 * each distinct reasoning level list once; MODEL_TIERS points models at one of
 * them. Level names are the catalog own wire spellings.
 */
/** Distinct reasoning level lists. */
export declare const TIER_SETS: readonly (readonly string[])[];
/** Model id -> the index in TIER_SETS describing its reasoning levels. */
export declare const MODEL_TIERS: Readonly<Record<string, number>>;
/** Every chat model the catalog describes, one per line. */
export declare const CHAT_MODELS: ReadonlySet<string>;
