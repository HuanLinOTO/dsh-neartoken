/**
 * The site's top-up surface, as the settings card needs it: the amount ladder,
 * the enabled gateway methods, and the signed checkout link the plugin opens.
 *
 * The site only starts an order for a key the DSH device-authorization flow
 * minted; every other key is answered with 403 DSH_TOKEN_REQUIRED, which this
 * module turns into a reason the page can act on.
 *
 * @module
 */
import { computeAmountError, type NearTokenTopupInfo, type NearTokenTopupMethod, type NearTokenTopupOrder } from '../protocol.ts';
import { type JsonObject } from './new-api.ts';
export { computeAmountError };
export type { NearTokenTopupInfo, NearTokenTopupMethod, NearTokenTopupOrder };
/** Why a top-up request could not be answered. */
export type NearTokenTopupReason = 'not-dsh' | 'unavailable' | 'refused' | 'unreachable';
/** A refused top-up request, tagged with the reason the page renders. */
export declare class NearTokenTopupError extends Error {
    /** What the page should offer instead of a payment button. */
    readonly reason: NearTokenTopupReason;
    /** What the site said, when it said anything. */
    readonly siteMessage: string | undefined;
    /**
     * @param reason - which failure this is.
     * @param siteMessage - the site's own wording, when it sent one.
     */
    constructor(reason: NearTokenTopupReason, siteMessage?: string);
}
/**
 * Read the `GET /api/dsh/device/topup/info` answer.
 * @param body - the parsed JSON envelope.
 * @returns the offer, or undefined when the site refused.
 */
export declare function parseTopupInfo(body: JsonObject): NearTokenTopupInfo | undefined;
/**
 * Read one order answer.
 * @param body - the parsed JSON envelope.
 * @returns the order number and the site-relative checkout link.
 */
export declare function parseTopupOrder(body: JsonObject): NearTokenTopupOrder | undefined;
/**
 * Ask the site what it offers.
 * @param baseURL - site root without a trailing slash.
 * @param key - the stored relay key.
 * @returns the offer.
 * @throws {NearTokenTopupError} when the site refused or could not be reached.
 */
export declare function nearTokenTopupInfo(baseURL: string, key: string): Promise<NearTokenTopupInfo>;
/**
 * Start one order.
 * @param baseURL - site root without a trailing slash.
 * @param key - the stored relay key.
 * @param amount - the amount the user picked.
 * @param paymentMethod - one method type from {@link NearTokenTopupInfo}.
 * @returns the order number and the site-relative checkout link.
 * @throws {NearTokenTopupError} when the site refused or could not be reached.
 */
export declare function nearTokenCreateTopup(baseURL: string, key: string, amount: number, paymentMethod: string): Promise<NearTokenTopupOrder>;
