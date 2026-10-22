/**
 * The device-authorization orchestration: one attempt at a time, polled to its
 * grant or its failure, with the key written only on success.
 *
 * The poll loop is real asynchronous work, so these cases drive it with fake
 * timers and assert both the credential store and the request sequence — what
 * must not happen (a second authorization started behind the first, a key
 * written for a refusal, a poll continuing after a cancellation) is invisible in
 * the returned value alone.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { NearTokenAccount } from './account.ts'

/** The credential record stored by a granted authorization. */
const API_KEY_REF = 'NEARTOKEN_API_KEY'

/** The key shape the site mints. */
const KEY = 'k'.repeat(48)

/** The account the grant reports. */
const USER = { username: 'tester', display_name: '测试账号', group: 'default', quota: 1_000_000, used_quota: 500_000 }

/** The site's public status: 1,000,000 quota per currency unit, shown in RMB at 7. */
const STATUS = { success: true, data: { quota_per_unit: 1_000_000, display_in_currency: true, usd_exchange_rate: 7 } }

/** One authorization as the site issues it, with a one-second poll interval. */
const AUTHORIZED = {
  success: true,
  data: {
    device_code: 'device-code',
    user_code: 'K7QM-3XPD',
    verification_uri: 'https://example.test/dsh/device',
    verification_uri_complete: 'https://example.test/dsh/device?user_code=K7QM-3XPD',
    expires_in: 600,
    interval: 1,
  },
}

/** The answer a granted poll returns: the key, its name, and the account behind it. */
const GRANT = { success: true, data: { access_token: KEY, token_type: 'Bearer', token_name: 'DSH', user: USER } }

/** A live wallet answer: 2,000,000 quota left, 800,000 spent, one voucher. */
const WALLET = {
  success: true,
  data: {
    quota: 2_000_000,
    used_quota: 800_000,
    group_credits: [
      { group: '[低价] Grok', group_id: 7, amount: 500_000 },
      { group: 'spent-group', group_id: 8, amount: 0 },
    ],
  },
}

/** Every request the code under test issued, in order. */
let requests: string[] = []

/**
 * Replace fetch with one that answers from a routing table and records the path.
 * @param answer - returns the JSON body for one request path and method.
 */
function stubFetch(answer: (path: string, method: string) => unknown): void {
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = new URL(String(input))
    const path = `${url.pathname}${url.search}`
    requests.push(`${init?.method ?? 'GET'} ${path}`)
    const body = answer(path, init?.method ?? 'GET')
    // A ready Response models the un-JSON answers a real site gives (a 404
    // page from a deployment without the endpoint).
    if (body instanceof Response) return body
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch
}

/** The real timer, captured before a case replaces the global ones. */
const realSetTimeout = globalThis.setTimeout

/**
 * Let one real event-loop turn pass.
 *
 * The snapshot write is filesystem IO, which fake timers do not advance; a case
 * that models a restart has to let it land before the next process reads it.
 * @returns after the turn.
 */
async function settleIo(): Promise<void> {
  await new Promise<void>(resolve => { realSetTimeout(resolve, 20) })
}

/** Profile directories this file created, removed after each case. */
let homes: string[] = []

/**
 * Make one profile directory for the account snapshot.
 * @returns its path.
 */
async function makeHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'neartoken-test-'))
  homes.push(home)
  return home
}

/**
 * Build the account over an in-memory credential store.
 * @param polls - the answers `/api/dsh/device/token` gives, in order.
 * @param options - a store and profile directory to reuse, to model a restart.
 * @returns the account, the store it writes to, and the grant counter.
 */
function accountOver(
  polls: readonly unknown[] = [],
  options: { store?: Map<string, string>; home?: string; wallet?: unknown } = {},
): {
  account: NearTokenAccount
  store: Map<string, string>
  grants: () => number
} {
  const queue = [...polls]
  const store = options.store ?? new Map<string, string>()
  stubFetch((path) => {
    if (path === '/api/status') return STATUS
    if (path === '/api/user/self') return { success: true, data: USER }
    if (path === '/api/dsh/device/authorize') return AUTHORIZED
    if (path === '/api/dsh/device/token') return queue.shift() ?? { success: false, message: 'authorization_pending' }
    if (path === '/api/dsh/device/revoke') return { success: true }
    if (path === '/api/dsh/device/wallet') {
      // 'unreachable' models a deployment older than the endpoint: a 404 page
      // whose body is not JSON.
      if (options.wallet === 'unreachable') {
        return new Response('<html>404</html>', { status: 404, headers: { 'content-type': 'text/html' } })
      }
      return options.wallet ?? { success: true, data: { quota: 2_000_000, used_quota: 800_000, group_credits: [] } }
    }
    throw new Error(`unexpected request ${path}`)
  })
  const credentials = {
    async resolve(ref: string) {
      const value = store.get(ref)
      return value === undefined ? undefined : { value, source: 'stored' }
    },
    async set(ref: string, value: string) { store.set(ref, value) },
    async unset(ref: string) { store.delete(ref) },
  }
  const services: Record<string, unknown> = {
    credentials,
    profileContext: options.home === undefined ? undefined : { home: options.home },
  }
  const ctx = {
    get: (name: string) => services[name],
    logger: { warn: () => { /* the card's facts are best-effort */ } },
    // The wallet cadence registers its interval through the context; a plain
    // synchronous register is all the cases below need.
    effect: (register: () => () => void) => register(),
  } as unknown as Context
  let grants = 0
  const account = new NearTokenAccount(ctx, {
    baseURL: () => 'https://example.test',
    apiKeyRef: () => API_KEY_REF,
  }, () => { grants += 1 })
  return { account, store, grants: () => grants }
}

