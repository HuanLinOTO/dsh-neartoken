import type { RequestMessage } from '@deepseek-ai/dsh-llm';
/** One image ready for a wire: base64 payload plus its media type. */
export interface WireImage {
    /** Media type the stored bytes were verified as. */
    readonly mediaType: string;
    /** Canonical base64 of the image bytes, without a data-URL prefix. */
    readonly data: string;
}
/** Attachment id to the inlined image, for one request. */
export type WireImages = ReadonlyMap<string, WireImage>;
/** One durable image reference, as a message block carries it. */
export interface ImageReference {
    readonly attachmentId: string;
    readonly mediaType: string;
    readonly bytes: number;
    readonly width: number;
    readonly height: number;
}
/** Bounds one request image is encoded to before any wire carries it. */
export interface ImageRequestPolicy {
    /** Longest edge in pixels; a larger image is scaled down to it and never up. */
    readonly maxEdge: number;
    /** Encoded-byte ceiling for one image; the encoder keeps the smallest quality that fits. */
    readonly maxBytes: number;
}
/**
 * Default request-image bounds.
 *
 * A model reads a picture through a fixed visual grid, so bytes past roughly
 * 2048 pixels on the long edge buy no detail while still costing upload time and
 * base64 in the prompt. 2 MiB is the ceiling the harness's own DeepSeek routes
 * use for one encoded request image.
 */
export declare const DEFAULT_IMAGE_REQUEST_POLICY: ImageRequestPolicy;
/** The slice of the attachment service this module reads. */
export interface ImageSource {
    /**
     * Read one stored image back.
     * @param attachment - the durable reference carried by the message.
     * @param signal - the request's cancellation.
     * @returns the stored bytes beside their reference.
     */
    readImage(attachment: ImageReference, signal?: AbortSignal): Promise<{
        data: Uint8Array;
    }>;
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
    readImageRequest?(attachment: ImageReference, target: {
        width: number;
        height: number;
        maxBytes: number;
    }, signal?: AbortSignal): Promise<{
        data: Uint8Array;
        mediaType: string;
    }>;
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
export declare function imagesIn(content: readonly unknown[], images: WireImages): WireImage[];
/**
 * Collect every image a request's messages carry, inlined for the wires.
 * @param attachments - the attachment service, when the composition has one.
 * @param messages - the request's conversation messages.
 * @param signal - the request's cancellation.
 * @param policy - the request-image bounds every picture is encoded to.
 * @returns attachment id to base64 image; empty when the request carries none.
 * @throws {LlmError} when a message carries an image that cannot be inlined.
 */
export declare function inlineImages(attachments: ImageSource | undefined, messages: readonly RequestMessage[], signal?: AbortSignal, policy?: ImageRequestPolicy): Promise<WireImages>;
/**
 * Find the inlined bytes behind one message block.
 * @param block - one content block, of any type.
 * @param images - the request's inlined images.
 * @returns the image, or undefined when the block is not an inlined image.
 */
export declare function imageOf(block: unknown, images: WireImages): WireImage | undefined;
/**
 * Render one image as the data URL every HTTP-shaped wire accepts.
 * @param image - the inlined image.
 * @returns the data URL.
 */
export declare function dataUrlOf(image: WireImage): string;
