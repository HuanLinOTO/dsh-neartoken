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
 * text embeds the picture. All paths end here as encoded bytes, which is what a
 * tool result can carry.
 *
 * @module
 */
import type { ImageMediaType } from '@deepseek-ai/dsh-attachment';
import type { NearTokenRoute } from './pricing.ts';
/** How one image model is asked for a picture. */
export type ImageChannel = 'images' | 'genai' | 'chat';
/**
 * Whether a catalog route is a picture generator.
 * @param model - the bare model name.
 * @param endpoints - the surfaces the site declares for it, when it declares any.
 * @returns true when the model generates pictures.
 */
export declare function isImageModel(model: string, endpoints?: readonly string[]): boolean;
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
export declare function imageChannel(endpoints?: readonly string[]): ImageChannel;
/** One reference picture, in the form every channel can encode for itself. */
export interface ImagePayload {
    /** Media type the bytes were verified as. */
    readonly mediaType: string;
    /** Base64 payload without a data-URL prefix. */
    readonly data: string;
}
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
    /** Origin of the model-facing endpoints (`/v1` and Gemini's `/v1beta`), without a trailing slash. */
    baseURL: () => string;
    /** Resolves the stored bearer key. */
    apiKey: () => Promise<string>;
    /** Every catalog route, picture models included. */
    routes: () => Promise<readonly NearTokenRoute[]>;
    /** How long one generation may take before it is abandoned, in milliseconds. */
    timeoutMs: () => number;
    /**
     * Poll cadence for a durable task: the first wait and the ceiling it backs
     * off to. Defaults to 3 s and 5 s; a test passes zeros to poll immediately.
     */
    poll?: () => {
        readonly firstMs: number;
        readonly maxMs: number;
    };
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
        readonly quality?: string;
        readonly background?: string;
        /** Reference pictures, in the order the caller gave them. */
        readonly images?: readonly ImagePayload[];
        readonly signal?: AbortSignal;
    }): Promise<NearTokenGeneratedImage>;
    /**
     * One generation under the time budget: the channel decides whether the
     * picture comes back in the answer or has to be waited for, and both shapes
     * end as one picture reference.
     * @param request - the call, already resolved to a channel and group.
     * @returns the encoded picture.
     */
    private attempt;
    /** The headers every picture call carries; only the credential header is the channel's own. */
    private requestHeaders;
    /** The headers a poll carries: the same credential, no routing decision left to make. */
    private pollHeaders;
    /**
     * The serialized body one channel sends.
     * @param request - the attempt.
     * @param pictures - reference pictures, already encoded.
     * @returns the JSON body.
     */
    private requestBody;
    /**
     * One refusal, carrying the status and the site's own words.
     * @param request - the attempt that was refused.
     * @param response - the site's answer.
     * @returns the error to throw.
     */
    private refusal;
    /**
     * The chat-shaped channels: one request that answers the picture.
     * @param request - the attempt.
     * @param pictures - reference pictures, already encoded.
     * @returns the picture reference, or undefined when the answer carries none.
     */
    private chatReply;
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
    private imagesReply;
    /**
     * The synchronous images route, for a site that answers 404 on submit.
     * @param request - the attempt.
     * @param pictures - reference pictures, already encoded.
     * @returns the picture reference the answer carries.
     */
    private syncImagesReply;
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
    private settleTask;
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
