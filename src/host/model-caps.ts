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
 * Three exclusions: a coding-suffixed twin, a media route, and any name the
 * catalog does not describe — an unknown model would otherwise be advertised
 * with invented capabilities.
 * @param model - a bare model name from the pricing endpoint.
 * @returns whether the model stays in the catalog.
 */
export function isOfferedModel(model: string): boolean {
  if (CODING_VARIANT.test(model)) return false
  if (NON_TEXT.test(model)) return false
  return CHAT_MODELS.has(model)
}

/**
 * The selectable reasoning levels for one model.
 * @param model - a bare model name.
 * @returns the catalog's level names, or undefined when it names none.
 */
export function reasoningLevels(model: string): readonly string[] | undefined {
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
