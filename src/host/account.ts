/**
 * The NearToken account: one device authorization at a time, its poll loop, and
 * the stored key that a finished authorization leaves behind.
 *
 * The plugin never sees a password. {@link begin} asks the site for a code, the
 * human signs in on the site's own page, and this class polls until the site
 * hands back the key it minted — which is then the only thing written to the
 * credential store, under `<apiKeyRef>` (default `NEARTOKEN_API_KEY`).
 *
 * @module
 */
import { readFile, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import type {
  BeginAuthorizationOutcome, NearTokenAccountSummary, NearTokenPendingAuthorization, NearTokenStatus,
} from '../protocol.ts'
import { DeviceAuthorizationClient, type DeviceAuthorization, type DevicePollOutcome } from './device-flow.ts'
import { NewApiError, asObject, callNewApiBody, type JsonObject } from './new-api.ts'

/** How the site's confirmation page names this plugin. */
const CLIENT_NAME = 'DSH 插件'

/** Name the site gives the token it mints, until an answer says otherwise. */
const DEFAULT_TOKEN_NAME = 'DSH'

/** How long one `/api/status` currency lookup stays fresh. */
const CURRENCY_TTL_MS = 300_000

/** Extra wait added after the site answers `slow_down`. */
const SLOW_DOWN_PENALTY_MS = 2_000

/**
 * File the granted account facts are kept in, inside the profile.
 *
 * The site's dashboard endpoints authenticate a browser session, not the relay
 * key this plugin holds, so the numbers cannot be read again afterwards. They
 * arrive exactly once — in the grant that minted the key — and are recorded
 * here so a restart still shows whose account this is.
 */
const SNAPSHOT_FILE = 'neartoken-account.json'

/** External facts the account reads from the plugin configuration. */
export interface NearTokenSite {
  /** Site root without a trailing slash. */
  baseURL: () => string
  /** Credential reference the adapter resolves, such as `NEARTOKEN_API_KEY`. */
  apiKeyRef: () => string
}

/** How the site formats quota, read from its public status endpoint. */
interface CurrencyInfo {
  /** Quota units per unit of currency. */
  readonly quotaPerUnit: number
  /** Multiplier from the site's base currency to its display currency. */
  readonly rate: number
  /** Whether amounts are shown in the display currency at all. */
  readonly display: boolean
}

/** One authorization attempt this account is currently polling. */
interface Attempt {
  readonly grant: DeviceAuthorization
  readonly controller: AbortController
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
 * Format one quota amount the way the site's dashboard shows it.
 * @param quota - the raw quota units.
 * @param currency - the site's formatting facts.
 * @returns the amount with its symbol.
 */
function money(quota: number, currency: CurrencyInfo): string {
  const base = currency.quotaPerUnit > 0 ? quota / currency.quotaPerUnit : quota
  const value = currency.display && currency.rate > 0 ? base * currency.rate : base
  return `${currency.display ? '￥' : '$'}${value.toFixed(2)}`
}

/**
 * Project one dashboard user object onto the card's fields.
 * @param user - the `user` a grant carried, or `/api/user/self`'s data.
 * @param currency - the site's formatting facts.
 * @returns the account summary; empty strings where the site omitted a field.
 */
function summarize(user: JsonObject | undefined, currency: CurrencyInfo): NearTokenAccountSummary {
  const username = text(user?.username) ?? ''
  return {
    username,
    displayName: text(user?.display_name) ?? username,
    group: text(user?.group) ?? '',
    balance: money(num(user?.quota) ?? 0, currency),
    used: money(num(user?.used_quota) ?? 0, currency),
  }
}

/**
 * Read one stored snapshot back into the card's fields.
 * @param record - the parsed snapshot file.
 * @returns the summary, or undefined when the file is not one.
 */
function asSummary(record: JsonObject): NearTokenAccountSummary | undefined {
  const fields = ['username', 'displayName', 'group', 'balance', 'used'] as const
  const read: string[] = []
  for (const field of fields) {
    const value = record[field]
    if (typeof value !== 'string') return undefined
    read.push(value)
  }
  const [username, displayName, group, balance, used] = read as [string, string, string, string, string]
  return { username, displayName, group, balance, used }
}

/**
 * Render one attempt as the browser-facing pending record.
 * @param grant - the attempt's site-issued codes.
 * @returns the record the settings page shows.
 */
function pendingOf(grant: DeviceAuthorization): NearTokenPendingAuthorization {
  return {
    userCode: grant.userCode,
    verificationUri: grant.verificationUri,
    verificationUriComplete: grant.verificationUriComplete,
    expiresAt: grant.expiresAt,
  }
}

/**
 * Wait, unless the attempt is withdrawn first.
 * @param ms - how long to wait.
 * @param signal - withdraws the wait.
 * @returns after the wait elapses or the signal fires.
 */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    const finish = (): void => {
      clearTimeout(timer)
      signal.removeEventListener('abort', finish)
      resolve()
    }
    const timer = setTimeout(finish, ms)
    signal.addEventListener('abort', finish, { once: true })
  })
}

