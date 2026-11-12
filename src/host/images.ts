/**
 * Image generation over one New API deployment: the two request shapes its
 * image models accept and the two result envelopes they answer with.
 *
 * The site lists picture generators next to chat models, and they do not share
 * one API. A model the catalog marks `image-generation` is asked through the
 * task endpoint (`POST /v1/images/tasks`): the site answers a durable task id at
 * once and the picture arrives by polling, because a slow generator outlives
 * any single HTTP response. The same endpoint answers the picture itself when
 * nothing claims the model as a task, and a site too old to know it answers 404
 * — the synchronous `POST /v1/images/generations` is then used once. The
 * Gemini-shaped ones (nano-banana, `*-image`) answer a chat completion whose
 * text embeds the picture. A call that starts from reference pictures goes to
 * the edit surface (`POST /v1/images/edits`) instead, which is where the site
 * runs its edit-capable route and checks that a picture was given. All paths end
 * here as encoded bytes, which is what a tool result can carry.
 *
 * @module
 */
import type { ImageMediaType } from '@deepseek-ai/dsh-attachment'
import { attributionHeaders } from '@deepseek-ai/dsh-llm'
import { clientHeaders } from '../client-identity.ts'
import type { NearTokenRoute } from './pricing.ts'
import { postJson } from './request-body.ts'

/** Model names that generate pictures on this kind of site, in or out of the catalog's endpoint list. */
const IMAGE_NAME = /image|imagine|nano-banana|imagen|flux|seedream|dall-?e|midjourney|recraft|ideogram/i

/**
 * Media models that are not picture generators. A catalog shares one namespace,
 * so a speech or video route whose name mentions images still must not appear as
 * a picture model.
 */
const NON_IMAGE_NAME = /tts|transcri|\basr\b|speech|embed|rerank|veo|video|lyria|music|sora|whisper/i

/** The site's durable-task surface for picture models. */
const TASKS_PATH = '/v1/images/tasks'

/** The synchronous picture surface: a site without tasks, and a site that answers one here anyway. */
const GENERATIONS_PATH = '/v1/images/generations'

/** The site's edit surface: a picture to start from and what to change about it. */
const EDITS_PATH = '/v1/images/edits'

/**
 * Statuses that mean this site has no usable edit route for the request as it
 * was shaped: the route does not exist (404/405) or the site will only take a
 * multipart edit body (415). The reference pictures then ride the generation
 * submit instead, as they did before the route existed.
 *
 * A 400 is deliberately absent: that is a rejected request, not a missing
 * route, and replaying it on another endpoint would bill a second generation.
 */
const EDIT_UNSUPPORTED_STATUS: ReadonlySet<number> = new Set([404, 405, 415])

/** First poll interval, and the ceiling it backs off to (HANDOFF-new-api.md part 7). */
const POLL_FIRST_MS = 3_000
const POLL_MAX_MS = 5_000

/** How much each poll adds before it reaches {@link POLL_MAX_MS}. */
const POLL_STEP_MS = 1_000

/**
 * Statuses worth re-reading the same task for: a gateway's own failure says
 * nothing about the task, which is still running behind it.
 */
const TRANSIENT_STATUS: ReadonlySet<number> = new Set([408, 425, 429, 500, 502, 503, 504])

/** How one image model is asked for a picture. */
export type ImageChannel = 'images' | 'genai' | 'chat'

/**
 * Whether a catalog route is a picture generator.
 * @param model - the bare model name.
 * @param endpoints - the surfaces the site declares for it, when it declares any.
 * @returns true when the model generates pictures.
 */
export function isImageModel(model: string, endpoints?: readonly string[]): boolean {
  if (NON_IMAGE_NAME.test(model)) return false
  if (endpoints?.includes('image-generation') === true) return true
  return IMAGE_NAME.test(model)
}

/**
 * Which request shape one image model speaks.
 *
 * The Gemini family declares `gemini` and a compatible `openai` surface; the
 * native one answers the picture as a structured `inlineData` part, where the
 * compatible one wraps it in assistant text as a data URL. Native measured 74 s
 * against chat's 110 s for the same model and prompt, and it does not depend on
 * a gateway conversion, so it is the route when the site declares it.
 * @param endpoints - the surfaces the site declares for the model.
 * @returns `images` for an `image-generation` model, `genai` for a Gemini one, `chat` otherwise.
 */
