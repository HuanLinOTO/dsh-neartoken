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
import type { ImageMediaType } from '@deepseek-ai/dsh-attachment';
import type { NearTokenRoute } from './pricing.ts';
/** How one image model is asked for a picture. */
export type ImageChannel = 'images' | 'chat';
/**
 * Whether a catalog route is a picture generator.
 * @param model - the bare model name.
 * @param endpoints - the surfaces the site declares for it, when it declares any.
 * @returns true when the model generates pictures.
 */
export declare function isImageModel(model: string, endpoints?: readonly string[]): boolean;
/**
 * Which request shape one image model speaks.
 * @param endpoints - the surfaces the site declares for the model.
 * @returns `images` for a model the catalog marks `image-generation`, `chat` otherwise.
 */
export declare function imageChannel(endpoints?: readonly string[]): ImageChannel;
/** One picture the site answered with, before its bytes exist. */
export type ImageReply = {
    readonly kind: 'base64';
    readonly data: string;
} | {
    readonly kind: 'url';
    readonly url: string;
};
/**
 * Read a gateway's answer as one picture, whatever shape that gateway used.
 * @param body - the parsed JSON answer.
 * @returns the picture reference, or undefined when the answer carries none.
 */
export declare function extractImageReply(body: unknown): ImageReply | undefined;
/**
 * Read an image's media type from its own bytes.
 * @param data - the encoded picture.
 * @returns the media type, or undefined when the bytes are not a supported image.
 */
export declare function sniffImageMediaType(data: Uint8Array): ImageMediaType | undefined;
/** External facts one generation reads at call time. */
export interface NearTokenImageDeps {
    /** Site root without a trailing slash. */
    baseURL: () => string;
    /** Resolves the stored bearer key. */
    apiKey: () => Promise<string>;
    /** Every catalog route, picture models included. */
    routes: () => Promise<readonly NearTokenRoute[]>;
    /** How long one generation may take before it is abandoned, in milliseconds. */
    timeoutMs: () => number;
    /** HTTP carrier; defaults to the process's own fetch. */
    fetch?: typeof fetch;
}
/** One generated picture, with the route that drew it. */
export interface NearTokenGeneratedImage {
    readonly model: string;
    readonly group: string;
    readonly mediaType: ImageMediaType;
    readonly bytes: Uint8Array;
}
/**
 * Ask the site for one picture and return its bytes.
 *
 * The group matters as much as the model: the same model can be offered by
 * several groups at different prices, and the site routes by the group
 * reference header, so the caller names both.
 */
export declare class NearTokenImageClient {
    private readonly deps;
    /**
     * @param deps - the site root, the key, the catalog, and the time budget.
     */
    constructor(deps: NearTokenImageDeps);
    /**
     * Generate one picture.
     * @param request - model, group, prompt, optional size, and the caller's cancellation.
     * @returns the encoded picture.
     * @throws {Error} when the site refuses the request or answers without a picture.
     */
    generate(request: {
        readonly model: string;
        readonly group: string;
        readonly prompt: string;
        readonly size?: string;
        readonly signal?: AbortSignal;
    }): Promise<NearTokenGeneratedImage>;
    /**
     * One request, one answer: the parts of a generation that the time budget wraps.
     * @param request - the call, already resolved to a channel and group.
     * @returns the encoded picture.
     */
    private attempt;
    /**
     * Fetch a generated picture from the short-lived URL some gateways answer with.
     * @param url - the site's result URL.
     * @param signal - the generation's cancellation and time budget.
     * @param send - the HTTP carrier the request used.
     * @returns the encoded picture.
     * @throws {Error} when the URL cannot be read.
     */
    private download;
}
