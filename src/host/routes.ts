/**
 * The settings page's HTTP carrier: four same-origin endpoints the `NearToken`
 * section calls, because a plugin cannot extend the application's Remote
 * namespaces and the browser cannot reach the site directly (CORS).
 *
 * Every route asks the composition's `connection` service for a rejection
 * first — the same Host/Origin fence the application's own routes use — so no
 * other page can start an authorization in the user's name.
 *
 * @module
 */
import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  AUTHORIZE_PATH, CANCEL_PATH, GUARD_PATH, IMAGES_PATH, LINK_PATH, LOGOUT_PATH, MODELS_PATH, OPEN_PATH, REFRESH_PATH,
  STATUS_PATH, TOPUP_PATH, USAGE_PATH, isEndpointAddress, isUsageRange,
} from '../protocol.ts'
import { NearTokenTopupError, type NearTokenTopupInfo, type NearTokenTopupOrder } from './topup.ts'
import { normalizeAffiliateCode } from '../affiliate.ts'
import type {
  NearTokenGuardState, NearTokenImagesState, NearTokenLinkPatch, NearTokenLinkState, NearTokenModelMeta,
  NearTokenModelsState, NearTokenUsageRange, NearTokenUsageState,
} from '../protocol.ts'
import type { NearTokenAccount } from './account.ts'
import type { JsonObject } from './new-api.ts'
import { parseEnabled, parseMeta } from './whitelist.ts'

/** Bodies here are at most one short object; anything larger is hostile. */
const MAX_BODY_BYTES = 8 * 1024

/** A whitelist body names up to a few thousand models, so it gets its own bound. */
const MAX_WHITELIST_BODY_BYTES = 64 * 1024

/** What the routes need from the plugin. */
export interface NearTokenRouteDeps {
  /** The account the authorization and the stored key live on. */
  account: NearTokenAccount
  /** Runs after the stored key was removed, so the provider route can unmount. */
  onDisconnect: () => void
  /**
   * Open one address in the user's own browser.
   * @param address - the pending confirmation page.
   */
  openInBrowser: (address: string) => Promise<void>
  /** The site's catalog beside the stored whitelist. */
  models: () => Promise<NearTokenModelsState>
  /**
   * Persist a whitelist, and the meta overrides when the save names them.
   * @param enabled - model names to keep visible; an empty list restores the whole catalog.
   * @param meta - the complete per-model overrides; absent keeps the stored ones.
   */
  saveModels: (enabled: readonly string[], meta: Readonly<Record<string, NearTokenModelMeta>> | undefined) => Promise<void>
  /**
   * One window of the account's usage, read with the stored key.
   * @param range - the window to read.
   */
  usage: (range: NearTokenUsageRange) => Promise<NearTokenUsageState>
  /** The site's top-up offer, read with the stored key. */
  topupInfo: () => Promise<NearTokenTopupInfo>
  /** Start one top-up order; the caller opens the returned checkout link. */
  createTopup: (amount: number, paymentMethod: string) => Promise<NearTokenTopupOrder>
  /** Site root, for turning the site-relative checkout link absolute. */
  baseURL: () => string
  /** The long-connection switch, the custom endpoint, and the origins they choose between. */
  link: () => NearTokenLinkState
  /**
   * Persist the endpoints the page moved. A field the patch leaves out keeps
   * what is stored, so one switch never rewrites the other's value.
   * @param patch - the fields to store.
   */
  saveLink: (patch: NearTokenLinkPatch) => Promise<void>
  /** The anti-degradation switch. */
  guard: () => NearTokenGuardState
  /**
   * Persist the anti-degradation switch.
   * @param enabled - whether a Gemini-4 request body is rewritten in Chinese.
   */
  saveGuard: (enabled: boolean) => Promise<void>
  /** The picture models beside the stored image-generation setting. */
  images: () => Promise<NearTokenImagesState>
  /**
   * Persist the image-generation setting.
   * @param body - the raw request body, validated against the current catalog.
   * @returns a refusal message, or nothing once the setting was stored.
   */
  saveImages: (body: unknown) => Promise<{ readonly message: string } | undefined>
}

/** The facts a trust check reads off one request. */
interface TrustRequest {
  readonly headers: IncomingMessage['headers']
}

