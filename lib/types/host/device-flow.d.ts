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
     * @param affiliateCode - invite code a referring page left on the browser
     * window; it rides along on the confirmation address so the site's own sign-up
     * pages can bind the inviter.
     * @returns the codes and the polling schedule.
     * @throws {NewApiError} when the site refuses or answers without a code.
     */
    authorize(clientName: string, affiliateCode?: string): Promise<DeviceAuthorization>;
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
