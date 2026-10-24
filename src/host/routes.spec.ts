/**
 * The models route: one same-origin path carrying both halves of the whitelist
 * page — GET answers the catalog beside the stored list, POST stores a list
 * the page built. The fence, the method, the media type, and the body bound
 * are the same refusals the other routes make.
 *
 * The open route is covered here too: the page cannot launch the user's browser
 * itself, so the Host does it — and only ever for its own pending address.
 */
import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { IMAGES_PATH, MODELS_PATH, OPEN_PATH, REFRESH_PATH, STATUS_PATH, TOPUP_PATH } from '../protocol.ts'
import type { NearTokenImagesState, NearTokenModelsState, NearTokenStatus } from '../protocol.ts'
import { registerNearTokenRoutes } from './routes.ts'
import { NearTokenTopupError, type NearTokenTopupInfo } from './topup.ts'
import type { NearTokenAccount } from './account.ts'
import type { NearTokenRouteDeps } from './routes.ts'

/** The catalog the state route answers. */
const STATE: NearTokenModelsState = {
  models: [{ model: 'glm-5.3', groups: [{ group: 'default', ratio: '2x' }] }],
  enabled: [],
  meta: {},
}

/** The picture catalog the image route answers. */
const IMAGES: NearTokenImagesState = {
  enabled: true,
  models: [{ model: 'gpt-image-2.5-flare', channel: 'images', groups: [{ group: 'promo', ratio: '0.8x' }] }],
  selection: { 'gpt-image-2.5-flare': 'promo' },
}

/** One recorded answer. */
interface Answer {
  status: number
  headers: Record<string, string>
  body: string
}

/**
 * Build a request with an optional JSON body.
 * @param method - the HTTP method.
 * @param body - the raw body, or undefined for none.
 * @param contentType - the request's content type.
 * @returns the request, iterable the way the route reads it.
 */
function request(method: string, body?: string, contentType = 'application/json'): IncomingMessage {
  const chunks = body === undefined ? [] : [Buffer.from(body, 'utf8')]
  return {
    method,
    headers: body === undefined ? {} : { 'content-type': contentType },
    async *[Symbol.asyncIterator]() { for (const chunk of chunks) yield chunk },
    resume() {},
  } as unknown as IncomingMessage
}

/**
 * Register the routes over a fake web server and drive one of them.
 * @param deps - the route's collaborators.
 * @returns the answer of one request against `path`.
 */
function routesOver(deps: Partial<NearTokenRouteDeps> = {}): {
  answer: (path: string, req: IncomingMessage) => Promise<Answer>
  saves: { enabled: readonly string[]; meta: unknown }[]
  imageSaves: unknown[]
  opened: string[]
} {
  const handlers = new Map<string, (req: IncomingMessage, res: ServerResponse) => Promise<void>>()
  const saves: { enabled: readonly string[]; meta: unknown }[] = []
  const imageSaves: unknown[] = []
  const opened: string[] = []
  const ctx = {
    effect: (register: () => unknown) => register(),
    get: () => undefined,
    webServer: {
      register(route: { path: string; handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> }) {
        handlers.set(route.path, route.handler)
        return () => { handlers.delete(route.path) }
      },
    },
  } as unknown as Context
  registerNearTokenRoutes(ctx, {
    account: {} as NearTokenAccount,
    onDisconnect: () => {},
    models: async () => STATE,
    saveModels: async (enabled, meta) => { saves.push({ enabled, meta }) },
    images: async () => IMAGES,
    saveImages: async (body) => { imageSaves.push(body); return undefined },
    topupInfo: async () => OFFER,
    createTopup: async () => ({ tradeNo: 'DSH1NOA1', payUrl: '/dsh/pay?trade_no=DSH1NOA1&sig=s' }),
    baseURL: () => 'https://site.example',
    openInBrowser: async (address) => { opened.push(address) },
    ...deps,
  })
  return {
    saves,
    imageSaves,
    opened,
    async answer(path, req) {
      const handler = handlers.get(path)
      if (handler === undefined) throw new Error(`no route ${path}`)
      const answer: Answer = { status: 0, headers: {}, body: '' }
      const res = {
        statusCode: 0,
        setHeader(name: string, value: string) { answer.headers[name] = value },
        end(chunk?: string) {
          answer.status = res.statusCode
          answer.body = chunk ?? ''
        },
      } as unknown as ServerResponse
      await handler(req, res)
      return answer
    },
  }
}