export function imageChannel(endpoints?: readonly string[]): ImageChannel {
  if (endpoints?.includes('image-generation') === true) return 'images'
  if (endpoints?.includes('gemini') === true) return 'genai'
  return 'chat'
}

/** The request members only the images endpoint understands. */
const IMAGES_ONLY_PARAMETERS = ['size', 'quality', 'background'] as const

/**
 * Refuse a parameter the model's channel cannot carry.
 *
 * A chat-completions picture model accepts none of these: the site would either
 * reject the body or silently drop the member, and a silently dropped size looks
 * exactly like the model ignoring the instruction. One clear refusal teaches the
 * caller more than a request that half-works.
 * @param channel - the request shape the model speaks.
 * @param request - the requested members.
 */
function assertChannelParameters(
  channel: ImageChannel,
  request: { readonly model: string; readonly size?: string; readonly quality?: string; readonly background?: string },
): void {
  if (channel === 'images') return
  const unsupported = IMAGES_ONLY_PARAMETERS.filter(name => request[name] !== undefined)
  if (unsupported.length === 0) return
  throw new Error(
    `${unsupported.join(', ')} can only be sent to an image-generation model; `
    + `${request.model} answers ${channel === 'genai' ? 'Gemini generateContent' : 'chat completions'}, `
    + `so drop ${unsupported.length === 1 ? 'it' : 'them'} `
    + 'or enable a model such as gpt-image-2.5-flare for these settings',
  )
}

/** One reference picture, in the form every channel can encode for itself. */
export interface ImagePayload {
  /** Media type the bytes were verified as. */
  readonly mediaType: string
  /** Base64 payload without a data-URL prefix. */
  readonly data: string
}

/** One picture the site answered with, before its bytes exist. */
export type ImageReply =
  | { readonly kind: 'base64'; readonly data: string }
  | { readonly kind: 'url'; readonly url: string }

/** An inline picture inside a chat answer. */
const DATA_URL = /data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/=]+)/i

/** A picture link inside a chat answer: markdown first, then a bare URL the extensions identify. */
const IMAGE_LINK = /!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s)"']+?\.(?:png|jpe?g|webp|gif))/i

/**
 * Read a gateway's answer as one picture, whatever shape that gateway used.
 * @param body - the parsed JSON answer.
 * @returns the picture reference, or undefined when the answer carries none.
 */
export function extractImageReply(body: unknown): ImageReply | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const root = body as Record<string, unknown>
  // The images endpoint answers one entry per requested picture.
  for (const entry of Array.isArray(root.data) ? root.data : []) {
    if (typeof entry !== 'object' || entry === null) continue
    const row = entry as Record<string, unknown>
    if (typeof row.b64_json === 'string' && row.b64_json.length > 0) return { kind: 'base64', data: row.b64_json }
    if (typeof row.url === 'string' && row.url.length > 0) return { kind: 'url', url: row.url }
  }
  for (const choice of Array.isArray(root.choices) ? root.choices : []) {
    if (typeof choice !== 'object' || choice === null) continue
    const message = (choice as Record<string, unknown>).message
    if (typeof message !== 'object' || message === null) continue
    const reply = replyFromMessage(message as Record<string, unknown>)
    if (reply !== undefined) return reply
  }
  // Gemini answers with a structured part rather than text wrapping a link.
  for (const candidate of Array.isArray(root.candidates) ? root.candidates : []) {
    if (typeof candidate !== 'object' || candidate === null) continue
    const content = (candidate as Record<string, unknown>).content
    if (typeof content !== 'object' || content === null) continue
    const parts = (content as Record<string, unknown>).parts
    if (!Array.isArray(parts)) continue
    for (const part of parts) {
      if (typeof part !== 'object' || part === null) continue
      const inline = (part as Record<string, unknown>).inlineData ?? (part as Record<string, unknown>).inline_data
      if (typeof inline !== 'object' || inline === null) continue
      const data = (inline as Record<string, unknown>).data
      if (typeof data === 'string' && data.length > 0) return { kind: 'base64', data }
    }
  }
  return undefined
}

