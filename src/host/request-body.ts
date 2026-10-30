/**
 * Request-body compression for the wire calls.
 *
 * Every call carries the whole tool set, so a body is routinely tens to
 * hundreds of kilobytes of repetitive JSON, and a session with a screenshot in
 * it is several megabytes. The upstream (a New API deployment) decompresses a
 * `content-encoding` of gzip, brotli, or zstd before it reads the body — see
 * HANDOFF-new-api.md — so the only question is which encoding buys the most
 * bytes per millisecond.
 *
 * Measured over this plugin's real payloads, brotli at quality 5 takes the
 * typical 120 KB body to 33% and a 2 MB one to 19%, in 3 ms and 30 ms
 * respectively; gzip at level 6 lands 8-14 percentage points higher for the
 * same CPU, zstd level 3 is five times faster but no smaller than gzip, and
 * brotli's own default quality of 11 costs seconds on a multi-megabyte body for
 * one or two points more. Quality 5 is therefore the setting, and Node's brotli
 * is stable back to v10, so nothing here depends on a recent runtime.
 *
 * A body below {@link MIN_COMPRESS_BYTES} travels in the clear: at that size
 * the upload it saves is worth less than the header, the compression, and the
 * decompression on the other side.
 *
 * @module
 */
import { brotliCompress, constants } from 'node:zlib'
import { promisify } from 'node:util'

/**
 * Smallest body, in bytes, that is worth a compression round trip.
 *
 * Below this the saved upload is a few milliseconds even on a slow link, which
 * the fixed cost of encoding and decoding eats.
 */
export const MIN_COMPRESS_BYTES = 16 * 1024

/** Brotli quality to encode at: past this a smaller body costs real CPU. */
const QUALITY = 5

/** The header pair that announces a brotli body. */
const BROTLI_HEADERS: Readonly<Record<string, string>> = { 'content-encoding': 'br' }

const compress = promisify(brotliCompress)

/** One request body ready to send, with the headers its encoding requires. */
export interface EncodedBody {
  /** The bytes to send: the JSON text itself, or its brotli form. */
  readonly body: Uint8Array<ArrayBuffer> | string
  /** Encoding headers; empty when the body travels in the clear. */
  readonly headers: Readonly<Record<string, string>>
  /** Whether {@link EncodedBody.body} is compressed, so a caller can retry in the clear. */
  readonly compressed: boolean
}

/** One body in the clear: the shape every bail-out below returns. */
const CLEAR: { readonly headers: Readonly<Record<string, string>>, readonly compressed: false } = {
  headers: {},
  compressed: false,
}

/** One JSON POST the encoding layer shapes: where it goes, what it sends, how it authenticates. */
export interface JsonPost {
  /** Headers the call needs regardless of encoding. */
  readonly headers: Readonly<Record<string, string>>
  /** The serialized JSON body. */
  readonly json: string
  /** Cancellation passthrough. */
  readonly signal?: AbortSignal | undefined
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
export async function postJson(send: typeof fetch, url: string, request: JsonPost): Promise<Response> {
  const encoded = await encodeBody(request.json)
  const post = (payload: string | Uint8Array<ArrayBuffer>, encoding: Readonly<Record<string, string>>): Promise<Response> =>
    send(url, {
      method: 'POST',
      headers: { ...request.headers, ...encoding },
      body: payload,
      signal: request.signal,
    })
  const response = await post(encoded.body, encoded.headers)
  if (response.status !== 400 || !encoded.compressed) return response
  // A gateway that cannot read the encoding fails while parsing the body, long
  // before a model is reached, and answers exactly as it does for a malformed
  // request. The same body in the clear is the only way to tell the two apart;
  // a rejected request was never billed, so the retry costs one round trip
  // rather than the call.
  await response.body?.cancel().catch(() => {})
  return post(request.json, {})
}

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
export async function encodeBody(json: string): Promise<EncodedBody> {
  const bytes = Buffer.byteLength(json, 'utf8')
  if (bytes < MIN_COMPRESS_BYTES) return { body: json, ...CLEAR }
  try {
    const packed = await compress(Buffer.from(json, 'utf8'), {
      params: { [constants.BROTLI_PARAM_QUALITY]: QUALITY },
    })
    // A payload that does not shrink — an inlined image is already compressed —
    // is sent as it was: the encoding header would buy a decompression step and
    // nothing else.
    if (packed.byteLength >= bytes) return { body: json, ...CLEAR }
    // Copied off the encoder's buffer: `BodyInit` takes an ArrayBuffer-backed
    // view, and the copy is of the packed body — a few hundred kilobytes at most.
    return { body: new Uint8Array(packed), headers: BROTLI_HEADERS, compressed: true }
  } catch {
    return { body: json, ...CLEAR }
  }
}