/** The top-up offer the card draws. */
const OFFER: NearTokenTopupInfo = {
  enabled: true,
  minTopup: 10,
  amountOptions: [10, 50],
  methods: [{ type: 'alipay', name: '支付宝' }],
}

/** The state the refresh route answers with. */
const STATUS: NearTokenStatus = {
  configured: true,
  baseURL: 'https://site.example',
  tokenName: 'DSH',
  account: { username: 'ada', displayName: 'Ada', group: 'default', balance: '$1.00', used: '$0.20' },
}

describe('POST /neartoken/refresh', () => {
  it('re-reads the wallet, then answers the state the status route serves', async () => {
    const calls: string[] = []
    const account = {
      refreshWallet: async () => { calls.push('refresh') },
      status: async () => { calls.push('status'); return STATUS },
    } as unknown as NearTokenAccount
    const { answer } = routesOver({ account })
    const { status, body, headers } = await answer(REFRESH_PATH, request('POST'))
    expect(status).toBe(200)
    expect(headers['cache-control']).toBe('no-store')
    // Read first, answer second: the numbers in the answer are the fresh ones.
    expect(calls).toEqual(['refresh', 'status'])
    expect(JSON.parse(body)).toEqual(STATUS)
  })

  it('refuses a method it does not serve', async () => {
    const { answer } = routesOver()
    const { status, headers } = await answer(REFRESH_PATH, request('GET'))
    expect(status).toBe(405)
    expect(headers.allow).toBe('POST')
  })
})

describe('GET /neartoken/models', () => {
  it('answers the catalog beside the stored whitelist', async () => {
    const { answer } = routesOver()
    const { status, body, headers } = await answer(MODELS_PATH, request('GET'))
    expect(status).toBe(200)
    expect(headers['cache-control']).toBe('no-store')
    expect(JSON.parse(body)).toEqual(STATE)
  })

  it('refuses a method it does not serve', async () => {
    const { answer } = routesOver()
    const { status, headers } = await answer(MODELS_PATH, request('DELETE'))
    expect(status).toBe(405)
    expect(headers.allow).toBe('GET, POST')
  })
})

describe('POST /neartoken/models', () => {
  it('stores the list the page sent', async () => {
    const { answer, saves } = routesOver()
    const { status } = await answer(MODELS_PATH, request('POST', JSON.stringify({ enabled: [' glm-5.3 ', 'glm-5.3'] })))
    expect(status).toBe(200)
    expect(saves).toEqual([{ enabled: ['glm-5.3'], meta: undefined }])
  })

  it('stores an empty list, which shows every model again', async () => {
    const { answer, saves } = routesOver()
    await answer(MODELS_PATH, request('POST', JSON.stringify({ enabled: [] })))
    expect(saves).toEqual([{ enabled: [], meta: undefined }])
  })

  it('refuses a body whose enabled member is not a list of model names', async () => {
    const { answer, saves } = routesOver()
    const { status, body } = await answer(MODELS_PATH, request('POST', JSON.stringify({ enabled: 'glm-5.3' })))
    expect(status).toBe(400)
    expect(JSON.parse(body).code).toBe('bad-request')
    expect(saves).toEqual([])
  })

  it('stores the meta overrides the page sent beside the list', async () => {
    const { answer, saves } = routesOver()
    const meta = { 'glm-5.3': { contextWindow: 500_000, input: ['text', 'image'] } }
    const { status } = await answer(MODELS_PATH, request('POST', JSON.stringify({ enabled: ['glm-5.3'], meta })))
    expect(status).toBe(200)
    expect(saves).toEqual([{ enabled: ['glm-5.3'], meta: { 'glm-5.3': { contextWindow: 500_000, input: ['text', 'image'] } } }])
  })

  it('keeps the stored overrides when the body names none', async () => {
    const { answer, saves } = routesOver()
    // The whitelist autosaves without meta; such a save must not erase what
    // the meta editor wrote.
    const { status } = await answer(MODELS_PATH, request('POST', JSON.stringify({ enabled: ['glm-5.3'] })))
    expect(status).toBe(200)
    expect(saves).toEqual([{ enabled: ['glm-5.3'], meta: undefined }])
  })

  it('refuses a body whose meta member is not per-model facts', async () => {
    const { answer, saves } = routesOver()
    const { status, body } = await answer(MODELS_PATH, request('POST', JSON.stringify({ enabled: [], meta: { m: { contextWindows: 5 } } })))
    expect(status).toBe(400)
    expect(JSON.parse(body).code).toBe('bad-request')
    expect(saves).toEqual([])
  })

  it('refuses a body that is not JSON, without reaching the save', async () => {
    const { answer, saves } = routesOver()
    const { status } = await answer(MODELS_PATH, request('POST', 'not json'))
    expect(status).toBe(400)
    expect(saves).toEqual([])
  })

  it('refuses a content type it does not read', async () => {
    const { answer, saves } = routesOver()
    const { status } = await answer(MODELS_PATH, request('POST', '{}', 'text/plain'))
    expect(status).toBe(415)
    expect(saves).toEqual([])
  })

  it('reports a refused save instead of pretending it stored the list', async () => {
    const { answer } = routesOver({ saveModels: async () => { throw new Error('no profile entry') } })
    const { status, body } = await answer(MODELS_PATH, request('POST', JSON.stringify({ enabled: [] })))
    expect(status).toBe(500)
    expect(JSON.parse(body)).toEqual({ code: 'save-failed', message: 'no profile entry' })
  })
})

