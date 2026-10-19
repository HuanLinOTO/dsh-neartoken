/**
 * What one site model name can actually do: whether it answers chat at all, and
 * how much context it holds.
 *
 * Three sources answer, in falling priority, and each answers something the
 * others cannot:
 *
 * 1. the site itself, through `/api/pricing` — `supported_endpoint_types` says
 *    which downstream surfaces the model serves, and `context_window` /
 *    `max_tokens` are the capacities an operator maintained in the New API
 *    console (see the `HANDOFF-new-api.md` capacity section);
 * 2. this plugin's own configuration — `modelOverrides` (per bare model name)
 *    and `defaultContextWindow` (everything else), so a capacity can be
 *    corrected without publishing a new plugin version;
 * 3. the generated pi-ai table beside this module, which describes the models
 *    the catalog knows even when the site declares nothing.
 *
 * @module
 */
import { CHAT_MODELS, MODEL_CONTEXT_WINDOW, MODEL_INPUT, MODEL_TIERS, TIER_SETS } from './model-caps.generated.ts'

/**
 * Variants the site marks as unfit for coding: it pairs every such name with a
 * twin that lacks the suffix, so offering both only invites a wrong pick.
 */
const CODING_VARIANT = /-c$/i

/** Media routes that carry a model name but never answer a chat request. */
const NON_TEXT = /(image|tts|transcribe|asr)/i

/**
 * The downstream surfaces that answer a chat request. A model the site
 * declares without any of these is a media, embedding, or rerank route, and the
 * endpoint list is the site's own statement rather than a guess from the name.
 */
const CHAT_ENDPOINTS: ReadonlySet<string> = new Set(['openai', 'openai-response', 'anthropic', 'gemini'])

/** What the deployment measured about one model the catalog has not learned yet. */
interface UncalledCapability {
  /** Selectable reasoning levels, or null when the model names none. */
  readonly levels: readonly string[] | null
  /** Input modalities measured against the live gateway. */
  readonly input: readonly string[]
}

/**
 * Chat models the site publishes before the pi-ai catalog learns them.
 *
 * Only the name-based fallback below consults this list; a site that declares
 * `supported_endpoint_types` needs no allowlist at all. A model listed here is
 * offered with the reasoning levels measured against the live gateway;
 * `null` offers it without claiming any. Delete an entry once the catalog
 * describes the model, since the catalog is the better authority.
 *
 * `gemini-4-argon`: Gemini 4 replaced the thinking token budget with a level
 * name. Its accepted levels are low/medium/high/max; minimal and xhigh are
 * rejected by the upstream.
 */
const UNCALLED_MODELS: Readonly<Record<string, UncalledCapability>> = {
  'gemini-4-argon': { levels: ['low', 'medium', 'high', 'max'], input: ['text', 'image'] },
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
 * Whether the name-based fallback keeps this model.
 *
 * Three exclusions: a coding-suffixed twin, a media route, and any name neither
 * the catalog nor {@link UNCALLED_MODELS} describes — an unknown model would
 * otherwise be advertised with invented capabilities. Only a site that declares
 * no endpoint types reaches this rule; see {@link isChatOffering}.
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
export function isChatOffering(model: string, endpoints?: readonly string[]): boolean {
  // A media or coding-twin name never answers a chat request, whatever the site
  // declares for it: the pricing endpoint files image, TTS, and embedding routes
  // under the same `openai` surface a chat model has.
  if (NON_TEXT.test(model) || CODING_VARIANT.test(model)) return false
  if (endpoints === undefined || endpoints.length === 0) return isOfferedModel(model)
  return endpoints.some(endpoint => CHAT_ENDPOINTS.has(endpoint))
}

/**
 * The selectable reasoning levels for one model.
 * @param model - a bare model name.
 * @param declared - levels configured for this exact model, which win when given.
 * @returns the level names, or undefined when nothing names any.
 */
export function reasoningLevels(model: string, declared?: readonly string[]): readonly string[] | undefined {
  if (declared !== undefined) return declared.length === 0 ? undefined : declared
  if (Object.hasOwn(UNCALLED_MODELS, model)) return UNCALLED_MODELS[model]?.levels ?? undefined
  const index = MODEL_TIERS[model]
  return index === undefined ? undefined : TIER_SETS[index]
}

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
export function inputModalitiesOf(model: string, declared?: readonly string[]): readonly string[] {
  if (declared !== undefined && declared.length > 0) return declared
  if (Object.hasOwn(UNCALLED_MODELS, model)) return UNCALLED_MODELS[model]?.input ?? ['text']
  return MODEL_INPUT[model] ?? ['text']
}

/** Everything that can answer one model's context capacity. */
export interface CapacitySources {
  /** What the site declared for this exact model, in tokens. */
  reported?: number
  /** The operator's configuration for this bare model name, in tokens. */
  override?: number
  /** The configured answer when nothing else knows, in tokens. */
  fallback: number
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
export function contextWindowOf(model: string, sources: CapacitySources): number {
  return sources.override
    ?? sources.reported
    ?? MODEL_CONTEXT_WINDOW[model]
    ?? sources.fallback
}

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
export function maxTokensOf(reported?: number, override?: number): number | undefined {
  return override ?? reported
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
