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
export declare const AFFILIATE_GLOBAL = "NEARTOKEN_AFF";
/** The query parameter the site's front end reads its invite code from. */
export declare const AFFILIATE_PARAM = "aff";
/**
 * One value accepted as an invite code.
 * @param value - whatever a page or a request body offered.
 * @returns the trimmed code, or undefined when the value is not one.
 */
export declare function normalizeAffiliateCode(value: unknown): string | undefined;
/**
 * The invite code a referring page left on a browser window.
 * @param scope - the global object to read (`globalThis` in the browser).
 * @returns the code, or undefined when this window carries none.
 */
export declare function readAffiliateCode(scope: unknown): string | undefined;
/**
 * Add the invite code to one of the site's own addresses.
 * @param address - the site's confirmation page, as the site issued it.
 * @param code - the invite code, when there is one.
 * @returns the same address carrying `aff`, or the address unchanged when there
 * is no code or the address is not one this module can parse.
 */
export declare function withAffiliateCode(address: string, code: string | undefined): string;