describe('the same-origin fence', () => {
  it('refuses every request the connection service rejects, before any route work', async () => {
    const handlers = new Map<string, (req: IncomingMessage, res: ServerResponse) => Promise<void>>()
    const ctx = {
      effect: (register: () => unknown) => register(),
      get: () => ({ requestRejection: () => 403 }),
      webServer: {
        register(route: { path: string; handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> }) {
          handlers.set(route.path, route.handler)
          return () => { handlers.delete(route.path) }
        },
      },
    } as unknown as Context
    const saves: { enabled: readonly string[]; meta: unknown }[] = []
    registerNearTokenRoutes(ctx, {
      account: {} as NearTokenAccount,
      onDisconnect: () => {},
      models: async () => STATE,
      saveModels: async (enabled, meta) => { saves.push({ enabled, meta }) },
      images: async () => IMAGES,
      saveImages: async () => undefined,
      topupInfo: async () => OFFER,
      createTopup: async () => ({ tradeNo: 'DSH1NOA1', payUrl: '/dsh/pay?trade_no=DSH1NOA1&sig=s' }),
      baseURL: () => 'https://site.example',
      openInBrowser: async () => {},
    })
    let status = 0
    const res = { statusCode: 0, setHeader() {}, end() { status = res.statusCode } } as unknown as ServerResponse
    await handlers.get(MODELS_PATH)?.(request('POST', JSON.stringify({ enabled: [] })), res)
    expect(status).toBe(403)
    expect(handlers.has(STATUS_PATH)).toBe(true)
    expect(saves).toEqual([])
  })
})
describe('the models route body', () => {
  it('stores the list the page sent', async () => {
    const { answer, saves } = routesOver()
    const { status } = await answer(MODELS_PATH, request('POST', JSON.stringify({ enabled: ['glm-5.3'] })))
    expect(status).toBe(200)
    expect(saves).toEqual([{ enabled: ['glm-5.3'], meta: undefined }])
  })
})

describe('the images route', () => {
  it('answers the picture catalog beside the stored setting', async () => {
    const { answer } = routesOver()
    const { status, body } = await answer(IMAGES_PATH, request('GET'))
    expect(status).toBe(200)
    expect(JSON.parse(body)).toEqual(IMAGES)
  })

  it('refuses a method it does not serve', async () => {
    const { answer } = routesOver()
    const { status, headers } = await answer(IMAGES_PATH, request('DELETE'))
    expect(status).toBe(405)
    expect(headers.allow).toBe('GET, POST')
  })

  it('hands the raw body to the store, which owns the catalog check', async () => {
    const { answer, imageSaves } = routesOver()
    const body = { enabled: true, models: { 'gpt-image-2.5-flare': 'promo' } }
    const { status } = await answer(IMAGES_PATH, request('POST', JSON.stringify(body)))
    expect(status).toBe(200)
    expect(imageSaves).toEqual([body])
  })

  it('refuses a body the catalog does not know', async () => {
    const { answer } = routesOver({ saveImages: async () => ({ message: '图像模型或分组不在站点当前的图像清单里' }) })
    const { status, body } = await answer(IMAGES_PATH, request('POST', JSON.stringify({ enabled: true, models: {} })))
    expect(status).toBe(400)
    expect(JSON.parse(body).message).toContain('图像清单')
  })

  it('reports a settings write that failed as a server failure', async () => {
    const { answer } = routesOver({ saveImages: async () => { throw new Error('no settings service') } })
    const { status, body } = await answer(IMAGES_PATH, request('POST', JSON.stringify({ enabled: true, models: {} })))
    expect(status).toBe(500)
    expect(JSON.parse(body).code).toBe('save-failed')
  })
})

