/**
 * The NearToken LLM adapter: one provider route over a New API deployment,
 * whose model catalog is the (group, model) expansion of the pricing endpoint.
 *
 * Catalog model ids are `"<group>::<model>"`; the adapter decodes them at
 * dispatch and sends the bare model name in the request body.
 *
 * The group itself travels in the `x-neartoken-group` request header as the
 * site's own ASCII reference (`"#7"`), never as the group name: a name is
 * display text, and its non-latin1 characters are not a legal HTTP header
 * value. A group the site published no reference for sends no header at all
 * and routes by the token's own group (see HANDOFF).
 *
 * The wire is chosen per model (see `protocol-router.ts`): Claude goes to the
 * messages API, Gemini to generateContent, GPT to the Responses API, and the
 * rest of the catalog stays on chat completions.
 */
import { brandString } from '@deepseek-ai/dsh-brand'
import { attributionHeaders, LlmAdapter } from '@deepseek-ai/dsh-llm'
import type {
  GenerateOptions, LlmModelInfo, LlmModelReasoningInfo, LlmResolvedModelInfo, ModelModality, ReasoningEffortId, StreamChunk,
} from '@deepseek-ai/dsh-llm'
import type { NearTokenRoute } from './pricing.ts'
import {
  contextWindowOf, defaultReasoningLevel, inputModalitiesOf, maxTokensOf, reasoningLevelLabel, reasoningLevels,
} from './model-caps.ts'
import type { ModalitySources, ReasoningSources } from './model-caps.ts'
import { wireFor } from './protocol-router.ts'
import { transportFailure } from './wire-error.ts'
import { inlineImages } from './wire-images.ts'
import type { ImageRequestPolicy } from './wire-images.ts'
import type { ImageSource } from './wire-images.ts'
import { selectedRoutes } from './whitelist.ts'

/** Display name of the single provider route this adapter owns. */
export const NEARTOKEN_PROVIDER_NAME = 'NearToken'

/** What an operator may state about one bare model name in the plugin configuration. */
export interface NearTokenModelOverride {
  /** Context capacity in tokens, overriding what the site declares. */
  readonly contextWindow?: number
  /** Output ceiling in tokens; the only source that puts `max_tokens` on the wire. */
  readonly maxTokens?: number
  /** Selectable reasoning levels, for a model whose levels the site does not declare. */
  readonly reasoning?: readonly string[]
  /** Input modalities; the harness only permits an image request to a model that declares `image`. */
  readonly input?: readonly string[]
}

/**
 * The configured or declared modalities as the harness vocabulary.
 * @param sources - the site's statement and the operator's configuration.
 * @returns only the modalities this harness version understands.
 */
function modalitiesOf(sources: ModalitySources): readonly ModelModality[] {
  return inputModalitiesOf(sources)
    .filter((modality): modality is ModelModality => modality === 'text' || modality === 'image')
}

/**
 * The reasoning offering for one model, or nothing.
 *
 * Configured levels win; otherwise they are the ones the site declares. A model
 * neither source describes is advertised without any, rather than with levels it
 * may not have.
 * @param sources - the site's statement and the operator's configuration.
 * @returns the reasoning metadata, or undefined for a model without levels.
 */
function reasoningOf(sources: ReasoningSources): LlmModelReasoningInfo | undefined {
  const levels = reasoningLevels(sources)
  if (levels === undefined) return undefined
  return {
    efforts: levels.map(level => ({
      id: brandString<ReasoningEffortId>(level),
      name: reasoningLevelLabel(level),
    })),
    defaultEffort: brandString<ReasoningEffortId>(defaultReasoningLevel(levels)),
  }
}

/** External facts the adapter reads at call time. */
export interface NearTokenDeps {
  /** The expanded (group, model) routes, loaded and cached by the host entry. */
  routes: () => Promise<readonly NearTokenRoute[]>
  /**
   * The model names the user keeps visible; empty advertises the whole catalog.
   * Dispatch ignores it: a session already on a now-hidden model still routes.
   */
  enabled: () => readonly string[]
  /** Resolves the bearer key; throws MISSING_CREDENTIAL when absent. */
  apiKey: () => Promise<string>
  /** Site root without a trailing slash. */
  baseURL: () => string
  /**
   * The capacity every model without a better answer reports. A harness model
   * without a context window loses automatic compaction, so this is never
   * undefined.
   */
  defaultContextWindow: () => number
  /** The operator's configuration for one bare model name, when they wrote any. */
  modelOverride: (model: string) => NearTokenModelOverride | undefined
  /** The attachment service, which owns the bytes behind a message's images. */
  attachments: () => ImageSource | undefined
  /** The bounds every request image is re-encoded to before it is sent. */
  imagePolicy: () => ImageRequestPolicy
}

/**
 * Decode one catalog model id into its routing parts.
 * @param id - a catalog id ("`[低价] Grok::grok-4.6`") or a bare model name.
 * @returns the group (when the id carries one) and the real model name.
 */