/** Let the poll loop reach its next await. */
async function tick(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms)
}

afterEach(async () => {
  requests = []
  vi.useRealTimers()
  await Promise.all(homes.map(home => rm(home, { recursive: true, force: true })))
  homes = []
})

describe('begin', () => {
  it('reports the code the human confirms, without touching the credential store', async () => {
    vi.useFakeTimers()
    const { account, store } = accountOver()
    const outcome = await account.begin()
    expect(outcome).toEqual({
      status: 'pending',
      pending: {
        userCode: 'K7QM-3XPD',
        verificationUri: 'https://example.test/dsh/device',
        verificationUriComplete: 'https://example.test/dsh/device?user_code=K7QM-3XPD',
        expiresAt: expect.any(Number) as number,
      },
    })
    expect(store.size).toBe(0)
    expect(requests).toEqual(['POST /api/dsh/device/authorize'])
    await account.cancel()
  })

  it('reuses the authorization already running instead of starting a second one', async () => {
    vi.useFakeTimers()
    const { account } = accountOver()
    await account.begin()
    const again = await account.begin()
    expect(again.status).toBe('pending')
    expect(requests.filter(path => path.endsWith('/authorize'))).toHaveLength(1)
    await account.cancel()
  })
})

describe('poll loop', () => {
  it('stores the key and announces the grant when the human approves', async () => {
    vi.useFakeTimers()
    const { account, store, grants } = accountOver([
      { success: false, message: 'authorization_pending' },
      { success: true, data: { access_token: KEY, token_type: 'Bearer', token_name: 'DSH', user: USER } },
    ])
    await account.begin()
    await tick(1_000)
    expect(store.size).toBe(0)
    await tick(1_000)
    expect(store.get(API_KEY_REF)).toBe(KEY)
    expect(grants()).toBe(1)
    expect(await account.configured()).toBe(true)
    const status = await account.status()
    expect(status.pending).toBeUndefined()
    expect(status.account).toEqual({
      username: 'tester', displayName: '测试账号', group: 'default', balance: '￥7.00', used: '￥3.50',
    })
  })

  it('backs off when the site asks it to slow down', async () => {
    vi.useFakeTimers()
    const { account, store } = accountOver([
      { success: false, message: 'slow_down' },
      { success: true, data: { access_token: KEY, token_type: 'Bearer', token_name: 'DSH', user: USER } },
    ])
    await account.begin()
    await tick(1_000)
    // The refusal adds the penalty to the schedule: the next poll is due 3s
    // after the slow-down answer, so one second of extra time is not enough.
    await tick(1_000)
    expect(store.size).toBe(0)
    await tick(2_000)
    expect(store.get(API_KEY_REF)).toBe(KEY)
  })

  it('stops with a message when the human refuses', async () => {
    vi.useFakeTimers()
    const { account, store } = accountOver([{ success: false, message: 'access_denied' }])
    await account.begin()
    await tick(1_000)
    expect(store.size).toBe(0)
    const status = await account.status()
    expect(status.pending).toBeUndefined()
    expect(status.error).toContain('拒绝')
    expect(requests.filter(path => path.endsWith('/token'))).toHaveLength(1)
  })

  it('stops when the attempt outlives its own lifetime', async () => {
    vi.useFakeTimers()
    const { account, store } = accountOver()
    await account.begin()
    // Past the site's 600s lifetime: the loop gives up without another poll.
    await tick(601_000)
    expect(store.size).toBe(0)
    expect(await account.status()).toMatchObject({ configured: false, error: expect.stringContaining('超时') as string })
  })

  it('stops polling once the attempt is cancelled', async () => {
    vi.useFakeTimers()
    const { account } = accountOver()
    await account.begin()
    await account.cancel()
    const before = requests.length
    await tick(5_000)
    expect(requests).toHaveLength(before)
    expect((await account.status()).pending).toBeUndefined()
  })
})

