/**
 * The usage overview: one window of the account's spending and token counts,
 * read with the relay key the plugin already stores, and turned into the series
 * the settings page stacks by model.
 *
 * The site answers raw quota units, so every money figure is scaled through
 * {@link MoneyFormat} — the same facts the wallet card prints with. Nothing here
 * judges the answer beyond its shape: a site that predates the endpoint, and a
 * site that cannot be reached, are both stated as "no window to draw" with the
 * reason the page labels.
 *
 * @module
 */
import type {
  NearTokenUsageBucket, NearTokenUsageModel, NearTokenUsageRange, NearTokenUsageState, NearTokenUsageWindow,
} from '../protocol.ts'
import { asObject, callNewApiBody, type JsonObject } from './new-api.ts'

/** The relay-key-readable usage endpoint, below the site root. */
const DEVICE_USAGE_PATH = '/api/dsh/device/usage'

/**
 * How the site prints one quota amount: the symbol its money figures carry, and
 * the value one raw quota unit is worth in its display currency.
 */
export interface MoneyFormat {
  /** The symbol every amount carries (￥ or $). */
  readonly symbol: string
  /**
   * The money one quota amount is worth, unrounded.
   * @param quota - raw quota units.
   * @returns the value in the site's display currency.
   */
  readonly value: (quota: number) => number
}

/** What one usage read needs from the account. */
export interface UsageRead {
  /** Site root without a trailing slash. */
  readonly baseURL: string
  /** The stored relay key, which is what authorizes the read. */
  readonly apiKey: string
  /**
   * The card's current balance, already formatted in the site's currency. The
   * endpoint reports what the window spent; what is left of the balance is a
   * wallet fact, so it is carried in rather than asked for twice.
   */
  readonly balance: string
  /** How the site prints money, so a band can be stacked without parsing strings. */
  readonly format: MoneyFormat
}

/** One non-empty string member, or undefined. */
function text(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** One finite, non-negative number, or undefined. */
function amount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

/**
 * Print one money value the way the site's dashboard does.
 * @param value - the amount in the site's display currency.
 * @param symbol - the symbol the site prints it with.
 * @returns the amount with its symbol.
 */
function moneyText(value: number, symbol: string): string {
  return `${symbol}${value.toFixed(2)}`
}

/**
 * Read one model row.
 * @param value - one member of the site's `models` array, or of a bucket's.
 * @param format - how the site prints money.
 * @returns the row, or undefined when it does not name a model.
 */
function asModel(value: unknown, format: MoneyFormat): NearTokenUsageModel | undefined {
  const record = asObject(value)
  const model = text(record?.model)
  if (model === undefined) return undefined
  // A row the site left incomplete still names a model; the missing counts are
  // zero rather than a reason to drop it from the legend.
  return {
    model,
    tokens: amount(record?.tokens) ?? 0,
    cost: format.value(amount(record?.quota) ?? 0),
  }
}

/**
 * Read the site's list of rows, dropping the entries that are not ones.
 * @param value - the site's array member.
 * @param read - turns one member into a row, or undefined.
 * @returns the rows, in the site's order.
 */
function asList<T>(value: unknown, read: (item: unknown) => T | undefined): T[] {
  const rows: T[] = []
  if (!Array.isArray(value)) return rows
  for (const item of value) {
    const row = read(item)
    if (row !== undefined) rows.push(row)
  }
  return rows
}

/**
 * Read one bucket row.
 * @param value - one member of the site's `buckets` array.
 * @param format - how the site prints money.
 * @returns the bucket, or undefined when it does not carry a timestamp.
 */
function asBucket(value: unknown, format: MoneyFormat): NearTokenUsageBucket | undefined {
  const record = asObject(value)
  const timestamp = amount(record?.timestamp)
  if (timestamp === undefined) return undefined
  return { timestamp, models: asList(record?.models, (item) => asModel(item, format)) }
}

/**
 * Read one window of the account's usage.
 * @param read - the site root, the key, the balance, and the money format.
 * @param range - the window to read.
 * @returns the window, or why there is none to draw.
 */
export async function readUsage(read: UsageRead, range: NearTokenUsageRange): Promise<NearTokenUsageState> {
  let body: JsonObject
  try {
    body = await callNewApiBody({
      baseURL: read.baseURL,
      path: `${DEVICE_USAGE_PATH}?range=${range}`,
      method: 'GET',
      sessionToken: read.apiKey,
    })
  } catch (_error) {
    // Out of reach is a different sentence on the page than "this site has no
    // usage endpoint", so the two are never folded together here.
    return { available: false, reason: 'unreachable' }
  }
  const data = asObject(body.data)
  const start = amount(data?.start_timestamp)
  const end = amount(data?.end_timestamp)
  const bucketSeconds = amount(data?.bucket_seconds)
  if (body.success !== true || data === undefined || start === undefined || end === undefined
    || bucketSeconds === undefined || bucketSeconds <= 0) {
    // An older site answers the relay's own "invalid URL" body: JSON, but no
    // window in it. That is a deployment fact, not a broken key.
    return { available: false, reason: 'unsupported' }
  }
  const window: NearTokenUsageWindow = {
    range,
    start,
    end,
    bucketSeconds,
    currency: read.format.symbol,
    spent: moneyText(read.format.value(amount(data.quota) ?? 0), read.format.symbol),
    balance: read.balance,
    tokens: amount(data.tokens) ?? 0,
    models: asList(data.models, (item) => asModel(item, read.format)),
    buckets: asList(data.buckets, (item) => asBucket(item, read.format)),
  }
  return { available: true, ...window }
}