describe('POST /neartoken/open', () => {
  /** One authorization the page is waiting on. */
  const PENDING = {
    userCode: 'ABCD-EFGH',
    verificationUri: 'https://site/device',
    verificationUriComplete: 'https://site/device?code=ABCD-EFGH',
    expiresAt: Date.now() + 60_000,
  }

  /**
   * @param pending - the authorization the account reports.
   * @returns an account stand-in for the open route.
   */
  function accountWith(pending: typeof PENDING | undefined): NearTokenAccount {
    return {
      async status() {
        return {
          configured: false,
          baseURL: 'https://site',
          tokenName: 'dsh',
          ...pending === undefined ? {} : { pending },
        }
      },
    } as unknown as NearTokenAccount
  }

  it('launches the pending confirmation page in the user browser', async () => {
    const { answer, opened } = routesOver({ account: accountWith(PENDING) })
    const { status } = await answer(OPEN_PATH, request('POST'))
    expect(status).toBe(200)
    expect(opened).toEqual([PENDING.verificationUriComplete])
  })

  it('refuses when no authorization is running', async () => {
    const { answer, opened } = routesOver({ account: accountWith(undefined) })
    const { status, body } = await answer(OPEN_PATH, request('POST'))
    expect(status).toBe(409)
    expect(JSON.parse(body).code).toBe('no-authorization')
    expect(opened).toEqual([])
  })

  it('reports a launcher the platform refused', async () => {
    const { answer } = routesOver({
      account: accountWith(PENDING),
      openInBrowser: async () => { throw new Error('当前平台 aix 没有已知的浏览器打开方式') },
    })
    const { status, body } = await answer(OPEN_PATH, request('POST'))
    expect(status).toBe(500)
    expect(JSON.parse(body)).toEqual({ code: 'open-failed', message: '当前平台 aix 没有已知的浏览器打开方式' })
  })

  it('refuses a method it does not serve', async () => {
    const { answer, opened } = routesOver({ account: accountWith(PENDING) })
    const { status, headers } = await answer(OPEN_PATH, request('GET'))
    expect(status).toBe(405)
    expect(headers.allow).toBe('POST')
    expect(opened).toEqual([])
  })
})

describe('GET /neartoken/topup', () => {
  it('answers the site offer', async () => {
    const { answer } = routesOver()
    const { status, body, headers } = await answer(TOPUP_PATH, request('GET'))
    expect(status).toBe(200)
    expect(headers['cache-control']).toBe('no-store')
    expect(JSON.parse(body)).toEqual(OFFER)
  })

  it('tells the page to reconnect when the key is not a device key', async () => {
    const { answer } = routesOver({
      topupInfo: async () => { throw new NearTokenTopupError('not-dsh', 'not a device key') },
    })
    const { status, body } = await answer(TOPUP_PATH, request('GET'))
    expect(status).toBe(409)
    expect(JSON.parse(body).code).toBe('not-dsh')
  })
})

describe('POST /neartoken/topup', () => {
  it('opens the checkout page in the system browser and answers the trade number', async () => {
    const { answer, opened } = routesOver()
    const { status, body } = await answer(TOPUP_PATH, request('POST', JSON.stringify({ amount: 50, paymentMethod: 'alipay' })))
    expect(status).toBe(200)
    expect(JSON.parse(body)).toEqual({ ok: true, tradeNo: 'DSH1NOA1' })
    expect(opened).toEqual(['https://site.example/dsh/pay?trade_no=DSH1NOA1&sig=s'])
  })

  it('refuses a body without an amount', async () => {
    const { answer, opened } = routesOver()
    const { status } = await answer(TOPUP_PATH, request('POST', JSON.stringify({ paymentMethod: 'alipay' })))
    expect(status).toBe(400)
    expect(opened).toEqual([])
  })

  it('answers the refusal reason when the site rejects the order', async () => {
    const { answer } = routesOver({
      createTopup: async () => { throw new NearTokenTopupError('refused', 'Payment amount is too low') },
    })
    const { status, body } = await answer(TOPUP_PATH, request('POST', JSON.stringify({ amount: 50, paymentMethod: 'alipay' })))
    expect(status).toBe(409)
    expect(JSON.parse(body)).toEqual({ code: 'refused', message: 'Payment amount is too low' })
  })
})
