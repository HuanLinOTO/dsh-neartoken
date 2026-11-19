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
export const DEFAULT_DIRECT_ENDPOINT = 'https://direct.neartoken.cc'

/**
 * Pick the origin one `/v1` request is sent to.
 *
 * A custom address the reader stored wins over both origins the switch picks
 * between: it is what they typed, so nothing else may override it.
 * @param siteRoot - the configured site root, without a trailing slash.
 * @param direct - whether the long-connection switch is on.
 * @param endpoint - the configured direct endpoint, without a trailing slash.
 * @param custom - the stored custom endpoint; empty while the reader set none.
 * @returns the origin for the model-facing endpoints.
 */
export function relayBaseURL(
  siteRoot: string,
  direct: boolean,
  endpoint: string = DEFAULT_DIRECT_ENDPOINT,
  custom = '',
): string {
  const chosen = custom.trim()
  if (chosen !== '') return chosen.replace(/\/$/, '')
  return direct ? endpoint.replace(/\/$/, '') : siteRoot
}
