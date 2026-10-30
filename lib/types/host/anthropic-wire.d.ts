import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm';
import type { WireImages } from './wire-images.ts';
/**
 * Serialize one harness request into an Anthropic messages body.
 *
 * The turn list is settled into the pairing the messages API checks: every
 * `tool_use` of an assistant turn is answered by a `tool_result` in the single
 * user turn that follows it, calls the harness never recorded a result for are
 * answered with a placeholder, results are collected into one turn rather than
 * one turn each (a parallel batch of calls and a split batch of results are
 * refused as unpaired), and adjacent same-role turns are folded into one.
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
export declare function serializeRequest(options: GenerateOptions, model: string, images?: WireImages): Record<string, unknown>;
/**
 * Parse one streamed Anthropic response into harness chunks.
 * @param response - the streaming fetch response.
 * @param signal - cancellation passthrough for the read loop.
 * @returns the chunk stream.
 */
export declare function parseSse(response: Response, signal: AbortSignal | undefined): AsyncGenerator<StreamChunk>;