/** Trust surface consumed here; the browser-side connection package owns the full type. */
interface RouteConnection {
  /**
   * Admit the request against its credential and live Peer. The current
   * contract: a Host that has this decides both the fence and the principal.
   * @param request - the request under test.
   * @returns the admitted Peer, the refusal status, or undefined when the
   *   service has not decided.
   */
  admit?(request: TrustRequest): { readonly peer: unknown } | { readonly rejection: 401 | 403 | 409 } | undefined
  /**
   * The older contract: only the Host/Origin fence, no Peer. Kept so a Host
   * that predates {@link RouteConnection.admit} still refuses hostile callers
   * instead of serving them.
   * @param request - the request under test.
   * @returns the refusal status, or undefined when the request may proceed.
   */
  requestRejection?(request: TrustRequest): 401 | 403 | undefined
}

/**
 * @param ctx - a context that carries `webServer`.
 * @param deps - the account and the disconnect callback.
 */
export function registerNearTokenRoutes(ctx: Context, deps: NearTokenRouteDeps): void {
  /**
   * Mount one settings-page route, publishing a handler failure as JSON.
   *
   * A Host that receives a thrown handler has nowhere to put the reason: it logs
   * a warning and answers 400 with an empty body, so the page can report nothing
   * but a status code and the reader never learns what broke. Every route here
   * therefore reports its own failure — the whole stack, cause chain included.
   * @param path - the exact path the page calls.
   * @param handler - the route's own work.
   */
  const mount = (path: string, handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>): void => {
    ctx.effect(() => ctx.webServer.register({
      kind: 'exact',
      path,
      handler: async (req, res) => {
        try {
          await handler(req, res)
        } catch (error: unknown) {
          // A composition may mount no logger; publishing the failure must not
          // become a second failure of its own.
          ctx.logger?.warn?.(`neartoken: ${path} failed`, error)
          sendFailure(res, error)
        }
      },
    }), `neartoken: ${path}`)
  }

  mount(STATUS_PATH, async (req, res) => {
    if (rejected(ctx, req, res)) return
    if (req.method !== 'GET') {
      sendMethodNotAllowed(res, 'GET')
      return
    }
    sendJson(res, 200, await deps.account.status())
  })

  // The page asking for the card's money facts to be re-read now. The answer is
  // the same state the status route serves, so one round trip updates the card.
  mount(REFRESH_PATH, async (req, res) => {
    if (rejected(ctx, req, res)) return
    if (req.method !== 'POST') {
      sendMethodNotAllowed(res, 'POST')
      return
    }
    req.resume()
    await deps.account.refreshWallet()
    sendJson(res, 200, await deps.account.status())
  })

  // The usage overview: one window of spending and tokens, read with the stored
  // key. A site without the endpoint, or one out of reach, still answers 200
  // with a reason the page prints — an empty chart would read as "no usage",
  // which is a different fact from "nothing to read".
  mount(USAGE_PATH, async (req, res) => {
    if (rejected(ctx, req, res)) return
    if (req.method !== 'GET') {
      sendMethodNotAllowed(res, 'GET')
      return
    }
    const range = queryParam(req, 'range') ?? 'day'
    if (!isUsageRange(range)) {
      sendJson(res, 400, { code: 'bad-request', message: 'range 必须是 day / week / month' })
      return
    }
    sendJson(res, 200, await deps.usage(range))
  })

  // The start of an authorization. The optional body carries the invite code a
  // referring page left on the browser window: a hint the site's own sign-up
  // pages read off the confirmation address, not a credential, and never a
  // reason to refuse the start — a caller posting no body is authorized too.
  mount(AUTHORIZE_PATH, async (req, res) => {
    if (rejected(ctx, req, res)) return
    if (req.method !== 'POST') {
      sendMethodNotAllowed(res, 'POST')
      return
    }
    if (!jsonBody(req)) {
      req.resume()
      sendJson(res, 200, await deps.account.begin())
      return
    }
    const body = await readJsonObject(req, res, MAX_BODY_BYTES)
    if (body === undefined) return
    sendJson(res, 200, await deps.account.begin(normalizeAffiliateCode(body.affCode)))
  })

  // The confirmation page belongs in the user's own browser: a page-opened
  // window stays inside the desktop shell, so the Host hands the address to the
  // platform launcher instead. The address is the Host's own pending one — the
  // page cannot ask this route to open an arbitrary URL.
  mount(OPEN_PATH, async (req, res) => {
    if (rejected(ctx, req, res)) return
    if (req.method !== 'POST') {
      sendMethodNotAllowed(res, 'POST')
      return
    }
    req.resume()
    const { pending } = await deps.account.status()
    if (pending === undefined) {
      sendJson(res, 409, { code: 'no-authorization', message: '没有正在进行的授权' })
      return
    }
    await deps.openInBrowser(pending.verificationUriComplete)
    sendJson(res, 200, { ok: true })
  })

  mount(CANCEL_PATH, async (req, res) => {
    if (rejected(ctx, req, res)) return
    if (req.method !== 'POST') {
      sendMethodNotAllowed(res, 'POST')
      return
    }
    await deps.account.cancel()
    sendJson(res, 200, { ok: true })
  })

  mount(LOGOUT_PATH, async (req, res) => {
    if (rejected(ctx, req, res)) return
    if (req.method !== 'POST') {
      sendMethodNotAllowed(res, 'POST')
      return
    }
    await deps.account.signOut()
    deps.onDisconnect()
    sendJson(res, 200, { ok: true })
  })

  // One path, two verbs: the page reads the catalog and the stored whitelist
  // together, and saves a new list back.
  mount(MODELS_PATH, async (req, res) => {
    if (rejected(ctx, req, res)) return
    if (req.method === 'GET') {
      sendJson(res, 200, await deps.models())
      return
    }
    if (req.method !== 'POST') {
      sendMethodNotAllowed(res, 'GET, POST')
      return
    }
    const body = await readJsonObject(req, res, MAX_WHITELIST_BODY_BYTES)
    if (body === undefined) return
    const enabled = parseEnabled(body.enabled)
    if (enabled === undefined) {
      sendJson(res, 400, { code: 'bad-request', message: 'enabled 必须是模型名数组' })
      return
    }
    // Absent keeps the stored overrides: the whitelist autosaves without
    // them, and such a save must not erase what the meta editor wrote.
    let meta: Record<string, NearTokenModelMeta> | undefined
    if (body.meta !== undefined) {
      meta = parseMeta(body.meta)
      if (meta === undefined) {
        sendJson(res, 400, { code: 'bad-request', message: 'meta 必须是每模型的 { contextWindow?, maxTokens?, input? }' })
        return
      }
    }
    // A save the settings service refuses is this page's failure to report, not
    // a request to retry silently: the whitelist did NOT move. The mount reports
    // it, so the page keeps the list it had.
    await deps.saveModels(enabled, meta)
    sendJson(res, 200, { ok: true })
  })

  // The image-generation setting: which picture models the generate_image tool
  // may call, and the group each one bills to.
  mount(IMAGES_PATH, async (req, res) => {
    if (rejected(ctx, req, res)) return
    if (req.method === 'GET') {
      sendJson(res, 200, await deps.images())
      return
    }
    if (req.method !== 'POST') {
      sendMethodNotAllowed(res, 'GET, POST')
      return
    }
    const body = await readJsonObject(req, res, MAX_WHITELIST_BODY_BYTES)
    if (body === undefined) return
    const refusal = await deps.saveImages(body)
    if (refusal !== undefined) {
      sendJson(res, 400, { code: 'bad-request', message: refusal.message })
      return
    }
    sendJson(res, 200, { ok: true })
  })

  // The origins the model picker and the settings page choose between: the
  // long-connection switch, and the custom address that overrides both. The
  // dashboard routes here never follow either — only the model-facing `/v1`
  // family does.
  mount(LINK_PATH, async (req, res) => {
    if (rejected(ctx, req, res)) return
    if (req.method === 'GET') {
      sendJson(res, 200, deps.link())
      return
    }
    if (req.method !== 'POST') {
      sendMethodNotAllowed(res, 'GET, POST')
      return
    }
    const body = await readJsonObject(req, res, MAX_BODY_BYTES)
    if (body === undefined) return
    const patch = parseLinkPatch(body)
    if (typeof patch === 'string') {
      sendJson(res, 400, { code: 'bad-request', message: patch })
      return
    }
    // A refused write leaves the stored switch where it was; the picker puts its
    // toggle back and reports the message the mount answers.
    await deps.saveLink(patch)
    sendJson(res, 200, { ok: true })
  })

  // The anti-degradation switch the model seat offers while a Gemini-4 model is
  // selected: on means that model's request body carries the harness's
  // file-reference guidance in Chinese.
  mount(GUARD_PATH, async (req, res) => {
    if (rejected(ctx, req, res)) return
    if (req.method === 'GET') {
      sendJson(res, 200, deps.guard())
      return
    }
    if (req.method !== 'POST') {
      sendMethodNotAllowed(res, 'GET, POST')
      return
    }
    const body = await readJsonObject(req, res, MAX_BODY_BYTES)
    if (body === undefined) return
    if (typeof body.enabled !== 'boolean') {
      sendJson(res, 400, { code: 'bad-request', message: 'enabled 必须是布尔值' })
      return
    }
    // A refused write leaves the stored switch where it was; the picker puts its
    // toggle back and reports the message the mount answers.
    await deps.saveGuard(body.enabled)
    sendJson(res, 200, { ok: true })
  })

  // Top-up: GET reads what the site sells, POST starts one order and hands the
  // checkout page to the platform launcher. The page never builds the gateway
  // form itself — the site does, on a signed link — so nothing here can be
  // pointed at a gateway the site did not sign for.
  mount(TOPUP_PATH, async (req, res) => {
    if (rejected(ctx, req, res)) return
    if (req.method === 'GET') {
      try {
        sendJson(res, 200, await deps.topupInfo())
      } catch (error: unknown) {
        sendJson(res, 409, refusalOf(error))
      }
      return
    }
    if (req.method !== 'POST') {
      sendMethodNotAllowed(res, 'GET, POST')
      return
    }
    const body = await readJsonObject(req, res, MAX_BODY_BYTES)
    if (body === undefined) return
    const amount = typeof body.amount === 'number' ? body.amount : undefined
    const paymentMethod = typeof body.paymentMethod === 'string' ? body.paymentMethod : undefined
    if (amount === undefined || paymentMethod === undefined) {
      sendJson(res, 400, { code: 'bad-request', message: 'amount 与 paymentMethod 为必填' })
      return
    }
    let order: NearTokenTopupOrder
    try {
      order = await deps.createTopup(amount, paymentMethod)
    } catch (error: unknown) {
      // A refusal the user can act on (reconnect) is not a server fault.
      sendJson(res, 409, refusalOf(error))
      return
    }
    await deps.openInBrowser(deps.baseURL().replace(/\/$/, '') + order.payUrl)
    sendJson(res, 200, { ok: true, tradeNo: order.tradeNo })
  })
}

