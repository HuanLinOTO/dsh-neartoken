/**
 * Provider-neutral classification of a gateway refusal or transport failure.
 *
 * The retry plugin (dsh-llm-retry, shipped in the base bundle) executes the
 * route's policy on every failed model request, and the default policy retries
 * only the shared transient codes: RATE_LIMIT, SERVER, TIMEOUT, TRANSPORT, and
 * EMPTY_RESPONSE. A refusal thrown as PROVIDER_ERROR matches none of them, so
 * a single transient gateway hiccup ended the whole turn — the "stops on the
 * first error, never retries" behavior. Every refusal here is mapped onto the
 * shared taxonomy instead, mirroring llm-deepseek's transport classification,
 * so the retry policy sees the failure class it already knows how to wait out.
 *
 * @module
 */
import { LlmError } from '@deepseek-ai/dsh-llm';
/**
 * Classify one gateway refusal (a non-2xx answer or a rejected body).
 *
 * Codes follow the shared taxonomy: AUTH only for credentials the gateway
 * refused (401, `authentication_error`, `permission_error`), QUOTA for an
 * exhausted balance, RATE_LIMIT for throttling, SERVER for the gateway's own
 * failures, INVALID_REQUEST for a request it will always reject, and
 * `HTTP_<status>` for anything else. A 403 stays distinct: a gateway answers
 * it for a policy or account suspension as readily as for a bad key, and the
 * client renders AUTH as "the API key is invalid", which would report a
 * suspension as a credential problem. Only RATE_LIMIT and SERVER are transient
 * by default; the policy provider owns the rest.
 * @param body - the raw error response body.
 * @param status - the HTTP status the gateway answered with.
 * @param headers - the response headers, for `retry-after` and request identity.
 * @returns the classified error; never retry-after longer than the caller is told about.
 */
export declare function gatewayError(body: string, status: number, headers?: Headers): LlmError;
/**
 * Classify a failure that arrived mid-stream, after the body was accepted.
 *
 * A stream that dies after a healthy start is a gateway-side failure: the
 * request itself was valid, so the shared taxonomy carries it as SERVER and
 * the default retry policy waits it out.
 * @param detail - the failure text the stream carried.
 * @returns the classified error.
 */
export declare function streamFailure(detail: string): LlmError;
/**
 * Classify a transport-level failure: the request or its body read never
 * finished.
 *
 * undici wraps the underlying cause in a `TypeError: fetch failed` before a
 * response exists, and fails an established body read with a bare
 * `TypeError: terminated` when the socket drops mid-answer; the chain is
 * rendered into the message either way, so the real failure (DNS, TLS, reset,
 * dropped socket) is not masked by the wrapper.
 * @param error - the value the fetch or the body read rejected with.
 * @returns the classified error, chained to the original.
 */
export declare function transportFailure(error: unknown): LlmError;
