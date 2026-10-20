import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm';
import type { WireImages } from './wire-images.ts';
/**
 * Serialize one fully-assembled request into an OpenAI chat-completions body.
 * @param options - the harness request.
 * @param model - the real model id the provider should route to.
 * @returns the ready-to-JSON body object.
 */
export declare function serializeRequest(options: GenerateOptions, model: string, images?: WireImages): Record<string, unknown>;
/**
 * Parse one streamed OpenAI chat-completions response into harness chunks.
 * @param response - the streaming fetch response.
 * @param signal - cancellation passthrough for the read loop.
 * @returns the chunk stream: block-start/delta as they arrive, then
 * block-end/usage/finish once the stream completes.
 */
export declare function parseSse(response: Response, signal: AbortSignal | undefined): AsyncGenerator<StreamChunk>;
