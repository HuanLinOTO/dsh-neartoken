/**
 * Generated from @earendil-works/pi-ai@1.1.0. Run node scripts/gen-model-caps.mjs; do not edit.
 *
 * CHAT_MODELS is every chat model the catalog describes. TIER_SETS holds each
 * distinct reasoning level list once; MODEL_TIERS points models at one of them.
 * Level names are the catalog own wire spellings. MODEL_CONTEXT_WINDOW is the
 * smallest context window the catalog states for the model, used only when
 * neither the site nor the plugin configuration answers.
 */
/** Distinct reasoning level lists. */
export declare const TIER_SETS: readonly (readonly string[])[];
/** Model id -> the index in TIER_SETS describing its reasoning levels. */
export declare const MODEL_TIERS: Readonly<Record<string, number>>;
/** Model id -> the smallest context window the catalog states for it, in tokens. */
export declare const MODEL_CONTEXT_WINDOW: Readonly<Record<string, number>>;
/** Model id -> the input modalities the catalog states, for models that take images. */
export declare const MODEL_INPUT: Readonly<Record<string, readonly string[]>>;
/** Every chat model the catalog describes, one per line. */
export declare const CHAT_MODELS: ReadonlySet<string>;
