/**
 * Image generation over one New API deployment: the two request shapes its
 * image models accept and the two result envelopes they answer with.
 *
 * The site lists picture generators next to chat models, and they do not share
 * one API. A model the catalog marks `image-generation` answers
 * `POST /v1/images/generations` with either a base64 body or a short-lived URL;
 * the Gemini-shaped ones (nano-banana, `*-image`) answer a chat completion whose
 * text embeds the picture. Both paths end here as encoded bytes, which is what
 * a tool result can carry.
 *
 * @module
 */
import type { ImageMediaType } from '@deepseek-ai/dsh-attachment'
import { attributionHeaders } from '@deepseek-ai/dsh-llm'
import type { NearTokenRoute } from './pricing.ts'

/** Model names that generate pictures on this kind of site, in or out of the catalog's endpoint list. */
const IMAGE_NAME = /image|imagine|nano-banana|imagen|flux|seedream|dall-?e|midjourney|recraft|ideogram/i

/**
 * Media models that are not picture generators. A catalog shares one namespace,
 * so a speech or video route whose name mentions images still must not appear as
 * a picture model.
 */
const NON_IMAGE_NAME = /tts|transcri|\basr\b|speech|embed|rerank|veo|video|lyria|music|sora|whisper/i

/** How one image model is asked for a picture. */
export type ImageChannel = 'images' | 'chat'

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
 * @param endpoints - the surfaces the site declares for the model.
 * @returns `images` for a model the catalog marks `image-generation`, `chat` otherwise.
 */
export function imageChannel(endpoints?: readonly string[]): ImageChannel {
  return endpoints?.includes('image-generation') === true ? 'images' : 'chat'
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
  /** Site root without a trailing slash. */
  baseURL: () => string
  /** Resolves the stored bearer key. */
  apiKey: () => Promise<string>
  /** Every catalog route, picture models included. */
  routes: () => Promise<readonly NearTokenRoute[]>
  /** How long one generation may take before it is abandoned, in milliseconds. */
  timeoutMs: () => number
}

/** One generated picture, with the route that drew it. */
export interface NearTokenGeneratedImage {
  readonly model: string
  readonly group: string
  readonly mediaType: ImageMediaType
  readonly bytes: Uint8Array
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
    readonly signal?: AbortSignal
  }): Promise<NearTokenGeneratedImage> {
    const route = (await this.deps.routes())
      .find(entry => entry.model === request.model && entry.group === request.group)
    const channel = imageChannel(route?.endpoints)
    const signal = combineSignals(request.signal, this.deps.timeoutMs())
    const key = await this.deps.apiKey()
    const response = await fetch(
      `${this.deps.baseURL()}/v1/${channel === 'images' ? 'images/generations' : 'chat/completions'}`,
      {
        method: 'POST',
        headers: {
          ...attributionHeaders(),
          'content-type': 'application/json',
          authorization: `Bearer ${key}`,
          ...route?.groupRef === undefined ? {} : { 'x-neartoken-group': route.groupRef },
        },
        body: JSON.stringify(channel === 'images'
          ? {
            model: request.model,
            prompt: request.prompt,
            n: 1,
            ...request.size === undefined ? {} : { size: request.size },
          }
          : {
            model: request.model,
            messages: [{ role: 'user', content: request.prompt }],
            stream: false,
          }),
        signal,
      },
    )
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 400)
      throw new Error(`the site refused ${request.model} with HTTP ${String(response.status)}: ${detail}`)
    }
    const reply = extractImageReply(await response.json())
    if (reply === undefined) {
      throw new Error(`${request.model} answered without an image; the model may not generate pictures on this site`)
    }
    const bytes = reply.kind === 'base64'
      ? Uint8Array.from(Buffer.from(reply.data, 'base64'))
      : await this.download(reply.url, signal)
    const mediaType = sniffImageMediaType(bytes)
    if (mediaType === undefined) {
      throw new Error(`${request.model} returned ${String(bytes.byteLength)} bytes that are not a PNG/JPEG/WebP/GIF image`)
    }
    return { model: request.model, group: request.group, mediaType, bytes }
  }

  /**
   * Fetch a generated picture from the short-lived URL some gateways answer with.
   * @param url - the site's result URL.
   * @param signal - the generation's cancellation and time budget.
   * @returns the encoded picture.
   * @throws {Error} when the URL cannot be read.
   */
  private async download(url: string, signal: AbortSignal): Promise<Uint8Array> {
    const response = await fetch(url, { signal })
    if (!response.ok) throw new Error(`the generated image URL answered HTTP ${String(response.status)}`)
    return new Uint8Array(await response.arrayBuffer())
  }
}

/**
 * Bound one generation by both the caller's cancellation and its own time budget.
 * @param signal - the caller's cancellation, when it passed one.
 * @param timeoutMs - how long the generation may take.
 * @returns a signal that aborts on either.
 */
function combineSignals(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const budget = AbortSignal.timeout(timeoutMs)
  return signal === undefined ? budget : AbortSignal.any([signal, budget])
}
