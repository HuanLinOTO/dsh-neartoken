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
import {
  computeAmountError, type NearTokenTopupInfo, type NearTokenTopupMethod, type NearTokenTopupOrder,
} from '../protocol.ts'
import { NewApiError, asObject, callNewApiBody, type JsonObject } from './new-api.ts'

export { computeAmountError }
export type { NearTokenTopupInfo, NearTokenTopupMethod, NearTokenTopupOrder }

/** The site's top-up info endpoint. */
const TOPUP_INFO_PATH = '/api/dsh/device/topup/info'

/** The site's order endpoint. */
const TOPUP_PATH = '/api/dsh/device/topup'

/** Why a top-up request could not be answered. */
export type NearTokenTopupReason = 'not-dsh' | 'unavailable' | 'refused' | 'unreachable'

/** A refused top-up request, tagged with the reason the page renders. */
export class NearTokenTopupError extends Error {
  /** What the page should offer instead of a payment button. */
  readonly reason: NearTokenTopupReason
  /** What the site said, when it said anything. */
  readonly siteMessage: string | undefined

  /**
   * @param reason - which failure this is.
   * @param siteMessage - the site's own wording, when it sent one.
   */
  constructor(reason: NearTokenTopupReason, siteMessage?: string) {
    super(siteMessage === undefined ? reason : siteMessage)
    this.name = 'NearTokenTopupError'
    this.reason = reason
    this.siteMessage = siteMessage
  }
}


/**
 * Read the `GET /api/dsh/device/topup/info` answer.
 * @param body - the parsed JSON envelope.
 * @returns the offer, or undefined when the site refused.
 */
export function parseTopupInfo(body: JsonObject): NearTokenTopupInfo | undefined {
  if (body.success !== true) return undefined
  const data = asObject(body.data)
  if (data === undefined) return undefined
  const methods: NearTokenTopupMethod[] = []
  if (Array.isArray(data.pay_methods)) {
    for (const entry of data.pay_methods) {
      const method = asObject(entry)
      const type = typeof method?.type === 'string' ? method.type : undefined
      const name = typeof method?.name === 'string' ? method.name : undefined
      if (type !== undefined && name !== undefined) methods.push({ type, name })
    }
  }
  const options: number[] = []
  if (Array.isArray(data.amount_options)) {
    for (const option of data.amount_options) {
      if (typeof option === 'number') options.push(option)
    }
  }
  return {
    enabled: data.enable_online_topup === true,
    minTopup: typeof data.min_topup === 'number' ? data.min_topup : 0,
    amountOptions: options,
    methods,
  }
}

/**
 * Read one order answer.
 * @param body - the parsed JSON envelope.
 * @returns the order number and the site-relative checkout link.
 */
export function parseTopupOrder(body: JsonObject): NearTokenTopupOrder | undefined {
  if (body.success !== true) return undefined
  const data = asObject(body.data)
  const tradeNo = typeof data?.trade_no === 'string' ? data.trade_no : undefined
  const payUrl = typeof data?.pay_url === 'string' ? data.pay_url : undefined
  if (tradeNo === undefined || payUrl === undefined) return undefined
  return { tradeNo, payUrl }
}

/**
 * Turn a refused envelope into the error the page renders.
 * @param body - the parsed JSON envelope that carried success: false.
 * @returns the tagged refusal.
 */
function refusal(body: JsonObject): NearTokenTopupError {
  const code = typeof body.code === 'string' ? body.code : ''
  const message = typeof body.message === 'string' ? body.message : undefined
  // An older site answers the same path with a plain 404 body-less response, so
  // an envelope without a success flag means "this site has no top-up endpoint".
  if (code === 'DSH_TOKEN_REQUIRED') return new NearTokenTopupError('not-dsh', message)
  if (body.success === undefined) return new NearTokenTopupError('unavailable', message)
  return new NearTokenTopupError('refused', message)
}

/**
 * Ask the site what it offers.
 * @param baseURL - site root without a trailing slash.
 * @param key - the stored relay key.
 * @returns the offer.
 * @throws {NearTokenTopupError} when the site refused or could not be reached.
 */
export async function nearTokenTopupInfo(baseURL: string, key: string): Promise<NearTokenTopupInfo> {
  let body: JsonObject
  try {
    body = await callNewApiBody({ baseURL, sessionToken: key, path: TOPUP_INFO_PATH, method: 'GET' })
  } catch (error: unknown) {
    throw new NearTokenTopupError('unreachable', error instanceof NewApiError ? error.message : undefined)
  }
  const info = parseTopupInfo(body)
  if (info === undefined) throw refusal(body)
  return info
}

/**
 * Start one order.
 * @param baseURL - site root without a trailing slash.
 * @param key - the stored relay key.
 * @param amount - the amount the user picked.
 * @param paymentMethod - one method type from {@link NearTokenTopupInfo}.
 * @returns the order number and the site-relative checkout link.
 * @throws {NearTokenTopupError} when the site refused or could not be reached.
 */
export async function nearTokenCreateTopup(
  baseURL: string, key: string, amount: number, paymentMethod: string,
): Promise<NearTokenTopupOrder> {
  let body: JsonObject
  try {
    body = await callNewApiBody({
      baseURL,
      sessionToken: key,
      path: TOPUP_PATH,
      method: 'POST',
      body: { amount, payment_method: paymentMethod },
    })
  } catch (error: unknown) {
    throw new NearTokenTopupError('unreachable', error instanceof NewApiError ? error.message : undefined)
  }
  const order = parseTopupOrder(body)
  if (order === undefined) throw refusal(body)
  return order
}