/**
 * Render one thrown value as the message the settings page shows.
 * @param error - whatever the attempt threw.
 * @returns the error's own message for a typed failure, its text otherwise.
 */
function messageOf(error: unknown): string {
  if (error instanceof HarnessError) return error.message
  return error instanceof Error ? error.message : String(error)
}

/** The NearToken account, one instance per plugin mount. */
export class NearTokenAccount {
  private readonly client: DeviceAuthorizationClient
  /** The authorization being polled, while one is. */
  private attempt: Attempt | undefined
  /** Account facts obtained by the last grant in this process. */
  private summary: NearTokenAccountSummary | undefined
  /** The read that restores those facts from the stored key, while one is running. */
  private summaryLoad: Promise<void> | undefined
  /** The site-side token name behind the stored key. */
  private tokenName = DEFAULT_TOKEN_NAME
  /** Why the last attempt ended without a key. */
  private error: string | undefined
  /** Cached `/api/status` currency facts. */
  private currency: { readonly at: number; readonly info: CurrencyInfo } | undefined

  /**
   * @param ctx - the owning plugin context, for the credentials service.
   * @param site - site root and the API key reference.
   * @param onGranted - called once a key has been stored, so the provider route can mount.
   */
  constructor(
    private readonly ctx: Context,
    private readonly site: NearTokenSite,
    private readonly onGranted: () => void,
  ) {
    this.client = new DeviceAuthorizationClient(site.baseURL)
  }

  /**
   * Whether an API key is stored, i.e. whether the provider route can serve.
   * @returns true when the credential resolves to a non-empty value.
   */
  async configured(): Promise<boolean> {
    return await this.read(this.site.apiKeyRef()) !== undefined
  }

  /**
   * Read the state the settings page draws: the key state, the account, and any
   * authorization still waiting for its human.
   * @returns the current status.
   */
  async status(): Promise<NearTokenStatus> {
    const configured = await this.configured()
    // A key stored by an earlier process outlives the grant that fetched it, so
    // the card's numbers have to be read back from the site at least once.
    if (configured) await this.loadSummary()
    const attempt = this.attempt
    const pending = attempt !== undefined && attempt.grant.expiresAt > Date.now()
      ? pendingOf(attempt.grant)
      : undefined
    return {
      configured,
      baseURL: this.site.baseURL(),
      tokenName: this.tokenName,
      ...configured && this.summary !== undefined ? { account: this.summary } : {},
      ...pending === undefined ? {} : { pending },
      ...this.error === undefined ? {} : { error: this.error },
    }
  }

  /**
   * Start an authorization, or report the one already running.
   * @returns the codes the human needs, or why the site refused to issue them.
   */
  async begin(): Promise<BeginAuthorizationOutcome> {
    const running = this.attempt
    if (running !== undefined && running.grant.expiresAt > Date.now()) {
      return { status: 'pending', pending: pendingOf(running.grant) }
    }
    this.stop()
    this.error = undefined
    try {
      const grant = await this.client.authorize(CLIENT_NAME)
      const attempt: Attempt = { grant, controller: new AbortController() }
      this.attempt = attempt
      void this.pollUntilSettled(attempt)
      return { status: 'pending', pending: pendingOf(grant) }
    } catch (error) {
      this.error = messageOf(error)
      return { status: 'failed', message: this.error }
    }
  }

