/**
 * The SSE plumbing the four wires share: turn a streaming body into `data:`
 * payloads, and read JSON fields without trusting their type.
 *
 * Every value here comes off the wire, so nothing may be assumed: a field the
 * gateway sends as `null` is as ordinary as one it omits, and reading through
 * it would throw and kill the whole stream mid-answer.
 *
 * @module
 */
/**
 * Read one JSON value as an object.
 * @param value - any decoded JSON value.
 * @returns the object, or undefined for null, an array, or a primitive.
 */
export declare function asObject(value: unknown): Record<string, unknown> | undefined;
/**
 * Read one JSON value as an array of unknown entries.
 * @param value - any decoded JSON value.
 * @returns the array, or an empty array for anything else.
 */
export declare function asArray(value: unknown): readonly unknown[];
/**
 * Read a finite number from an unknown field.
 * @param value - the candidate.
 * @returns the number, or undefined for anything else (including numeric strings).
 */
export declare function numberOf(value: unknown): number | undefined;
/**
 * Read a string from an unknown field.
 * @param value - the candidate.
 * @returns the string, or undefined.
 */
export declare function stringOf(value: unknown): string | undefined;
/**
 * Yield every `data:` payload of one SSE response, in arrival order.
 *
 * The `[DONE]` sentinel, comments, and blank lines are skipped. A payload split
 * across two reads is reassembled, and a final payload with no trailing newline
 * is still yielded: a stream that ends mid-line must not lose its last event.
 * @param response - the streaming fetch response.
 * @param signal - cancellation passthrough for the read loop.
 * @returns the payload strings, `[DONE]` excluded.
 */
export declare function sseData(response: Response, signal: AbortSignal | undefined): AsyncGenerator<string>;
/**
 * Unwrap one JSON `data:` payload.
 * @param payload - the raw payload text.
 * @returns the parsed object, or undefined when it is not a JSON object.
 */
export declare function parseJsonObject(payload: string): Record<string, unknown> | undefined;
