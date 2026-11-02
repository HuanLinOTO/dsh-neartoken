/**
 * The identity headers one request to the site carries.
 * @param sessionId - the harness session, when the call has one.
 * @returns `x-dsh-client` always; `x-dsh-session-id` only for a legal session id.
 */
export declare function clientHeaders(sessionId?: string): Record<string, string>;
