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
 * Variants the site marks as unfit for coding: it pairs every such name with a
 * twin that lacks the suffix, so offering both only invites a wrong pick.
 */
const CODING_VARIANT = /-c$/i

/**
 * Routes that carry a model name but never answer a chat request.
 *
 * A name convention, not capability metadata, and the only judge available: the
 * site files its image, embedding, music, and video models under the same
 * `openai` / `gemini` surfaces a chat model uses, because that is genuinely the
 * path they are called on. So `supported_endpoint_types` cannot tell a chat
 * model from a media model that shares the surface, and a model the console
 * does not describe has no other declaration to read. Delete this pattern the
 * day the site publishes the model's kind.
 */
const NON_TEXT = /(image|tts|transcribe|asr|embedding|lyria|midjourney|nano-banana|veo|imagen|dall-e|^sd\d)/i

/**
 * The downstream surfaces that answer a chat request. A model the site
 * declares without any of these is a media, embedding, or rerank route, and the
 * endpoint list is the site's own statement rather than a guess from the name.
 */
const CHAT_ENDPOINTS: ReadonlySet<string> = new Set(['openai', 'openai-response', 'anthropic', 'gemini'])

/** Display spelling of each level the site may declare. */
const LEVEL_LABELS: Readonly<Record<string, string>> = {
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'XHigh',
  max: 'Max',
}

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
export function isChatOffering(model: string, endpoints?: readonly string[]): boolean {
  // A media or coding-twin name never answers a chat request, whatever the site
  // declares for it: the pricing endpoint files image, TTS, and embedding routes
  // under the same `openai` surface a chat model has.
  if (NON_TEXT.test(model) || CODING_VARIANT.test(model)) return false
  if (endpoints === undefined || endpoints.length === 0) return true
  return endpoints.some(endpoint => CHAT_ENDPOINTS.has(endpoint))
}

/** Everything that can answer one model's input modalities. */
export interface ModalitySources {
  /** What the site's console states for this exact model. */
  reported?: readonly string[]
  /** The operator's configuration for this bare model name. */
  declared?: readonly string[]
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
export function inputModalitiesOf(sources: ModalitySources = {}): readonly string[] {
  if (sources.declared !== undefined && sources.declared.length > 0) return sources.declared
  if (sources.reported !== undefined && sources.reported.length > 0) return sources.reported
  return ['text']
}

/** Everything that can answer one model's reasoning levels. */
export interface ReasoningSources {
  /** What the site's console states for this exact model. */
  reported?: readonly string[]
  /** The operator's configuration for this bare model name. */
  declared?: readonly string[]
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
export function reasoningLevels(sources: ReasoningSources = {}): readonly string[] | undefined {
  if (sources.declared !== undefined && sources.declared.length > 0) return sources.declared
  if (sources.reported !== undefined && sources.reported.length > 0) return sources.reported
  return undefined
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
 * the configured fallback.
 * @param sources - the three candidate answers.
 * @returns a positive token count.
 */
export function contextWindowOf(sources: CapacitySources): number {
  return sources.override ?? sources.reported ?? sources.fallback
}

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
 * @param level - a level id declared by the site.
 * @returns the capitalized name the selector shows.
 */
export function reasoningLevelLabel(level: string): string {
  return LEVEL_LABELS[level] ?? level.charAt(0).toUpperCase() + level.slice(1)
}
