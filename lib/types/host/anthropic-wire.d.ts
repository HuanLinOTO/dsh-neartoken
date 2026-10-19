import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm';
/**
 * Serialize one harness request into an Anthropic messages body.
 *
 * Reasoning is requested as `thinking.type = "adaptive"` with the effort in
 * `output_config`, which every Claude generation behind this gateway accepts.
 * The older `thinking.type = "enabled"` budget form is not portable: models of
 * the Claude 5 generation reject it outright ("requires adaptive thinking"),
 * and an adaptive request still works on the older ones.
 *
 * `max_tokens` is only sent when the caller set one: the gateway does not
 * require it, and inventing a cap would truncate long answers.
 * @param options - the harness request.
 * @param model - the real model id the provider should route to.
 * @returns the ready-to-JSON body object.
 */
export declare function serializeRequest(options: GenerateOptions, model: string): Record<string, unknown>;
/**
 * Parse one streamed Anthropic response into harness chunks.
 * @param response - the streaming fetch response.
 * @param signal - cancellation passthrough for the read loop.
 * @returns the chunk stream.
 */
export declare function parseSse(response: Response, signal: AbortSignal | undefined): AsyncGenerator<StreamChunk>;
