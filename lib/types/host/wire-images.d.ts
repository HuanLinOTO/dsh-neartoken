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
/** The slice of the attachment service this module reads. */
export interface ImageSource {
    /**
     * Read one stored image back.
     * @param attachment - the durable reference carried by the message.
     * @param signal - the request's cancellation.
     * @returns the stored bytes beside their reference.
     */
    readImage(attachment: {
        attachmentId: string;
        mediaType: string;
        bytes: number;
        width: number;
        height: number;
    }, signal?: AbortSignal): Promise<{
        data: Uint8Array;
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
 * @returns attachment id to base64 image; empty when the request carries none.
 * @throws {LlmError} when a message carries an image that cannot be inlined.
 */
export declare function inlineImages(attachments: ImageSource | undefined, messages: readonly RequestMessage[], signal?: AbortSignal): Promise<WireImages>;
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
