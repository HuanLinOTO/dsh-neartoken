/**
 * The invite code a referring page may leave on the browser window, and how it
 * reaches the site's own sign-up pages.
 *
 * The plugin never reads the site's invite configuration and never decides who
 * invited whom: a page that referred the user puts its code on `window`, this
 * module recognizes it, and the confirmation address handed to the site carries
 * it as the `aff` query parameter — the parameter the site's own front end saves
 * for its sign-up form and for the first sign-in of a third-party account. A
 * value that is not a code is dropped rather than repaired: an unusable code must
 * never turn into a failed connection.
 *
 * @module
 */

/** The global a referring page leaves its invite code on. */
export const AFFILIATE_GLOBAL = 'NEARTOKEN_AFF'

/** The query parameter the site's front end reads its invite code from. */
export const AFFILIATE_PARAM = 'aff'

/** What is forwarded: the site's own codes are four characters, so this is slack, not a format. */
const AFFILIATE_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

/**
 * One value accepted as an invite code.
 * @param value - whatever a page or a request body offered.
 * @returns the trimmed code, or undefined when the value is not one.
 */
export function normalizeAffiliateCode(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const code = value.trim()
  return AFFILIATE_PATTERN.test(code) ? code : undefined
}

/**
 * The invite code a referring page left on a browser window.
 * @param scope - the global object to read (`globalThis` in the browser).
 * @returns the code, or undefined when this window carries none.
 */
export function readAffiliateCode(scope: unknown): string | undefined {
  if (typeof scope !== 'object' || scope === null) return undefined
  return normalizeAffiliateCode((scope as Record<string, unknown>)[AFFILIATE_GLOBAL])
}

/**
 * Add the invite code to one of the site's own addresses.
 * @param address - the site's confirmation page, as the site issued it.
 * @param code - the invite code, when there is one.
 * @returns the same address carrying `aff`, or the address unchanged when there
 * is no code or the address is not one this module can parse.
 */
export function withAffiliateCode(address: string, code: string | undefined): string {
  if (code === undefined) return address
  let url: URL
  try {
    url = new URL(address)
  } catch (_error) {
    // A relative or unusable address keeps the site's own words: this module
    // never rewrites what it cannot parse.
    return address
  }
  url.searchParams.set(AFFILIATE_PARAM, code)
  return url.toString()
}