/**
 * Turn a top-up failure into the body the page acts on.
 * @param error - whatever the account threw.
 * @returns the status-free refusal body.
 */
function refusalOf(error: unknown): { readonly code: string; readonly message: string } {
  const reason = error instanceof NearTokenTopupError ? error.reason : 'refused'
  return {
    code: reason === 'not-dsh' ? 'not-dsh' : reason,
    message: error instanceof Error ? error.message : String(error),
  }
}

/**
 * Read the endpoint fields out of one untrusted link body.
 *
 * Only the three fields the page may move are read, and each is checked here so
 * an unusable address is refused before it reaches the stored setting.
 * @param body - the parsed request body.
 * @returns the patch to store, or the refusal to answer.
 */
function parseLinkPatch(body: JsonObject): NearTokenLinkPatch | string {
  const { direct, custom, endpoint } = body
  if (direct === undefined && custom === undefined && endpoint === undefined) return '请求里没有要保存的字段'
  if (direct !== undefined && typeof direct !== 'boolean') return 'direct 必须是布尔值'
  if (custom !== undefined && typeof custom !== 'boolean') return 'custom 必须是布尔值'
  if (endpoint !== undefined) {
    if (typeof endpoint !== 'string') return 'endpoint 必须是字符串'
    if (!isEndpointAddress(endpoint)) return '自定义端点必须是 http(s) 地址'
  }
  return {
    ...typeof direct === 'boolean' ? { direct } : {},
    ...typeof custom === 'boolean' ? { custom } : {},
    ...typeof endpoint === 'string' ? { endpoint: endpoint.trim() } : {},
  }
}

