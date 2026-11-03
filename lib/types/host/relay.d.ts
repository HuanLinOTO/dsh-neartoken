/**
 * Which origin the model-facing endpoints use.
 *
 * Every request that carries a conversation — chat completions, messages,
 * responses, generateContent, images — goes through this origin; the dashboard
 * endpoints (`/api/*`: pricing, usage, wallet, top-up) always stay on the site
 * root, because the direct endpoint serves the relay only.
 *
 * @module
 */
/** Default host of the long-lived connection endpoint. */
export declare const DEFAULT_DIRECT_ENDPOINT = "https://direct.neartoken.cc";
/**
 * Pick the origin one `/v1` request is sent to.
 * @param siteRoot - the configured site root, without a trailing slash.
 * @param direct - whether the long-connection switch is on.
 * @param endpoint - the configured direct endpoint, without a trailing slash.
 * @returns the origin for the model-facing endpoints.
 */
export declare function relayBaseURL(siteRoot: string, direct: boolean, endpoint?: string): string;
