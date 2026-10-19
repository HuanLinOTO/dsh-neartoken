/**
 * The one HTTP call every site endpoint shares, and the error taxonomy of the
 * answers it can get.
 *
 * Both the dashboard endpoints and the device-authorization endpoints answer the
 * same `{ success, message, data }` envelope, but the device poll reports its
 * normal states as `success: false` — so this module hands back the parsed body
 * untouched and leaves every judgement to the caller. Only an unreachable site
 * or an unparsable body is an error here.
 *
 * @module
 */
import { HarnessError } from '@deepseek-ai/dsh-llm';
/** One JSON object, as the dashboard endpoints are read here. */
export type JsonObject = Record<string, unknown>;
/**
 * A dashboard call that could not produce the answer it was made for. The code
 * names which layer refused: transport, HTTP status, or the site's own body.
 */
export declare class NewApiError extends HarnessError {
    /**
     * @param message - what was called and what came back.
     * @param code - the failure layer (`NEW_API_UNREACHABLE`, `NEW_API_REFUSED`, `NEW_API_RESPONSE_INVALID`).
     * @param options - the underlying cause, when there is one.
     */
    constructor(message: string, code: string, options?: ErrorOptions);
}
/** Where one call goes and which bearer value it presents. */
export interface NewApiCall {
    /** Site root without a trailing slash. */
    baseURL: string;
    /** Bearer value the call presents; omitted on the anonymous calls. */
    sessionToken?: string;
    /** Path below the site root, query string included. */
    path: string;
    /** HTTP method. */
    method: 'GET' | 'POST';
    /** JSON body, when the call carries one. */
    body?: JsonObject;
}
/**
 * Read one JSON object, or say the value is not one.
 * @param value - any parsed JSON value.
 * @returns the value when it is a plain object.
 */
export declare function asObject(value: unknown): JsonObject | undefined;
/**
 * Call one endpoint and return its whole body WITHOUT treating `success: false`
 * as a failure.
 *
 * The device-authorization poll is the reason this exists: every answer that is
 * not a grant — still waiting, polled too fast, denied, expired — is a body with
 * `success: false` and one fixed message string, and reading that string is
 * exactly what the caller needs to do. Only an unreachable site or an unparsable
 * body is an error here.
 * @param call - the endpoint, its method, and its body.
 * @returns the parsed JSON body.
 * @throws {NewApiError} when the site could not be reached or answered non-JSON.
 */
export declare function callNewApiBody(call: NewApiCall): Promise<JsonObject>;
