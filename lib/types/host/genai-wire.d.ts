import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm';
import type { WireImages } from './wire-images.ts';
/**
 * Serialize one harness request into a genai request body.
 * @param options - the harness request.
 * @param model - the real model id the provider should route to; genai carries
 * it in the URL, so the body does not repeat it.
 * @returns the ready-to-JSON body object.
 */
export declare function serializeRequest(options: GenerateOptions, model: string, images?: WireImages): Record<string, unknown>;
/**
 * Parse one streamed genai response into harness chunks.
 * @param response - the streaming fetch response.
 * @param signal - cancellation passthrough for the read loop.
 * @returns the chunk stream.
 */
export declare function parseSse(response: Response, signal: AbortSignal | undefined): AsyncGenerator<StreamChunk>;