/**
 * Read one chat message as a picture: its text may embed a data URL or link it.
 * @param message - the chat message object.
 * @returns the picture reference, or undefined when the message carries none.
 */
function replyFromMessage(message: Record<string, unknown>): ImageReply | undefined {
  const text = messageText(message.content)
  const inline = DATA_URL.exec(text)
  if (inline?.[2] !== undefined) return { kind: 'base64', data: inline[2] }
  const link = IMAGE_LINK.exec(text)
  const url = link?.[1] ?? link?.[2]
  if (url !== undefined) return { kind: 'url', url }
  return replyFromImages(message.images)
}

/**
 * Flatten a chat message's content into the text its picture would be in.
 * @param content - the message's `content` member, a string or a part list.
 * @returns the concatenated text.
 */
function messageText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const part of content) {
    if (typeof part !== 'object' || part === null) continue
    const text = (part as Record<string, unknown>).text
    if (typeof text === 'string') parts.push(text)
  }
  return parts.join('\n')
}

/**
 * Read the alternate chat convention, where pictures ride an `images` member.
 * @param images - the message's `images` member.
 * @returns the first picture reference, or undefined.
 */
function replyFromImages(images: unknown): ImageReply | undefined {
  if (!Array.isArray(images)) return undefined
  for (const image of images) {
    if (typeof image === 'string') {
      if (image.startsWith('data:image/')) {
        const inline = DATA_URL.exec(image)
        if (inline?.[2] !== undefined) return { kind: 'base64', data: inline[2] }
      }
      if (image.startsWith('http')) return { kind: 'url', url: image }
      continue
    }
    if (typeof image !== 'object' || image === null) continue
    const row = image as Record<string, unknown>
    const nested = row.image_url
    const candidate = typeof row.url === 'string'
      ? row.url
      : typeof nested === 'object' && nested !== null && typeof (nested as Record<string, unknown>).url === 'string'
        ? (nested as Record<string, unknown>).url as string
        : undefined
    if (candidate !== undefined) return { kind: 'url', url: candidate }
  }
  return undefined
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff] as const

/**
 * Read an image's media type from its own bytes.
 * @param data - the encoded picture.
 * @returns the media type, or undefined when the bytes are not a supported image.
 */
export function sniffImageMediaType(data: Uint8Array): ImageMediaType | undefined {
  const starts = (offset: number, expected: readonly number[]): boolean => expected
    .every((byte, index) => data[offset + index] === byte)
  const ascii = (offset: number, value: string): boolean => {
    for (let index = 0; index < value.length; index += 1) {
      if (data[offset + index] !== value.charCodeAt(index)) return false
    }
    return true
  }
  if (data.byteLength >= PNG_SIGNATURE.length && starts(0, PNG_SIGNATURE)) return 'image/png'
  if (data.byteLength >= JPEG_SIGNATURE.length && starts(0, JPEG_SIGNATURE)) return 'image/jpeg'
  if (ascii(0, 'GIF87a') || ascii(0, 'GIF89a')) return 'image/gif'
  if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return 'image/webp'
  return undefined
}

/** External facts one generation reads at call time. */
export interface NearTokenImageDeps {
  /** Origin of the model-facing endpoints (`/v1` and Gemini's `/v1beta`), without a trailing slash. */
  baseURL: () => string
  /** Resolves the stored bearer key. */
  apiKey: () => Promise<string>
  /** Every catalog route, picture models included. */
  routes: () => Promise<readonly NearTokenRoute[]>
  /** How long one generation may take before it is abandoned, in milliseconds. */
  timeoutMs: () => number
  /**
   * Poll cadence for a durable task: the first wait and the ceiling it backs
   * off to. Defaults to 3 s and 5 s; a test passes zeros to poll immediately.
   */
  poll?: () => { readonly firstMs: number; readonly maxMs: number }
  /** HTTP carrier; defaults to the process's own fetch. */
  fetch?: typeof fetch
}

/** One generated picture, with the route that drew it. */
export interface NearTokenGeneratedImage {
  readonly model: string
  readonly group: string
  readonly mediaType: ImageMediaType
  readonly bytes: Uint8Array
}

