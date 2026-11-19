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
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm';
import type { WireImages } from './wire-images.ts';
/** The four wires the gateway may be asked in. */
export type WireProtocol = 'chat' | 'anthropic' | 'genai' | 'responses';
/**
 * What the site declares about one catalog route's wire.
 *
 * A declaration wins over the model's family name, because the site is the one
 * that knows how it forwards a model; a route that declares nothing keeps the
 * name-based choice.
 */
export interface WireDeclaration {
    /** The wire the site declared for this route, if it declared one. */
    readonly apiStyle?: WireProtocol;
    /** Whether the site stores the Responses turn server-side for this route. */
    readonly statefulResponses?: boolean;
}
/** One wire: where a call goes, how it is signed, built, and read back. */
export interface Wire {
    /** Which vocabulary this wire speaks. */
    readonly protocol: WireProtocol;
    /** Endpoint for one model under a site root without a trailing slash. */
    url(baseURL: string, model: string): string;
    /** Credential, routing, and identity headers for one call. */
    headers(key: string, groupRef: string | undefined, sessionId: string | undefined): Record<string, string>;
    /** The request body for one harness call, with the request's images inlined. */
    serialize(options: GenerateOptions, model: string, images: WireImages): Record<string, unknown>;
    /** Parse the streamed answer into harness chunks. */
    parse(response: Response, signal: AbortSignal | undefined): AsyncGenerator<StreamChunk>;
}
/**
 * The stateless Responses wire: the whole history on every request.
 *
 * A stateful turn the upstream refuses is retried through this one, and a
 * route that declared no stateful support uses it from the start.
 */
export declare const RESPONSES_STATELESS: Wire;
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
export declare function wireFor(model: string, declared?: WireDeclaration): Wire;
