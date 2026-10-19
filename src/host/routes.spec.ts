/**
 * The models route: one same-origin path carrying both halves of the whitelist
 * page — GET answers the catalog beside the stored list, POST stores a list
 * the page built. The fence, the method, the media type, and the body bound
 * are the same refusals the other routes make.
 */
import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { IMAGES_PATH, MODELS_PATH, STATUS_PATH } from '../protocol.ts'
import type { NearTokenImagesState, NearTokenModelsState } from '../protocol.ts'
import { registerNearTokenRoutes } from './routes.ts'
import type { NearTokenAccount } from './account.ts'
import type { NearTokenRouteDeps } from './routes.ts'

/** The catalog the state route answers. */
const STATE: NearTokenModelsState = {
  models: [{ model: 'glm-5.3', groups: [{ group: 'default', ratio: '2x' }] }],
  enabled: [],
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
  saves: (readonly string[])[]
  imageSaves: unknown[]
} {
  const handlers = new Map<string, (req: IncomingMessage, res: ServerResponse) => Promise<void>>()
  const saves: (readonly string[])[] = []
  const imageSaves: unknown[] = []
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
    saveModels: async (enabled) => { saves.push(enabled) },
    images: async () => IMAGES,
    saveImages: async (body) => { imageSaves.push(body); return undefined },
    ...deps,
  })
  return {
    saves,
    imageSaves,
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
    expect(saves).toEqual([['glm-5.3']])
  })

  it('stores an empty list, which shows every model again', async () => {
    const { answer, saves } = routesOver()
    await answer(MODELS_PATH, request('POST', JSON.stringify({ enabled: [] })))
    expect(saves).toEqual([[]])
  })

  it('refuses a body whose enabled member is not a list of model names', async () => {
    const { answer, saves } = routesOver()
    const { status, body } = await answer(MODELS_PATH, request('POST', JSON.stringify({ enabled: 'glm-5.3' })))
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
    const saves: (readonly string[])[] = []
    registerNearTokenRoutes(ctx, {
      account: {} as NearTokenAccount,
      onDisconnect: () => {},
      models: async () => STATE,
      saveModels: async (enabled) => { saves.push(enabled) },
      images: async () => IMAGES,
      saveImages: async () => undefined,
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
    expect(saves).toEqual([['glm-5.3']])
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