/** One generation once its channel, route, credential, and budget are resolved. */
interface ImageAttempt {
  readonly model: string
  readonly group: string
  readonly prompt: string
  readonly size?: string
  readonly quality?: string
  readonly background?: string
  readonly images?: readonly ImagePayload[]
  readonly channel: ImageChannel
  readonly route: NearTokenRoute | undefined
  readonly key: string
  readonly signal: AbortSignal
  readonly send: typeof fetch
  readonly timeoutMs: number
}
/**
 * Ask the site for one picture and return its bytes.
 *
 * The group matters as much as the model: the same model can be offered by
 * several groups at different prices, and the site routes by the group
 * reference header, so the caller names both.
 */
export class NearTokenImageClient {
  /**
   * @param deps - the site root, the key, the catalog, and the time budget.
   */
  constructor(private readonly deps: NearTokenImageDeps) {}

  /**
   * Generate one picture.
   * @param request - model, group, prompt, optional size, and the caller's cancellation.
   * @returns the encoded picture.
   * @throws {Error} when the site refuses the request or answers without a picture.
   */
  async generate(request: {
    readonly model: string
    readonly group: string
    readonly prompt: string
    readonly size?: string
    readonly quality?: string
    readonly background?: string
    /** Reference pictures, in the order the caller gave them. */
    readonly images?: readonly ImagePayload[]
    readonly signal?: AbortSignal
  }): Promise<NearTokenGeneratedImage> {
    const route = (await this.deps.routes())
      .find(entry => entry.model === request.model && entry.group === request.group)
    const channel = imageChannel(route?.endpoints)
    assertChannelParameters(channel, request)
    const timeoutMs = this.deps.timeoutMs()
    // The budget is its own signal so a timeout can be told apart from the
    // caller's cancellation: one deserves an explanation of how to wait longer,
    // the other is the turn being stopped and travels unchanged.
    const budget = AbortSignal.timeout(timeoutMs)
    const signal = request.signal === undefined ? budget : AbortSignal.any([request.signal, budget])
    const key = await this.deps.apiKey()
    const send = this.deps.fetch ?? fetch
    const image = await this.attempt({ ...request, channel, route, key, signal, send, timeoutMs }).catch((error: unknown) => {
      if (!budget.aborted) throw error
      throw new Error(
        `the site did not return an image within ${String(Math.round(timeoutMs / 1_000))}s`
        + ` (imageTimeoutMs); ${request.model} can be this slow — a submitted task keeps running on the site`
        + ' and is billed when it finishes, so raise imageTimeoutMs or enable a faster image model',
        { cause: error },
      )
    })
    return image
  }

  /**
   * One generation under the time budget: the channel decides whether the
   * picture comes back in the answer or has to be waited for, and both shapes
   * end as one picture reference.
   * @param request - the call, already resolved to a channel and group.
   * @returns the encoded picture.
   */
  private async attempt(request: ImageAttempt): Promise<NearTokenGeneratedImage> {
    const pictures = request.images ?? []
    // A reference picture is an edit, and the site has an edit surface of its
    // own: it checks that a picture was given, runs the edit-capable upstream
    // route, and (for a model a task plugin claims) polls the task inside the
    // request. Rides the generation submit only when there is no edit route.
    const reply = request.channel === 'images'
      ? pictures.length === 0
        ? await this.imagesReply(request, pictures)
        : await this.editReply(request, pictures)
      : await this.chatReply(request, pictures)
    if (reply === undefined) {
      throw new Error(`${request.model} answered without an image; the model may not generate pictures on this site`)
    }
    const bytes = reply.kind === 'base64'
      ? Uint8Array.from(Buffer.from(reply.data, 'base64'))
      : await this.download(reply.url, request.signal, request.send)
    const mediaType = sniffImageMediaType(bytes)
    if (mediaType === undefined) {
      throw new Error(`${request.model} returned ${String(bytes.byteLength)} bytes that are not a PNG/JPEG/WebP/GIF image`)
    }
    return { model: request.model, group: request.group, mediaType, bytes }
  }