describe('signOut', () => {
  it('removes the stored key and asks the site to revoke it', async () => {
    vi.useFakeTimers()
    const { account, store } = accountOver([GRANT])
    await account.begin()
    await tick(1_000)
    expect(store.get(API_KEY_REF)).toBe(KEY)
    await account.signOut()
    expect(store.size).toBe(0)
    expect(await account.configured()).toBe(false)
    expect(requests).toContain('POST /api/dsh/device/revoke')
  })
})

describe('status', () => {
  it('shows the facts the grant carried, in the currency the site reports', async () => {
    vi.useFakeTimers()
    const home = await makeHome()
    const { account } = accountOver([GRANT], { home })
    await account.begin()
    await tick(1_000)
    const status = await account.status()
    expect(status.configured).toBe(true)
    expect(status.account).toEqual({
      username: 'tester',
      displayName: '测试账号',
      group: 'default',
      balance: '￥7.00',
      used: '￥3.50',
    })
  })

  it('restores those facts in a restarted process that only has the key', async () => {
    vi.useFakeTimers()
    const home = await makeHome()
    const store = new Map<string, string>()
    const first = accountOver([GRANT], { home, store })
    await first.account.begin()
    await tick(1_000)
    await settleIo()
    expect(store.get(API_KEY_REF)).toBe(KEY)

    // The restarted process reads the snapshot instead of the site: the site's
    // dashboard endpoints take a browser session, not this relay key.
    const second = accountOver([], { home, store })
    const status = await second.account.status()
    expect(status.configured).toBe(true)
    expect(status.account).toEqual({
      username: 'tester',
      displayName: '测试账号',
      group: 'default',
      balance: '￥7.00',
      used: '￥3.50',
    })
    expect(requests).not.toContain('GET /api/user/self')
  })

  it('leaves the card blank when no snapshot was ever written', async () => {
    const home = await makeHome()
    const store = new Map<string, string>()
    store.set(API_KEY_REF, KEY)
    const { account } = accountOver([], { home, store })
    expect((await account.status()).account).toBeUndefined()
  })

  it('forgets the snapshot when the connection is dropped', async () => {
    vi.useFakeTimers()
    const home = await makeHome()
    const store = new Map<string, string>()
    const first = accountOver([GRANT], { home, store })
    await first.account.begin()
    await tick(1_000)
    await settleIo()
    await first.account.signOut()
    const second = accountOver([], { home, store })
    expect((await second.account.status()).account).toBeUndefined()
  })
})

describe('wallet refresh', () => {
  it('folds a live wallet into the card: balance, spent quota, and vouchers', async () => {
    vi.useFakeTimers()
    const { account, store } = accountOver([GRANT], { wallet: WALLET })
    await account.begin()
    await tick(1_000)
    // The grant froze the card at ￥7.00 / ￥3.50; the wallet read moves it.
    await account.refreshWallet()
    const status = await account.status()
    expect(status.account).toEqual({
      username: 'tester',
      displayName: '测试账号',
      group: 'default',
      balance: '￥14.00',
      used: '￥5.60',
      vouchers: [{ group: '[低价] Grok', groupId: 7, amount: '￥3.50' }],
    })
    expect(store.get(API_KEY_REF)).toBe(KEY)
  })

  it('re-reads the wallet on the cadence the refresh was started with', async () => {
    vi.useFakeTimers()
    const { account } = accountOver([GRANT])
    await account.begin()
    await tick(1_000)
    account.startWalletRefresh(5_000)
    await settleIo()
    const before = requests.filter(path => path === 'GET /api/dsh/device/wallet').length
    // One immediate read at start, then one per interval.
    expect(before).toBeGreaterThanOrEqual(1)
    await tick(5_000)
    expect(requests.filter(path => path === 'GET /api/dsh/device/wallet').length).toBe(before + 1)
    await tick(5_000)
    expect(requests.filter(path => path === 'GET /api/dsh/device/wallet').length).toBe(before + 2)
  })

  it('keeps the last known facts when the site has no wallet endpoint yet', async () => {
    vi.useFakeTimers()
    const { account } = accountOver([GRANT], { wallet: 'unreachable' })
    await account.begin()
    await tick(1_000)
    await account.refreshWallet()
    const status = await account.status()
    expect(status.account).toEqual({
      username: 'tester',
      displayName: '测试账号',
      group: 'default',
      balance: '￥7.00',
      used: '￥3.50',
    })
  })

  it('persists the refreshed wallet so a restart shows it without a grant', async () => {
    vi.useFakeTimers()
    const home = await makeHome()
    const store = new Map<string, string>()
    const first = accountOver([GRANT], { home, store, wallet: WALLET })
    await first.account.begin()
    await tick(1_000)
    await first.account.refreshWallet()
    await settleIo()

    const second = accountOver([], { home, store })
    const status = await second.account.status()
    expect(status.account?.balance).toBe('￥14.00')
    expect(status.account?.vouchers).toEqual([{ group: '[低价] Grok', groupId: 7, amount: '￥3.50' }])
  })
})
