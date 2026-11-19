/**
 * Which upstream wire a model speaks.
 *
 * The site is one OpenAI-compatible gateway, but the models behind it do not
 * share a wire: Claude answers the Anthropic messages API, Gemini the
 * generateContent API, and GPT the Responses API. Everything else — DeepSeek,
 * Qwen, Grok, the open-weight tail — still answers chat completions.
 *
 * The choice is made from the bare model name alone, so a catalog id and its
 * `group::` prefix always route the same way.
 *
 * @module
 */
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { clientHeaders } from '../client-identity.ts'
import { parseSse as parseAnthropic, serializeRequest as serializeAnthropic } from './anthropic-wire.ts'
import type { WireImages } from './wire-images.ts'
import { parseSse as parseGenai, serializeRequest as serializeGenai } from './genai-wire.ts'
import {
  parseSse as parseResponses, serializeRequest as serializeResponses, serializeStatefulRequest,
} from './responses-wire.ts'
import { parseSse as parseChat, serializeRequest as serializeChat } from './openai-wire.ts'

/** The four wires the gateway may be asked in. */
export type WireProtocol = 'chat' | 'anthropic' | 'genai' | 'responses'

/**
 * What the site declares about one catalog route's wire.
 *
 * A declaration wins over the model's family name, because the site is the one
 * that knows how it forwards a model; a route that declares nothing keeps the
 * name-based choice.
 */
export interface WireDeclaration {
  /** The wire the site declared for this route, if it declared one. */
  readonly apiStyle?: WireProtocol
  /** Whether the site stores the Responses turn server-side for this route. */
  readonly statefulResponses?: boolean
}

/** One wire: where a call goes, how it is signed, built, and read back. */
export interface Wire {
  /** Which vocabulary this wire speaks. */
  readonly protocol: WireProtocol
  /** Endpoint for one model under a site root without a trailing slash. */
  url(baseURL: string, model: string): string
  /** Credential, routing, and identity headers for one call. */
  headers(key: string, groupRef: string | undefined, sessionId: string | undefined): Record<string, string>
  /** The request body for one harness call, with the request's images inlined. */
  serialize(options: GenerateOptions, model: string, images: WireImages): Record<string, unknown>
  /** Parse the streamed answer into harness chunks. */
  parse(response: Response, signal: AbortSignal | undefined): AsyncGenerator<StreamChunk>
}

/**
 * The group reference header, present only when the site published one.
 * @param groupRef - the site's own ASCII reference for the group, if any.
 * @returns the header pair, or an empty object.
 */
function groupHeader(groupRef: string | undefined): Record<string, string> {
  return groupRef === undefined ? {} : { 'x-neartoken-group': groupRef }
}

const CHAT: Wire = {
  protocol: 'chat',
  url: (baseURL) => `${baseURL}/v1/chat/completions`,
  headers: (key, groupRef, sessionId) => ({
    authorization: `Bearer ${key}`,
    'content-type': 'application/json',
    ...groupHeader(groupRef),
    ...clientHeaders(sessionId),
  }),
  serialize: serializeChat,
  parse: parseChat,
}

const ANTHROPIC: Wire = {
  protocol: 'anthropic',
  url: (baseURL) => `${baseURL}/v1/messages`,
  // The messages API signs with x-api-key; the bearer is repeated because a
  // gateway may authenticate the request before it forwards it.
  headers: (key, groupRef, sessionId) => ({
    'x-api-key': key,
    authorization: `Bearer ${key}`,
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json',
    ...groupHeader(groupRef),
    ...clientHeaders(sessionId),
  }),
  serialize: serializeAnthropic,
  parse: parseAnthropic,
}

/**
 * Encode one model id as a URL path segment sequence.
 *
 * A catalog id may carry a `vendor/` prefix, which is part of the route the
 * gateway matches on; percent-encoding the separators would fold the whole id
 * into a single segment and miss it.
 * @param model - the bare model id.
 * @returns the path-safe form, separators preserved.
 */
function modelPath(model: string): string {
  return model.split('/').map(segment => encodeURIComponent(segment)).join('/')
}