  /**
   * Abandon the authorization in progress.
   * @returns after the poll loop stops; the site's own record expires on its own.
   */
  async cancel(): Promise<void> {
    this.stop()
    this.error = undefined
  }

  /**
   * Forget the stored key, and tell the site to revoke it.
   *
   * The revocation is best-effort: the credential this plugin holds is gone the
   * moment this resolves, and a site that cannot be reached must not leave the
   * user connected here.
   * @returns after the credential record is removed.
   */
  async signOut(): Promise<void> {
    this.stop()
    this.summary = undefined
    this.error = undefined
    await this.forgetSummary()
    const key = await this.read(this.site.apiKeyRef())
    await this.clear(this.site.apiKeyRef())
    if (key !== undefined) {
      void this.client.revoke(key).catch(() => {
        // The site keeps a token it never heard about; the local credential is
        // gone, which is what disconnecting means here.
      })
    }
  }

  /**
   * Poll the site until the human decides, the attempt expires, or it is withdrawn.
   * @param attempt - the authorization to poll.
   */
  private async pollUntilSettled(attempt: Attempt): Promise<void> {
    let delay = attempt.grant.intervalMs
    while (!attempt.controller.signal.aborted) {
      await sleep(delay, attempt.controller.signal)
      if (attempt.controller.signal.aborted) return
      if (Date.now() > attempt.grant.expiresAt) {
        this.settle(attempt, '授权已超时，请重新发起。')
        return
      }
      let outcome: DevicePollOutcome
      try {
        outcome = await this.client.poll(attempt.grant.deviceCode)
      } catch (error) {
        this.settle(attempt, messageOf(error))
        return
      }
      if (attempt.controller.signal.aborted) return
      switch (outcome.status) {
        case 'pending':
          continue
        case 'slow-down':
          delay += SLOW_DOWN_PENALTY_MS
          continue
        case 'denied':
          this.settle(attempt, '站点上拒绝了本次授权。')
          return
        case 'expired':
          this.settle(attempt, '授权已超时，请重新发起。')
          return
        case 'granted':
          await this.commit(attempt, outcome)
          return
      }
    }
  }

  /**
   * Store a granted key and announce the provider route.
   * @param attempt - the authorization that was granted.
   * @param outcome - the grant, with the key and the account it belongs to.
   */
  private async commit(attempt: Attempt, outcome: Extract<DevicePollOutcome, { status: 'granted' }>): Promise<void> {
    try {
      await this.write(this.site.apiKeyRef(), outcome.accessToken)
    } catch (error) {
      this.settle(attempt, messageOf(error))
      return
    }
    this.tokenName = outcome.tokenName
    try {
      this.summary = summarize(outcome.user, await this.currencyInfo())
    } catch (_error) {
      // Currency facts only decorate the card; the key is what matters and it
      // is already stored.
      this.summary = summarize(outcome.user, { quotaPerUnit: 1, rate: 1, display: false })
    }
    // The site will never hand these facts over again: its dashboard endpoints
    // take a browser session, not the relay key stored above.
    await this.persistSummary()
    this.clearAttempt(attempt)
    this.error = undefined
    this.onGranted()
  }

  /**
   * End one attempt with a message for the page.
   * @param attempt - the attempt that ended.
   * @param message - why it ended without a key.
   */
  private settle(attempt: Attempt, message: string): void {
    this.error = message
    this.clearAttempt(attempt)
  }

  /**
   * Retire one attempt if it is still the current one.
   * @param attempt - the attempt to retire.
   */
  private clearAttempt(attempt: Attempt): void {
    if (this.attempt === attempt) this.attempt = undefined
  }

  /** Withdraw whatever attempt is running. */
  private stop(): void {
    const attempt = this.attempt
    this.attempt = undefined
    attempt?.controller.abort()
  }