/**
 * Whether a request declares a JSON body, i.e. whether there is anything to read.
 * @param req - the request under test.
 * @returns true when the body is declared as JSON.
 */
function jsonBody(req: IncomingMessage): boolean {
  return text(String(req.headers['content-type']).split(';', 1)[0]?.trim().toLowerCase()) === 'application/json'
}

/**
 * Answer an untrusted or unauthenticated request.
 * @param ctx - the plugin context, which may carry `connection`.
 * @param req - the request under test.
 * @param res - the response to refuse on.
 * @returns true when the request was refused and the response is complete.
 */
function rejected(ctx: Context, req: IncomingMessage, res: ServerResponse): boolean {
  const connection = ctx.get('connection') as RouteConnection | undefined
  // `admit` answers both questions at once — is this caller trusted, and whose
  // Peer does it speak for — so it is the one asked first. A Host that predates
  // it only fences the origin; asking that instead keeps the page refused to
  // hostile callers rather than open to them.
  const admission = connection?.admit?.(req)
  if (admission !== undefined) {
    if ('peer' in admission) return false
    res.statusCode = admission.rejection
    res.end()
    return true
  }
  const rejection = connection?.requestRejection?.(req)
  if (rejection === undefined) return false
  res.statusCode = rejection
  res.end()
  return true
}

