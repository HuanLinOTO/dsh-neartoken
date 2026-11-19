import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm';
import type { WireImages } from './wire-images.ts';
/**
 * Serialize one harness request into a stateless responses body.
 * @param options - the harness request.
 * @param model - the real model id the provider should route to.
 * @param images - the images this request inlined, keyed by attachment id.
 * @returns the ready-to-JSON body object.
 */
export declare function serializeRequest(options: GenerateOptions, model: string, images?: WireImages): Record<string, unknown>;
/**
 * Serialize one harness request into a stateful responses body.
 *
 * The site holds the conversation, so a request that follows a turn it stored
 * names that turn and sends only what came after it. The reasoning items the
 * stateless path replays are not sent: they live on the site with everything
 * else, and the ciphertext that makes them replayable is never requested here.
 * @param options - the harness request.
 * @param model - the real model id the provider should route to.
 * @param images - the images this request inlined, keyed by attachment id.
 * @returns the ready-to-JSON body object.
 */
export declare function serializeStatefulRequest(options: GenerateOptions, model: string, images?: WireImages): Record<string, unknown>;
/** What the request that produced this stream asked the upstream for. */
export interface ParseOptions {
    /**
     * Whether the request asked the upstream to store the turn. A stored turn is
     * replayed by its id, not by the reasoning ciphertext.
     */
    readonly stateful?: boolean;
}
/**
 * Parse one streamed responses response into harness chunks.
 * @param response - the streaming fetch response.
 * @param signal - cancellation passthrough for the read loop.
 * @param options - what the request asked the upstream for.
 * @returns the chunk stream.
 */
export declare function parseSse(response: Response, signal: AbortSignal | undefined, options?: ParseOptions): AsyncGenerator<StreamChunk>;