  /**
   * Restore the card's facts for a key that was stored before this process.
   *
   * One read per process: a grant fills the summary itself, and the settings
   * page asks for the status on every poll while an authorization waits, so a
   * second concurrent read would only repeat the first.
   * @returns after the read settles, whether or not it found anything.
   */
  private async loadSummary(): Promise<void> {
    if (this.summary !== undefined) return
    if (this.summaryLoad !== undefined) return this.summaryLoad
    this.summaryLoad = this.restoreSummary().finally(() => { this.summaryLoad = undefined })
    return this.summaryLoad
  }

  /** Where the account snapshot lives, when the composition exposes a profile. */
  private snapshotPath(): string | undefined {
    const profile = this.ctx.get('profileContext') as { home?: unknown } | undefined
    return typeof profile?.home === 'string' ? join(profile.home, SNAPSHOT_FILE) : undefined
  }

  /** Read the snapshot a previous process recorded when the grant arrived. */
  private async restoreSummary(): Promise<void> {
    const path = this.snapshotPath()
    if (path === undefined) return
    let raw: string
    try {
      raw = await readFile(path, 'utf8')
    } catch (error) {
      // No snapshot yet is the normal state before a first connection.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.ctx.logger.warn('neartoken: could not read the stored account facts', error)
      }
      return
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (_error) {
      // A damaged snapshot is dropped by the next grant; the card stays blank.
      return
    }
    const record = asObject(parsed)
    const summary = record === undefined ? undefined : asSummary(record)
    if (summary !== undefined) this.summary = summary
  }

  /** Record the facts a grant carried, so they outlive this process. */
  private async persistSummary(): Promise<void> {
    const path = this.snapshotPath()
    const summary = this.summary
    if (path === undefined || summary === undefined) return
    try {
      await writeFile(path, JSON.stringify(summary), 'utf8')
    } catch (error) {
      this.ctx.logger.warn('neartoken: could not store the account facts', error)
    }
  }

  /** Drop the snapshot once the key it describes is gone. */
  private async forgetSummary(): Promise<void> {
    const path = this.snapshotPath()
    if (path === undefined) return
    try {
      await unlink(path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.ctx.logger.warn('neartoken: could not remove the stored account facts', error)
      }
    }
  }

  /** Read one credential reference, or undefined when nothing is stored. */
  private async read(ref: string): Promise<string | undefined> {
    const credentials = this.ctx.get('credentials')
    if (credentials === undefined) return undefined
    return text((await credentials.resolve(credentialRef(ref)))?.value)
  }

  /** Write one credential reference. */
  private async write(ref: string, value: string): Promise<void> {
    const credentials = this.ctx.get('credentials')
    if (credentials === undefined) {
      throw new NewApiError(
        `NearToken: this composition mounts no credentials service, so ${ref} has nowhere to go`,
        'NO_CREDENTIAL_STORE')
    }
    await credentials.set(credentialRef(ref), value)
  }

  /** Remove one credential reference. */
  private async clear(ref: string): Promise<void> {
    const credentials = this.ctx.get('credentials')
    if (credentials === undefined) return
    await credentials.unset(credentialRef(ref))
  }

  /**
   * The cached currency facts, read from the site when the cache is cold.
   * @returns the formatting facts.
   * @throws {NewApiError} when a cold read fails.
   */
  private async currencyInfo(): Promise<CurrencyInfo> {
    const cached = this.currency
    if (cached !== undefined && Date.now() - cached.at < CURRENCY_TTL_MS) return cached.info
    const data = asObject(await callNewApiBody({
      baseURL: this.site.baseURL(),
      path: '/api/status',
      method: 'GET',
    }).then(body => body.data))
    const info: CurrencyInfo = {
      // A site that reports nothing formats raw quota, which is what its own
      // dashboard falls back to as well.
      quotaPerUnit: num(data?.quota_per_unit) ?? 1,
      rate: num(data?.usd_exchange_rate) ?? 1,
      display: data?.display_in_currency === true,
    }
    this.currency = { at: Date.now(), info }
    return info
  }
}