  /** The headers every picture call carries; only the credential header is the channel's own. */
  private requestHeaders(request: ImageAttempt): Record<string, string> {
    return {
      ...attributionHeaders(),
      // An image tool call has no session, so it announces the client only.
      ...clientHeaders(),
      'content-type': 'application/json',
      // Gemini reads its own credential header; the compatible surfaces take
      // a bearer token.
      ...request.channel === 'genai'
        ? { 'x-goog-api-key': request.key }
        : { authorization: `Bearer ${request.key}` },
      ...request.route?.groupRef === undefined ? {} : { 'x-neartoken-group': request.route.groupRef },
    }
  }

  /** The headers a poll carries: the same credential, no routing decision left to make. */
  private pollHeaders(request: ImageAttempt): Record<string, string> {
    return {
      ...attributionHeaders(),
      ...clientHeaders(),
      authorization: `Bearer ${request.key}`,
    }
  }

  /**
   * The serialized body one channel sends.
   * @param request - the attempt.
   * @param pictures - reference pictures, already encoded.
   * @returns the JSON body.
   */
  private requestBody(request: ImageAttempt, pictures: readonly ImagePayload[]): string {
    return JSON.stringify(request.channel === 'images'
      ? {
        model: request.model,
        prompt: request.prompt,
        n: 1,
        ...request.size === undefined ? {} : { size: request.size },
        ...request.quality === undefined ? {} : { quality: request.quality },
        ...request.background === undefined ? {} : { background: request.background },
        // Only the fallback path gets here with pictures: the site's submit
        // route decodes a generate body, and `image` is the member a plugin
        // reads as "start from this". A site with an edit route never sends it.
        ...pictures.length === 0
          ? {}
          : { image: pictures.map(picture => `data:${picture.mediaType};base64,${picture.data}`) },
      }
      : request.channel === 'genai'
        ? {
          contents: [{
            role: 'user',
            parts: [
              { text: request.prompt },
              ...pictures.map(picture => ({ inlineData: { mimeType: picture.mediaType, data: picture.data } })),
            ],
          }],
        }
        : {
          model: request.model,
          messages: [{
            role: 'user',
            content: pictures.length === 0
              ? request.prompt
              : [
                { type: 'text', text: request.prompt },
                ...pictures.map(picture => ({
                  type: 'image_url',
                  image_url: { url: `data:${picture.mediaType};base64,${picture.data}` },
                })),
              ],
          }],
          stream: false,
        })
  }

  /**
   * The serialized body of an edit: what to change, and the pictures to change.
   *
   * `images` is the OpenAI Images edit member (a JSON body, so each picture is
   * a data URL rather than a file part); `size`, `quality`, and `background`
   * mean the same thing here as on a generation.
   * @param request - the attempt.
   * @param pictures - reference pictures, already encoded.
   * @returns the JSON body.
   */
  private editBody(request: ImageAttempt, pictures: readonly ImagePayload[]): string {
    return JSON.stringify({
      model: request.model,
      prompt: request.prompt,
      n: 1,
      ...request.size === undefined ? {} : { size: request.size },
      ...request.quality === undefined ? {} : { quality: request.quality },
      ...request.background === undefined ? {} : { background: request.background },
      images: pictures.map(picture => `data:${picture.mediaType};base64,${picture.data}`),
    })
  }

  /**
   * One refusal, carrying the status and the site's own words.
   * @param request - the attempt that was refused.
   * @param response - the site's answer.
   * @returns the error to throw.
   */
  private async refusal(request: ImageAttempt, response: Response): Promise<Error> {
    const detail = (await response.text()).slice(0, 400)
    return new Error(`the site refused ${request.model} with HTTP ${String(response.status)}: ${detail}`)
  }

  /**
   * The chat-shaped channels: one request that answers the picture.
   * @param request - the attempt.
   * @param pictures - reference pictures, already encoded.
   * @returns the picture reference, or undefined when the answer carries none.
   */
  private async chatReply(request: ImageAttempt, pictures: readonly ImagePayload[]): Promise<ImageReply | undefined> {
    const path = request.channel === 'genai'
      ? `/v1beta/models/${request.model}:generateContent`
      : '/v1/chat/completions'
    // A reference picture makes this body megabytes of base64, so it goes
    // through the same encoding layer as the chat wires (see request-body.ts).
    const response = await postJson(request.send, `${this.deps.baseURL()}${path}`, {
      headers: this.requestHeaders(request),
      json: this.requestBody(request, pictures),
      signal: request.signal,
    })
    if (!response.ok) throw await this.refusal(request, response)
    return extractImageReply(await response.json())
  }

