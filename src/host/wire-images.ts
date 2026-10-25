/**
 * Images inlined for one wire request.
 *
 * A harness message carries an image as a durable attachment reference, while
 * every upstream protocol wants the bytes themselves — base64 in the body or a
 * data URL. This module is the one place that reads them, so a wire never talks
 * to the attachment store and cannot silently drop a picture it does not
 * understand.
 *
 * Dropping was the previous behavior: the wires only flattened text blocks, so a
 * pasted screenshot reached the model as nothing at all. A missing service or an
 * unreadable attachment is now a failed request instead.
 *
 * @module
 */
import { LlmError } from '@deepseek-ai/dsh-llm'
import type { RequestMessage } from '@deepseek-ai/dsh-llm'

/** One image ready for a wire: base64 payload plus its media type. */
export interface WireImage {
  /** Media type the stored bytes were verified as. */
  readonly mediaType: string
  /** Canonical base64 of the image bytes, without a data-URL prefix. */
  readonly data: string
}

/** Attachment id to the inlined image, for one request. */
export type WireImages = ReadonlyMap<string, WireImage>

/** One durable image reference, as a message block carries it. */
export interface ImageReference {
  readonly attachmentId: string
  readonly mediaType: string
  readonly bytes: number
  readonly width: number
  readonly height: number
}

/** Bounds one request image is encoded to before any wire carries it. */
export interface ImageRequestPolicy {
  /** Longest edge in pixels; a larger image is scaled down to it and never up. */
  readonly maxEdge: number
  /** Encoded-byte ceiling for one image; the encoder keeps the smallest quality that fits. */
  readonly maxBytes: number
}

/**
 * Default request-image bounds.
 *
 * A model reads a picture through a fixed visual grid, so bytes past roughly
 * 2048 pixels on the long edge buy no detail while still costing upload time and
 * base64 in the prompt. 2 MiB is the ceiling the harness's own DeepSeek routes
 * use for one encoded request image.
 */
export const DEFAULT_IMAGE_REQUEST_POLICY: ImageRequestPolicy = { maxEdge: 2048, maxBytes: 2 * 1024 * 1024 }

/** The slice of the attachment service this module reads. */
export interface ImageSource {
  /**
   * Read one stored image back.
   * @param attachment - the durable reference carried by the message.
   * @param signal - the request's cancellation.
   * @returns the stored bytes beside their reference.
   */
  readImage(
    attachment: ImageReference,
    signal?: AbortSignal,
  ): Promise<{ data: Uint8Array }>

  /**
   * Derive the request version of one stored image: scaled within the target and
   * re-encoded under its byte ceiling. A store that cannot derive one rejects
   * with code `ATTACHMENT_PROJECTION_UNSUPPORTED`, and the caller sends the
   * normalized original instead.
   * @param attachment - the durable reference carried by the message.
   * @param target - integer dimensions and encoded-byte ceiling for this request.
   * @param signal - the request's cancellation.
   * @returns the request bytes and the media type they were encoded as.
   */
  readImageRequest?(
    attachment: ImageReference,
    target: { width: number; height: number; maxBytes: number },
    signal?: AbortSignal,
  ): Promise<{ data: Uint8Array; mediaType: string }>
}

/**
 * The images one block list carries, in message order.
 *
 * Message content is flat: a tool result keeps the blocks its tool rendered (a
 * `read_image` result is a text envelope beside its image), so a picture a tool
 * handed back sits at the top level exactly like a pasted screenshot.
 * @param content - one message's content blocks.
 * @param images - the request's inlined images.
 * @returns every image in the list that carries inlined bytes, in order.
 */
export function imagesIn(content: readonly unknown[], images: WireImages): WireImage[] {
  const found: WireImage[] = []
  for (const block of content) {
    const image = imageOf(block, images)
    if (image !== undefined) found.push(image)
  }
  return found
}

/**
 * The request dimensions one stored image is projected onto.
 *
 * The long edge is what a visual encoder resamples by, so the short edge follows
 * it. An image already inside the bound keeps its own dimensions and the store
 * then decides from the byte ceiling whether it has to encode anything at all.
 * @param reference - the stored image's intrinsic dimensions.
 * @param policy - the configured bounds.
 * @returns integer dimensions no larger than the source, plus the byte ceiling.
 */
function requestTargetOf(
  reference: ImageReference,
  policy: ImageRequestPolicy,
): { width: number; height: number; maxBytes: number } {
  const longEdge = Math.max(reference.width, reference.height)
  if (longEdge <= policy.maxEdge) {
    return { width: reference.width, height: reference.height, maxBytes: policy.maxBytes }
  }
  const scale = policy.maxEdge / longEdge
  return {
    width: Math.max(1, Math.floor(reference.width * scale)),
    height: Math.max(1, Math.floor(reference.height * scale)),
    maxBytes: policy.maxBytes,
  }
}

