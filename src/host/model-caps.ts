/**
 * What the site's model names can actually do.
 *
 * A New API route publishes whatever names it likes, and `/api/pricing` says
 * nothing about whether a model reasons. The generated table beside this module
 * (see `scripts/gen-model-caps.mjs`) answers that from the pi-ai catalog, which
 * is the only maintained source for these names.
 *
 * @module
 */
import { CHAT_MODELS, MODEL_TIERS, TIER_SETS } from './model-caps.generated.ts'

/**
 * Variants the site marks as unfit for coding: it pairs every such name with a
 * twin that lacks the suffix, so offering both only invites a wrong pick.
 */
const CODING_VARIANT = /-c$/i

/** Media routes that carry a model name but never answer a chat request. */
const NON_TEXT = /(image|tts|transcribe|asr)/i

/**
 * Chat models the deployment publishes before the pi-ai catalog learns them.
 *
 * The catalog is the only maintained capability source, so an unknown name is
 * normally withheld. A model listed here is offered anyway, with the reasoning
 * levels measured against the live gateway; `null` offers it without claiming
 * any. Delete an entry once the catalog describes the model, since the catalog
 * is the better authority.
 *
 * `gemini-4-argon`: Gemini 4 replaced the thinking token budget with a level
 * name. Its accepted levels are low/medium/high/max; minimal and xhigh are
 * rejected by the upstream.
 */
const UNCALLED_MODELS: Readonly<Record<string, readonly string[] | null>> = {
  'gemini-4-argon': ['low', 'medium', 'high', 'max'],
}

/** Display spelling of each level the catalog names. */
const LEVEL_LABELS: Readonly<Record<string, string>> = {
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'XHigh',
  max: 'Max',
}

/**
 * Whether the provider should offer this model at all.
 *
 * Three exclusions: a coding-suffixed twin, a media route, and any name neither
 * the catalog nor {@link UNCALLED_MODELS} describes — an unknown model would
 * otherwise be advertised with invented capabilities.
 * @param model - a bare model name from the pricing endpoint.
 * @returns whether the model stays in the catalog.
 */
export function isOfferedModel(model: string): boolean {
  if (CODING_VARIANT.test(model)) return false
  if (NON_TEXT.test(model)) return false
  if (Object.hasOwn(UNCALLED_MODELS, model)) return true
  return CHAT_MODELS.has(model)
}

/**
 * The selectable reasoning levels for one model.
 * @param model - a bare model name.
 * @returns the catalog's level names, or undefined when it names none.
 */
export function reasoningLevels(model: string): readonly string[] | undefined {
  if (Object.hasOwn(UNCALLED_MODELS, model)) return UNCALLED_MODELS[model] ?? undefined
  const index = MODEL_TIERS[model]
  return index === undefined ? undefined : TIER_SETS[index]
}

/**
 * The level a request uses until the human picks another.
 * @param levels - the model's selectable levels, which is never empty.
 * @returns `medium` when offered, otherwise the least intensive level.
 */
export function defaultReasoningLevel(levels: readonly string[]): string {
  if (levels.includes('medium')) return 'medium'
  return levels[0] ?? 'medium'
}

/**
 * Display name of one level.
 * @param level - a level id from the catalog.
 * @returns the capitalized name the selector shows.
 */
export function reasoningLevelLabel(level: string): string {
  return LEVEL_LABELS[level] ?? level.charAt(0).toUpperCase() + level.slice(1)
}