  /**
   * The edit route: reference pictures on the surface the site checks for them.
   *
   * The answer is read the same way as a generation's — a picture now, or a
   * task id to poll when the model is one a task plugin claims — because the
   * route differs, not the currency of the reply.
   * @param request - the attempt.
   * @param pictures - reference pictures, already encoded; never empty here.
   * @returns the picture reference the answer carries.
   */
  private async editReply(request: ImageAttempt, pictures: readonly ImagePayload[]): Promise<ImageReply | undefined> {
    const response = await postJson(request.send, `${this.deps.baseURL()}${EDITS_PATH}`, {
      headers: this.requestHeaders(request),
      json: this.editBody(request, pictures),
      signal: request.signal,
    })
    // A site that predates the route (404/405) or only takes a multipart edit
    // body (415) cannot serve this request, and no generation was billed: the
    // same pictures ride the generation submit instead.
    if (EDIT_UNSUPPORTED_STATUS.has(response.status)) {
      await response.body?.cancel().catch(() => {})
      return this.imagesReply(request, pictures)
    }
    if (!response.ok) throw await this.refusal(request, response)
    const body: unknown = await response.json()
    const taskId = taskIdOf(body)
    if (taskId === undefined) return extractImageReply(body)
    return this.settleTask(request, taskId)
  }

  /**
   * The `images` channel: a durable task when the site runs one, the picture
   * itself when it does not.
   *
   * Which of the two an answer is, is the answer's own business — a task id
   * means polling, `data[]` means the picture is already here, and a 404 means
   * this site predates the task endpoint. Choosing by configuration would break
   * the moment the site ships or drops a task plugin.
   * @param request - the attempt.
   * @param pictures - reference pictures, already encoded.
   * @returns the picture reference the answer carries.
   */
  private async imagesReply(request: ImageAttempt, pictures: readonly ImagePayload[]): Promise<ImageReply | undefined> {
    const submitted = await postJson(request.send, `${this.deps.baseURL()}${TASKS_PATH}`, {
      headers: this.requestHeaders(request),
      json: this.requestBody(request, pictures),
      signal: request.signal,
    })
    // A site too old to know the task endpoint answers 404: the same body goes
    // once to the route this plugin used before.
    if (submitted.status === 404) {
      await submitted.body?.cancel().catch(() => {})
      return this.syncImagesReply(request, pictures)
    }
    if (!submitted.ok) throw await this.refusal(request, submitted)
    const body: unknown = await submitted.json()
    const taskId = taskIdOf(body)
    // Nothing claims the model as a task, so the site answered the picture
    // synchronously on this same endpoint.
    if (taskId === undefined) return extractImageReply(body)
    return this.settleTask(request, taskId)
  }

  /**
   * The synchronous images route, for a site that answers 404 on submit.
   * @param request - the attempt.
   * @param pictures - reference pictures, already encoded.
   * @returns the picture reference the answer carries.
   */
  private async syncImagesReply(request: ImageAttempt, pictures: readonly ImagePayload[]): Promise<ImageReply | undefined> {
    const response = await postJson(request.send, `${this.deps.baseURL()}${GENERATIONS_PATH}`, {
      headers: this.requestHeaders(request),
      json: this.requestBody(request, pictures),
      signal: request.signal,
    })
    if (!response.ok) throw await this.refusal(request, response)
    return extractImageReply(await response.json())
  }

