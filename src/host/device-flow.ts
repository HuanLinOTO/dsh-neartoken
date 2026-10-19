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
import { NewApiError, asObject, callNewApiBody, type JsonObject } from './new-api.ts'

/** Start one authorization. */
export const DEVICE_AUTHORIZE_PATH = '/api/dsh/device/authorize'
/** Poll one authorization. */
export const DEVICE_TOKEN_PATH = '/api/dsh/device/token'
/** Revoke a key this plugin obtained. */
export const DEVICE_REVOKE_PATH = '/api/dsh/device/revoke'

/** The site's answer to a successful start. */
export interface DeviceAuthorization {
  /** The secret the poll presents; never shown to the human. */
  readonly deviceCode: string
  /** The short code the human confirms on the site. */
  readonly userCode: string
  /** The site's confirmation page. */
  readonly verificationUri: string
  /** The same page with the code prefilled. */
  readonly verificationUriComplete: string
  /** When the attempt stops being valid, as epoch milliseconds. */
  readonly expiresAt: number
  /** How long to wait between polls, in milliseconds. */
  readonly intervalMs: number
}

/** One poll's outcome. Every non-grant answer is a normal state, not an error. */
export type DevicePollOutcome =
  /** The human has not decided yet. */
  | { readonly status: 'pending' }
  /** Polled faster than the site allows; back off before the next poll. */
  | { readonly status: 'slow-down' }
  /** The human refused. */
  | { readonly status: 'denied' }
  /** The attempt outlived its lifetime. */
  | { readonly status: 'expired' }
  | {
    readonly status: 'granted'
    /** The key to send as the bearer value. */
    readonly accessToken: string
    /** The site-side token name behind that key. */
    readonly tokenName: string
    /** The account the key belongs to, as the site reports it. */
    readonly user: JsonObject | undefined
  }

/** One non-empty string member, or undefined. */
function text(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** One finite number member, or undefined. */
function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/**
 * The device-authorization endpoints of one site.
 */
export class DeviceAuthorizationClient {
  /**
   * @param baseURL - site root without a trailing slash.
   */
  constructor(private readonly baseURL: () => string) {}

  /**
   * Ask the site for a new authorization.
   * @param clientName - how the confirmation page names this device.
   * @returns the codes and the polling schedule.
   * @throws {NewApiError} when the site refuses or answers without a code.
   */
  async authorize(clientName: string): Promise<DeviceAuthorization> {
    const body = await callNewApiBody({
      baseURL: this.baseURL(),
      path: DEVICE_AUTHORIZE_PATH,
      method: 'POST',
      body: { client_name: clientName },
    })
    if (body.success !== true) {
      throw new NewApiError(
        `NearToken: 站点拒绝发起设备授权${messageOf(body) ? `: ${messageOf(body)}` : ''}`, 'DEVICE_AUTHORIZE_REFUSED')
    }
    const data = asObject(body.data)
    const deviceCode = text(data?.device_code)
    const userCode = text(data?.user_code)
    const verificationUri = text(data?.verification_uri)
    if (deviceCode === undefined || userCode === undefined || verificationUri === undefined) {
      throw new NewApiError('NearToken: 设备授权应答缺少 device_code / user_code / verification_uri', 'DEVICE_AUTHORIZE_INVALID')
    }
    const expiresIn = num(data?.expires_in) ?? 600
    const interval = num(data?.interval) ?? 5
    return {
      deviceCode,
      userCode,
      verificationUri,
      verificationUriComplete: text(data?.verification_uri_complete) ?? verificationUri,
      expiresAt: Date.now() + expiresIn * 1000,
      intervalMs: Math.max(1, interval) * 1000,
    }
  }

  /**
   * Ask the site whether the human decided yet.
   * @param deviceCode - the code from {@link authorize}.
   * @returns the outcome; only an unrecognized answer throws.
   * @throws {NewApiError} when the site answers neither a grant nor a known state.
   */
  async poll(deviceCode: string): Promise<DevicePollOutcome> {
    const body = await callNewApiBody({
      baseURL: this.baseURL(),
      path: DEVICE_TOKEN_PATH,
      method: 'POST',
      body: { device_code: deviceCode },
    })
    if (body.success === true) {
      const data = asObject(body.data)
      const accessToken = text(data?.access_token)
      if (accessToken === undefined) {
        throw new NewApiError('NearToken: 设备授权应答缺少 access_token', 'DEVICE_TOKEN_INVALID')
      }
      return {
        status: 'granted',
        accessToken,
        tokenName: text(data?.token_name) ?? 'DSH',
        user: asObject(data?.user),
      }
    }
    switch (text(body.message)) {
      case 'authorization_pending': return { status: 'pending' }
      case 'slow_down': return { status: 'slow-down' }
      case 'access_denied': return { status: 'denied' }
      case 'expired_token': return { status: 'expired' }
      default:
        throw new NewApiError(
          `NearToken: 设备授权轮询返回了未知状态${messageOf(body) ? `: ${messageOf(body)}` : ''}`, 'DEVICE_TOKEN_UNKNOWN')
    }
  }

  /**
   * Revoke one key on the site.
   * @param accessToken - the key to revoke.
   * @returns after the site acknowledged (a key already gone counts as revoked).
   * @throws {NewApiError} when the site refused the revocation.
   */
  async revoke(accessToken: string): Promise<void> {
    const body = await callNewApiBody({
      baseURL: this.baseURL(),
      path: DEVICE_REVOKE_PATH,
      method: 'POST',
      sessionToken: accessToken,
    })
    if (body.success !== true) {
      throw new NewApiError(
        `NearToken: 站点拒绝撤销令牌${messageOf(body) ? `: ${messageOf(body)}` : ''}`, 'DEVICE_REVOKE_REFUSED')
    }
  }
}

/**
 * Read one body's `message` member.
 * @param body - the site's answer.
 * @returns the message when it carried one.
 */
function messageOf(body: JsonObject): string | undefined {
  return text(body.message)
}
