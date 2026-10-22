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
  AUTHORIZE_PATH, CANCEL_PATH, IMAGES_PATH, LOGOUT_PATH, MODELS_PATH, OPEN_PATH, STATUS_PATH,
} from '../protocol.ts'
import type { NearTokenImagesState, NearTokenModelsState } from '../protocol.ts'
import type { NearTokenAccount } from './account.ts'
import type { JsonObject } from './new-api.ts'
import { parseEnabled } from './whitelist.ts'

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
  /** Persist a whitelist; an empty list restores the whole catalog. */
  saveModels: (enabled: readonly string[]) => Promise<void>
  /** The picture models beside the stored image-generation setting. */
  images: () => Promise<NearTokenImagesState>
  /**
   * Persist the image-generation setting.
   * @param body - the raw request body, validated against the current catalog.
   * @returns a refusal message, or nothing once the setting was stored.
   */
  saveImages: (body: unknown) => Promise<{ readonly message: string } | undefined>
}

/** Trust surface consumed here; the browser-side connection package owns the full type. */
interface RouteConnection {
  requestRejection(request: { readonly headers: IncomingMessage['headers'] }): 401 | 403 | undefined
}

/**
 * @param ctx - a context that carries `webServer`.
 * @param deps - the account and the disconnect callback.
 */
export function registerNearTokenRoutes(ctx: Context, deps: NearTokenRouteDeps): void {
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: STATUS_PATH,
    handler: async (req, res) => {
      if (rejected(ctx, req, res)) return
      if (req.method !== 'GET') {
        sendMethodNotAllowed(res, 'GET')
        return
      }
      sendJson(res, 200, await deps.account.status())
    },
  }), `neartoken: GET ${STATUS_PATH}`)

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: AUTHORIZE_PATH,
    handler: async (req, res) => {
      if (rejected(ctx, req, res)) return
      if (req.method !== 'POST') {
        sendMethodNotAllowed(res, 'POST')
        return
      }
      sendJson(res, 200, await deps.account.begin())
    },
  }), `neartoken: POST ${AUTHORIZE_PATH}`)

  // The confirmation page belongs in the user's own browser: a page-opened
  // window stays inside the desktop shell, so the Host hands the address to the
  // platform launcher instead. The address is the Host's own pending one — the
  // page cannot ask this route to open an arbitrary URL.
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: OPEN_PATH,
    handler: async (req, res) => {
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
      try {
        await deps.openInBrowser(pending.verificationUriComplete)
      } catch (error: unknown) {
        sendJson(res, 500, { code: 'open-failed', message: error instanceof Error ? error.message : String(error) })
        return
      }
      sendJson(res, 200, { ok: true })
    },
  }), `neartoken: POST ${OPEN_PATH}`)

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: CANCEL_PATH,
    handler: async (req, res) => {
      if (rejected(ctx, req, res)) return
      if (req.method !== 'POST') {
        sendMethodNotAllowed(res, 'POST')
        return
      }
      await deps.account.cancel()
      sendJson(res, 200, { ok: true })
    },
  }), `neartoken: POST ${CANCEL_PATH}`)

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: LOGOUT_PATH,
    handler: async (req, res) => {
      if (rejected(ctx, req, res)) return
      if (req.method !== 'POST') {
        sendMethodNotAllowed(res, 'POST')
        return
      }
      await deps.account.signOut()
      deps.onDisconnect()
      sendJson(res, 200, { ok: true })
    },
  }), `neartoken: POST ${LOGOUT_PATH}`)

  // One path, two verbs: the page reads the catalog and the stored whitelist
  // together, and saves a new list back.
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: MODELS_PATH,
    handler: async (req, res) => {
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
      // A save the settings service refused is this page's failure to report,
      // not a request to retry silently: the whitelist did NOT move.
      try {
        await deps.saveModels(enabled)
      } catch (error: unknown) {
        sendJson(res, 500, { code: 'save-failed', message: error instanceof Error ? error.message : String(error) })
        return
      }
      sendJson(res, 200, { ok: true })
    },
  }), `neartoken: ${MODELS_PATH}`)

  // The image-generation setting: which picture models the generate_image tool
  // may call, and the group each one bills to.
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: IMAGES_PATH,
    handler: async (req, res) => {
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
      let refusal: { readonly message: string } | undefined
      try {
        refusal = await deps.saveImages(body)
      } catch (error: unknown) {
        // A save the settings service refused is this page's failure to report:
        // the stored setting did not move.
        sendJson(res, 500, { code: 'save-failed', message: error instanceof Error ? error.message : String(error) })
        return
      }
      if (refusal !== undefined) {
        sendJson(res, 400, { code: 'bad-request', message: refusal.message })
        return
      }
      sendJson(res, 200, { ok: true })
    },
  }), `neartoken: ${IMAGES_PATH}`)
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
  const rejection = connection?.requestRejection(req)
  if (rejection === undefined) return false
  res.statusCode = rejection
  res.end()
  return true
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

/** One non-empty string member, or undefined. */
function text(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}