  /**
   * Poll one submitted task until the site reports a terminal state.
   *
   * Polling is the only retry: a transient gateway failure or a dropped
   * connection re-reads the same task, so a flaky link never submits — and
   * bills — a second generation. The caller's budget is the exit; once it
   * fires the task keeps running on the site and is billed when it finishes.
   * @param request - the attempt that submitted the task.
   * @param taskId - the id the submit answer carried.
   * @returns the picture reference the finished task carries.
   * @throws {Error} when the task fails, disappears, or the budget runs out.
   */
  private async settleTask(request: ImageAttempt, taskId: string): Promise<ImageReply | undefined> {
    const poll = this.deps.poll?.() ?? { firstMs: POLL_FIRST_MS, maxMs: POLL_MAX_MS }
    const url = `${this.deps.baseURL()}${TASKS_PATH}/${encodeURIComponent(taskId)}`
    let waitMs = poll.firstMs
    for (;;) {
      // The submit answer is not a result, so the first read waits one interval.
      await waitFor(waitMs, request.signal)
      waitMs = Math.min(poll.maxMs, waitMs + POLL_STEP_MS)
      let response: Response
      try {
        response = await request.send(url, { headers: this.pollHeaders(request), signal: request.signal })
      } catch (error) {
        // A dropped poll says nothing about the task: keep reading it.
        if (request.signal.aborted) throw error
        continue
      }
      if (response.status === 404) {
        throw new Error(
          `the site no longer has task ${taskId} (HTTP 404): its result expired or the account changed; submit again`,
        )
      }
      if (!response.ok) {
        if (!TRANSIENT_STATUS.has(response.status) || request.signal.aborted) {
          throw await this.refusal(request, response)
        }
        await response.body?.cancel().catch(() => {})
        continue
      }
      const body: unknown = await response.json()
      const status = taskStatusOf(body)
      if (status === 'SUCCESS') return extractImageReply(body)
      if (status === 'FAILURE') {
        throw new Error(`the site reported task ${taskId} as FAILURE: ${taskFailureReason(body)}`)
      }
      // SUBMITTED / QUEUED / IN_PROGRESS / UNKNOWN: still working.
    }
  }

  /**
   * Fetch a generated picture from the short-lived URL some gateways answer with.
   * @param url - the site's result URL.
   * @param signal - the generation's cancellation and time budget.
   * @param send - the HTTP carrier the request used.
   * @returns the encoded picture.
   * @throws {Error} when the URL cannot be read.
   */
  private async download(url: string, signal: AbortSignal, send: typeof fetch): Promise<Uint8Array> {
    const response = await send(url, { signal })
    if (!response.ok) throw new Error(`the generated image URL answered HTTP ${String(response.status)}`)
    return new Uint8Array(await response.arrayBuffer())
  }
}

/**
 * The task id an answer carries, when it carries one.
 * @param body - the parsed answer.
 * @returns the id, or undefined when this was not a task answer.
 */
function taskIdOf(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const id = (body as Record<string, unknown>).task_id
  return typeof id === 'string' && id.length > 0 ? id : undefined
}

/**
 * The task state one answer carries, upper-cased.
 * @param body - the parsed answer.
 * @returns the state, or an empty string when the answer names none.
 */
function taskStatusOf(body: unknown): string {
  if (typeof body !== 'object' || body === null) return ''
  const status = (body as Record<string, unknown>).status
  return typeof status === 'string' ? status.toUpperCase() : ''
}

/**
 * Why the site reported a task as failed.
 * @param body - the parsed task answer.
 * @returns the site's own reason, or a generic one when it gave none.
 */
function taskFailureReason(body: unknown): string {
  const record = typeof body === 'object' && body !== null ? body as Record<string, unknown> : {}
  const error = record.error
  const detail = typeof error === 'object' && error !== null
    ? (error as Record<string, unknown>).message
    : undefined
  const reason = typeof record.fail_reason === 'string' && record.fail_reason.length > 0
    ? record.fail_reason
    : typeof detail === 'string' && detail.length > 0 ? detail : undefined
  return (reason ?? 'image generation failed').slice(0, 400)
}

/**
 * Wait one poll interval, ending early when the generation is cancelled.
 * @param ms - how long to wait; the tests pass zero to poll without waiting.
 * @param signal - the generation's cancellation and time budget.
 */
async function waitFor(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new Error('the image generation was cancelled')
  }
  if (ms <= 0) return
  await new Promise<void>((resolve, reject) => {
    const done = (): void => {
      clearTimeout(timer)
      signal.removeEventListener('abort', cancel)
    }
    const cancel = (): void => {
      done()
      reject(signal.reason instanceof Error ? signal.reason : new Error('the image generation was cancelled'))
    }
    const timer = setTimeout(() => {
      done()
      resolve()
    }, ms)
    signal.addEventListener('abort', cancel, { once: true })
  })
}