/**
 * Whether a store refused request-image projection itself.
 * @param error - value caught from `readImageRequest`.
 * @returns true for the attachment service's documented unsupported code.
 */
function isProjectionUnsupported(error: unknown): boolean {
  return typeof error === 'object' && error !== null
    && (error as { code?: unknown }).code === 'ATTACHMENT_PROJECTION_UNSUPPORTED'
}

/**
 * Read one image as the bytes this request should carry.
 *
 * The request version is preferred: the store downscales and re-encodes it
 * within the target, so a 4K screenshot does not travel as 8 MiB of base64. A
 * store without projection still has the normalized original, which is sent
 * unchanged rather than failing the request.
 * @param source - the attachment service.
 * @param reference - the durable reference carried by the message.
 * @param policy - the configured bounds.
 * @param signal - the request's cancellation.
 * @returns the bytes to inline and the media type they are.
 * @throws {LlmError} when the bytes cannot be read at all.
 */
async function requestBytes(
  source: ImageSource,
  reference: ImageReference,
  policy: ImageRequestPolicy,
  signal?: AbortSignal,
): Promise<{ data: Uint8Array; mediaType: string }> {
  try {
    if (source.readImageRequest !== undefined) {
      try {
        const version = await source.readImageRequest(reference, requestTargetOf(reference, policy), signal)
        return { data: version.data, mediaType: version.mediaType }
      } catch (error: unknown) {
        // Only a store that cannot project is worth degrading: any other failure
        // is a real one and must stay visible.
        if (!isProjectionUnsupported(error)) throw error
      }
    }
    const stored = await source.readImage(reference, signal)
    return { data: stored.data, mediaType: reference.mediaType }
  } catch (error: unknown) {
    throw new LlmError(
      `cannot read attachment "${reference.attachmentId}" for this request: ${error instanceof Error ? error.message : String(error)}`,
      'ATTACHMENT_UNREADABLE',
    )
  }
}

/**
 * Collect every image a request's messages carry, inlined for the wires.
 * @param attachments - the attachment service, when the composition has one.
 * @param messages - the request's conversation messages.
 * @param signal - the request's cancellation.
 * @param policy - the request-image bounds every picture is encoded to.
 * @returns attachment id to base64 image; empty when the request carries none.
 * @throws {LlmError} when a message carries an image that cannot be inlined.
 */
export async function inlineImages(
  attachments: ImageSource | undefined,
  messages: readonly RequestMessage[],
  signal?: AbortSignal,
  policy: ImageRequestPolicy = DEFAULT_IMAGE_REQUEST_POLICY,
): Promise<WireImages> {
  const references: ImageReference[] = []
  for (const message of messages) {
    for (const block of message.content as readonly unknown[]) {
      if (typeof block !== 'object' || block === null) continue
      const candidate = block as { type?: string; attachment?: ImageReference; offloaded?: true }
      // An offloaded occurrence is the durable decision to send placeholder text
      // for it, so its bytes are never read back for a request.
      if (candidate.type !== 'image' || candidate.attachment === undefined) continue
      if (candidate.offloaded === true) continue
      references.push(candidate.attachment)
    }
  }
  if (references.length === 0) return new Map()
  if (attachments === undefined) {
    throw new LlmError(
      'this request carries an image but no attachment service is mounted, so the bytes cannot be read',
      'ATTACHMENTS_UNAVAILABLE',
    )
  }
  const images = new Map<string, WireImage>()
  for (const reference of references) {
    const id = String(reference.attachmentId)
    if (images.has(id)) continue
    const bytes = await requestBytes(attachments, reference, policy, signal)
    images.set(id, { mediaType: bytes.mediaType, data: Buffer.from(bytes.data).toString('base64') })
  }
  return images
}

/**
 * Find the inlined bytes behind one message block.
 * @param block - one content block, of any type.
 * @param images - the request's inlined images.
 * @returns the image, or undefined when the block is not an inlined image.
 */
export function imageOf(block: unknown, images: WireImages): WireImage | undefined {
  if (typeof block !== 'object' || block === null) return undefined
  const candidate = block as { type?: string; attachment?: { attachmentId?: unknown }; offloaded?: true }
  if (candidate.type !== 'image' || candidate.attachment?.attachmentId === undefined) return undefined
  if (candidate.offloaded === true) return undefined
  return images.get(String(candidate.attachment.attachmentId))
}

/**
 * Render one image as the data URL every HTTP-shaped wire accepts.
 * @param image - the inlined image.
 * @returns the data URL.
 */
export function dataUrlOf(image: WireImage): string {
  return `data:${image.mediaType};base64,${image.data}`
}
