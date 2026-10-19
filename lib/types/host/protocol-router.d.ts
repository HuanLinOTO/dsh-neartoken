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
/** The four wires the gateway may be asked in. */
export type WireProtocol = 'chat' | 'anthropic' | 'genai' | 'responses';
/** One wire: where a call goes, how it is signed, built, and read back. */
export interface Wire {
    /** Which vocabulary this wire speaks. */
    readonly protocol: WireProtocol;
    /** Endpoint for one model under a site root without a trailing slash. */
    url(baseURL: string, model: string): string;
    /** Credential and routing headers for one call. */
    headers(key: string, groupRef: string | undefined): Record<string, string>;
    /** The request body for one harness call. */
    serialize(options: GenerateOptions, model: string): Record<string, unknown>;
    /** Parse the streamed answer into harness chunks. */
    parse(response: Response, signal: AbortSignal | undefined): AsyncGenerator<StreamChunk>;
}
/**
 * Pick the wire a bare model name speaks.
 * @param model - the real model id, without its `group::` prefix.
 * @returns the wire to dispatch through; chat completions when unknown.
 */
export declare function wireFor(model: string): Wire;