const GENAI: Wire = {
  protocol: 'genai',
  url: (baseURL, model) => `${baseURL}/v1beta/models/${modelPath(model)}:streamGenerateContent?alt=sse`,
  headers: (key, groupRef, sessionId) => ({
    'x-goog-api-key': key,
    authorization: `Bearer ${key}`,
    'content-type': 'application/json',
    ...groupHeader(groupRef),
    ...clientHeaders(sessionId),
  }),
  serialize: serializeGenai,
  parse: parseGenai,
}

const RESPONSES: Wire = {
  protocol: 'responses',
  url: (baseURL) => `${baseURL}/v1/responses`,
  headers: (key, groupRef, sessionId) => ({
    authorization: `Bearer ${key}`,
    'content-type': 'application/json',
    ...groupHeader(groupRef),
    ...clientHeaders(sessionId),
  }),
  serialize: serializeResponses,
  parse: parseResponses,
}

/**
 * The Responses wire with the turn held upstream.
 *
 * It shares the stateless wire's endpoint, headers, and event vocabulary; only
 * the body and the replay state it records differ, which is what makes a
 * refused stateful turn able to fall back to {@link RESPONSES_STATELESS}.
 */
const RESPONSES_STATEFUL: Wire = {
  protocol: 'responses',
  url: RESPONSES.url,
  headers: RESPONSES.headers,
  serialize: serializeStatefulRequest,
  parse: (response, signal) => parseResponses(response, signal, { stateful: true }),
}

/**
 * The stateless Responses wire: the whole history on every request.
 *
 * A stateful turn the upstream refuses is retried through this one, and a
 * route that declared no stateful support uses it from the start.
 */
export const RESPONSES_STATELESS: Wire = RESPONSES

/** Family prefixes that do not speak chat completions. */
const ANTHROPIC_PREFIXES = ['claude', 'anthropic']
/** Gemini's own family name and its proxied alias. */
const GENAI_PREFIXES = ['gemini', 'gemma', 'google/']
/** GPT answers the Responses API; the o-series reasoning models do too. */
const RESPONSES_PREFIXES = ['gpt', 'chatgpt', 'codex', 'o1', 'o3', 'o4']
/** A vendor prefix in front of the family, as some routes publish it. */
const VENDOR_PREFIX = /^(?:[a-z0-9-]+\/)+/

/** The wire each declared style names. */
const DECLARED_WIRES: Readonly<Record<WireProtocol, Wire>> = {
  chat: CHAT,
  anthropic: ANTHROPIC,
  genai: GENAI,
  responses: RESPONSES,
}

/**
 * Pick the wire a bare model name speaks, by its family.
 * @param model - the real model id, without its `group::` prefix.
 * @returns the wire of that family; chat completions when nothing matches.
 */
function wireByName(model: string): Wire {
  const name = model.trim().toLowerCase().replace(VENDOR_PREFIX, '')
  if (ANTHROPIC_PREFIXES.some(prefix => name.startsWith(prefix))) return ANTHROPIC
  if (GENAI_PREFIXES.some(prefix => name.startsWith(prefix))) return GENAI
  if (RESPONSES_PREFIXES.some(prefix => name.startsWith(prefix))) return RESPONSES
  return CHAT
}

/**
 * Pick the wire a bare model name speaks.
 *
 * What the site declares for the route wins: a model it forwards to the
 * Responses API is asked there whatever its name says, and the reverse holds
 * for a GPT-named model it forwards to chat completions.
 *
 * Holding the turn is a separate declaration, and it applies to whichever wire
 * the route resolves to: an operator who only ticked `responses_stateful` gets
 * the stateful wire on a model whose name already resolves to Responses, and a
 * route that resolves to any other wire is unaffected by the flag.
 * @param model - the real model id, without its `group::` prefix.
 * @param declared - what the site published for this route, when it published anything.
 * @returns the wire to dispatch through; chat completions when nothing decides.
 */
export function wireFor(model: string, declared?: WireDeclaration): Wire {
  const base = declared?.apiStyle === undefined ? wireByName(model) : DECLARED_WIRES[declared.apiStyle]
  if (base.protocol !== 'responses' || declared?.statefulResponses !== true) return base
  return RESPONSES_STATEFUL
}
