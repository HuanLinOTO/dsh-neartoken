/**
 * The site's device-authorization flow (RFC 8628 shape): the plugin asks the
 * site for a code, the human finishes the sign-in in their own browser, and the
 * plugin polls until the site hands over the API key.
 *
 * No password ever reaches this plugin: the site's own login page authenticates
 * the human, and the only thing that travels back is the key the site minted for
 * this plugin.
 *
 * @module
 */
import { type JsonObject } from './new-api.ts';
/** Start one authorization. */
export declare const DEVICE_AUTHORIZE_PATH = "/api/dsh/device/authorize";
/** Poll one authorization. */
export declare const DEVICE_TOKEN_PATH = "/api/dsh/device/token";
/** Revoke a key this plugin obtained. */
export declare const DEVICE_REVOKE_PATH = "/api/dsh/device/revoke";
/** The site's answer to a successful start. */
export interface DeviceAuthorization {
    /** The secret the poll presents; never shown to the human. */
    readonly deviceCode: string;
    /** The short code the human confirms on the site. */
    readonly userCode: string;
    /** The site's confirmation page. */
    readonly verificationUri: string;
    /** The same page with the code prefilled. */
    readonly verificationUriComplete: string;
    /** When the attempt stops being valid, as epoch milliseconds. */
    readonly expiresAt: number;
    /** How long to wait between polls, in milliseconds. */
    readonly intervalMs: number;
}
/** One poll's outcome. Every non-grant answer is a normal state, not an error. */
export type DevicePollOutcome = 
/** The human has not decided yet. */
{
    readonly status: 'pending';
}
/** Polled faster than the site allows; back off before the next poll. */
 | {
    readonly status: 'slow-down';
}
/** The human refused. */
 | {
    readonly status: 'denied';
}
/** The attempt outlived its lifetime. */
 | {
    readonly status: 'expired';
} | {
    readonly status: 'granted';
    /** The key to send as the bearer value. */
    readonly accessToken: string;
    /** The site-side token name behind that key. */
    readonly tokenName: string;
    /** The account the key belongs to, as the site reports it. */
    readonly user: JsonObject | undefined;
};
/**
 * The device-authorization endpoints of one site.
 */
export declare class DeviceAuthorizationClient {
    private readonly baseURL;
    /**
     * @param baseURL - site root without a trailing slash.
     */
    constructor(baseURL: () => string);
    /**
     * Ask the site for a new authorization.
     * @param clientName - how the confirmation page names this device.
     * @returns the codes and the polling schedule.
     * @throws {NewApiError} when the site refuses or answers without a code.
     */
    authorize(clientName: string): Promise<DeviceAuthorization>;
    /**
     * Ask the site whether the human decided yet.
     * @param deviceCode - the code from {@link authorize}.
     * @returns the outcome; only an unrecognized answer throws.
     * @throws {NewApiError} when the site answers neither a grant nor a known state.
     */
    poll(deviceCode: string): Promise<DevicePollOutcome>;
    /**
     * Revoke one key on the site.
     * @param accessToken - the key to revoke.
     * @returns after the site acknowledged (a key already gone counts as revoked).
     * @throws {NewApiError} when the site refused the revocation.
     */
    revoke(accessToken: string): Promise<void>;
}