export function decodeRoute(id: string): { group?: string; model: string } {
  // Last, not first: a group name may itself contain '::', and the catalog id's
  // own separator is the one closest to the model.
  const at = id.lastIndexOf('::')
  if (at <= 0) return { model: id }
  return { group: id.slice(0, at), model: id.slice(at + 2) }
}

/** The NearToken provider adapter. */
export class NearTokenAdapter extends LlmAdapter {
  /**
   * @param deps - routing, credential, and endpoint facts from the host entry.
   */
  constructor(private readonly deps: NearTokenDeps) {
    super()
  }

  /**
   * @param provider - the route this adapter registered (`neartoken`).
   * @returns detached display metadata.
   */
  override providerInfo(provider: string): { id: string; name: string } {
    return { id: provider, name: NEARTOKEN_PROVIDER_NAME }
  }

  /**
   * Advertise the visible (group, model) routes as the provider catalog.
   * @param provider - the route this adapter registered.
   * @returns one model entry per group offering, in endpoint order.
   */
  override async listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    const routes = selectedRoutes(await this.deps.routes(), this.deps.enabled())
    return routes.map(route => ({
      provider,
      id: route.id,
      name: route.name,
      description: route.description,
      inputModalities: modalitiesOf({
        ...route.input === undefined ? {} : { reported: route.input },
        ...this.deps.modelOverride(route.model)?.input === undefined
          ? {}
          : { declared: this.deps.modelOverride(route.model)?.input },
      }),
    }))
  }

  /**
   * Resolve one exact route's metadata from the same generation as dispatch.
   * @param provider - the route this adapter registered.
   * @param model - the catalog id passed to `GenerateOptions.model`.
   * @returns route identity plus the model's capacity and reasoning levels.
   */
  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    // The same filter as the catalog: a hidden model has no metadata here either.
    const routes = selectedRoutes(await this.deps.routes(), this.deps.enabled())
    const route = routes.find(entry => entry.id === model)
    const bare = route?.model ?? decodeRoute(model).model
    const override = this.deps.modelOverride(bare)
    const reasoning = reasoningOf({
      ...route?.reasoning === undefined ? {} : { reported: route.reasoning },
      ...override?.reasoning === undefined ? {} : { declared: override.reasoning },
    })
    const contextWindow = contextWindowOf({
      ...override?.contextWindow === undefined ? {} : { override: override.contextWindow },
      ...route?.contextWindow === undefined ? {} : { reported: route.contextWindow },
      fallback: this.deps.defaultContextWindow(),
    })
    const maxTokens = maxTokensOf(route?.maxTokens, override?.maxTokens)
    const facts = {
      context: { contextWindow },
      inputModalities: modalitiesOf({
        ...route?.input === undefined ? {} : { reported: route.input },
        ...override?.input === undefined ? {} : { declared: override.input },
      }),
      ...maxTokens === undefined ? {} : { defaultMaxTokens: maxTokens },
      ...reasoning === undefined ? {} : { reasoning },
    }
    if (route === undefined) {
      // An unlisted id (or one from a stale catalog) still routes: the harness
      // contract keeps this query advisory.
      return { provider, id: model, name: model, ...facts }
    }
    return {
      provider,
      id: route.id,
      name: route.name,
      description: route.description,
      ...facts,
    }
  }

  /**
   * Stream one model call through the wire its model speaks: Claude's messages
   * API, Gemini's generateContent, the Responses API for GPT, and chat
   * completions for everything else.
   * @param options - the fully-assembled request; the abort signal is honored.
   * @returns the parsed chunk stream.
   */
  override async *stream(options: GenerateOptions): AsyncGenerator<StreamChunk> {
    const key = await this.deps.apiKey()
    const { model } = decodeRoute(options.model)
    // The group travels as the site's own ASCII reference, never as the group
    // name: a name is display text, and its non-latin1 characters are not a
    // legal HTTP header value.
    const route = (await this.deps.routes()).find(entry => entry.id === options.model)
    const groupRef = route?.groupRef
    const wire = wireFor(model)
    // Images are inlined before the body is built: a wire that cannot see them
    // must not quietly send text only, which is exactly what a dropped
    // screenshot looks like to the model on the other end. The store re-encodes
    // each one within the configured bounds first, so a large screenshot does not
    // travel at its file size.
    const images = await inlineImages(
      this.deps.attachments(), options.messages, options.signal, this.deps.imagePolicy(),
    )
    let response: Response
    try {
      response = await fetch(wire.url(this.deps.baseURL(), model), {
        method: 'POST',
        headers: {
          ...attributionHeaders(),
          ...wire.headers(key, groupRef),
        },
        body: JSON.stringify(wire.serialize(options, model, images)),
        signal: options.signal,
      })
    } catch (error) {
      // A caller cancellation is not a transport failure; surface it unchanged.
      if (options.signal?.aborted) throw error
      throw transportFailure(error)
    }
    yield* wire.parse(response, options.signal)
  }
}