/** How deep a cause chain is followed before it stops explaining anything. */
const CAUSE_DEPTH = 5

/**
 * Render one thrown value as the complete diagnostic the page shows.
 *
 * The stack, then every `cause` beneath it: a route failure used to reach the
 * reader as a bare status code, and a shortened sentence would reach them as a
 * sentence that does not say where it came from.
 * @param error - whatever the handler threw.
 * @returns the text to publish.
 */
function describeFailure(error: unknown): string {
  const parts: string[] = []
  let current: unknown = error
  for (let depth = 0; depth < CAUSE_DEPTH && current !== undefined; depth += 1) {
    if (!(current instanceof Error)) {
      parts.push(thrownText(current))
      break
    }
    parts.push(current.stack ?? `${current.name}: ${current.message}`)
    current = current.cause
  }
  return parts.join('\n\ncaused by: ')
}

/**
 * Render a thrown value that is not an `Error` as text.
 * @param value - whatever was thrown.
 * @returns its own text, its JSON form, or its string form.
 */
function thrownText(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value) ?? String(value)
  } catch (_error) {
    return String(value)
  }
}

/**
 * Answer a handler's thrown value with the full diagnostic.
 *
 * A response already on the wire cannot carry it, so the socket is closed
 * instead — the one case where the page learns nothing new. Everything else is
 * a 500 whose message the page prints verbatim.
 * @param res - the response to answer on.
 * @param error - whatever the handler threw.
 */
function sendFailure(res: ServerResponse, error: unknown): void {
  if (res.headersSent) {
    res.destroy()
    return
  }
  sendJson(res, 500, { code: 'internal', message: describeFailure(error) })
}

/** JSON response (no-store: every answer here is a live fact). */
function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(payload))
}

/** 405 with the route's supported methods. */
function sendMethodNotAllowed(res: ServerResponse, allow: string): void {
  res.statusCode = 405
  res.setHeader('allow', allow)
  res.end()
}

/**
 * Collect a bounded JSON object request body.
 * @param req - the request to read.
 * @param res - the response to answer on when the body is unusable.
 * @param limit - largest accepted body, in bytes.
 * @returns the parsed object, or undefined once a refusal was sent.
 */
export async function readJsonObject(
  req: IncomingMessage, res: ServerResponse, limit: number = MAX_BODY_BYTES,
): Promise<JsonObject | undefined> {
  const essence = text(String(req.headers['content-type']).split(';', 1)[0]?.trim().toLowerCase())
  if (essence !== 'application/json') {
    sendJson(res, 415, { code: 'unsupported-media-type', message: 'content-type 必须是 application/json' })
    return undefined
  }
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.byteLength
    if (size > limit) {
      // Drain the remainder so the refusal is a readable response.
      req.resume()
      sendJson(res, 413, { code: 'payload-too-large', message: '请求体过大' })
      return undefined
    }
    chunks.push(chunk)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch (_error) {
    // A body that is not JSON is the caller's mistake and gets one refusal.
    sendJson(res, 400, { code: 'bad-request', message: '请求体不是合法 JSON' })
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    sendJson(res, 400, { code: 'bad-request', message: '请求体必须是 JSON 对象' })
    return undefined
  }
  return parsed as JsonObject
}

/**
 * Read one query parameter off a request.
 * @param req - the request to read.
 * @param name - the parameter name.
 * @returns the value, or undefined when the request carries none.
 */
function queryParam(req: IncomingMessage, name: string): string | undefined {
  // The registered path is exact, so whatever follows the '?' is this route's
  // own query string; nothing else needs parsing.
  const url = req.url ?? ''
  const mark = url.indexOf('?')
  const search = mark === -1 ? '' : url.slice(mark + 1)
  const value = new URLSearchParams(search).get(name)
  return value === null ? undefined : text(value)
}

/** One non-empty string member, or undefined. */
function text(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}
