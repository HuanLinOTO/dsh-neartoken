/**
 * Smallest body, in bytes, that is worth a compression round trip.
 *
 * Below this the saved upload is a few milliseconds even on a slow link, which
 * the fixed cost of encoding and decoding eats.
 */
export declare const MIN_COMPRESS_BYTES: number;
/** One request body ready to send, with the headers its encoding requires. */
export interface EncodedBody {
    /** The bytes to send: the JSON text itself, or its brotli form. */
    readonly body: Uint8Array<ArrayBuffer> | string;
    /** Encoding headers; empty when the body travels in the clear. */
    readonly headers: Readonly<Record<string, string>>;
    /** Whether {@link EncodedBody.body} is compressed, so a caller can retry in the clear. */
    readonly compressed: boolean;
}
/** One JSON POST the encoding layer shapes: where it goes, what it sends, how it authenticates. */
export interface JsonPost {
    /** Headers the call needs regardless of encoding. */
    readonly headers: Readonly<Record<string, string>>;
    /** The serialized JSON body. */
    readonly json: string;
    /** Cancellation passthrough. */
    readonly signal?: AbortSignal | undefined;
}
/**
 * POST one JSON body, compressed when that pays for itself.
 *
 * The one place a call leaves this plugin, so the threshold, the encoding, and
 * the fallback below cannot drift between the chat wires and the picture
 * channel.
 * @param send - the HTTP carrier, so a test or a caller can substitute one.
 * @param url - absolute endpoint.
 * @param request - headers, body, and cancellation.
 * @returns the response, compressed or not; never a response the caller has to discard.
 */
export declare function postJson(send: typeof fetch, url: string, request: JsonPost): Promise<Response>;
/**
 * Compress one request body, when that pays for itself.
 *
 * Compression is an optimization on top of a request that must go out either
 * way, so every failure here — a runtime without brotli, a body that does not
 * shrink, an encoder error — sends the body in the clear rather than failing
 * the call.
 * @param json - the serialized request body.
 * @returns the bytes to send, the headers they need, and whether they are packed.
 */
export declare function encodeBody(json: string): Promise<EncodedBody>;
