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

/** The slice of the attachment service this module reads. */
export interface ImageSource {
  /**
   * Read one stored image back.
   * @param attachment - the durable reference carried by the message.
   * @param signal - the request's cancellation.
   * @returns the stored bytes beside their reference.
   */
  readImage(
    attachment: { attachmentId: string; mediaType: string; bytes: number; width: number; height: number },
    signal?: AbortSignal,
  ): Promise<{ data: Uint8Array }>
}

/**
 * Collect the image references inside one block list.
 *
 * A tool result carries its own blocks (`tool-result.content`), and a picture a
 * tool handed back lives there rather than at the top level of the message: the
 * `read_image` tool answers with exactly that shape. Descent stops at two levels
 * because that is the deepest a harness content block nests.
 * @param blocks - one message's or one tool result's blocks.
 * @param into - the list the references are appended to.
 */
function collectImages(
  blocks: readonly unknown[],
  into: { attachmentId: string; mediaType: string; bytes: number; width: number; height: number }[],
): void {
  for (const block of blocks) {
    if (typeof block !== 'object' || block === null) continue
    const candidate = block as {
      type?: string
      attachment?: typeof into[number]
      content?: readonly unknown[]
    }
    if (candidate.type === 'image' && candidate.attachment !== undefined) {
      into.push(candidate.attachment)
      continue
    }
    if (candidate.type === 'tool-result' && Array.isArray(candidate.content)) {
      collectImages(candidate.content, into)
    }
  }
}

/** One block list's images, in message order. Callers own the inlined map. */
export function imagesIn(content: readonly unknown[], images: WireImages): WireImage[] {
  const found: WireImage[] = []
  for (const block of content) {
    if (typeof block !== 'object' || block === null) continue
    const candidate = block as { type?: string; content?: readonly unknown[] }
    if (candidate.type === 'image') {
      const image = imageOf(block, images)
      if (image !== undefined) found.push(image)
      continue
    }
    if (candidate.type === 'tool-result' && Array.isArray(candidate.content)) {
      found.push(...imagesIn(candidate.content, images))
    }
  }
  return found
}

/**
 * Collect every image a request's messages carry, inlined for the wires.
 * @param attachments - the attachment service, when the composition has one.
 * @param messages - the request's conversation messages.
 * @param signal - the request's cancellation.
 * @returns attachment id to base64 image; empty when the request carries none.
 * @throws {LlmError} when a message carries an image that cannot be inlined.
 */
export async function inlineImages(
  attachments: ImageSource | undefined,
  messages: readonly RequestMessage[],
  signal?: AbortSignal,
): Promise<WireImages> {
  const references: { attachmentId: string; mediaType: string; bytes: number; width: number; height: number }[] = []
  for (const message of messages) collectImages(message.content as readonly unknown[], references)
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
    let data: Uint8Array
    try {
      data = (await attachments.readImage(reference, signal)).data
    } catch (error: unknown) {
      throw new LlmError(
        `cannot read attachment "${id}" for this request: ${error instanceof Error ? error.message : String(error)}`,
        'ATTACHMENT_UNREADABLE',
      )
    }
    images.set(id, { mediaType: reference.mediaType, data: Buffer.from(data).toString('base64') })
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
  const candidate = block as { type?: string; attachment?: { attachmentId?: unknown } }
  if (candidate.type !== 'image' || candidate.attachment?.attachmentId === undefined) return undefined
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
