import type { Context } from '@deepseek-ai/cordis';
import type { ImageMediaType } from '@deepseek-ai/dsh-attachment';
import type { NearTokenImageClient } from './images.ts';
/** External facts the tool reads at call time. */
export interface ImageToolDeps {
    /** The stored setting: whether the tool is on, and each enabled model's group. */
    settings: () => {
        readonly enabled: boolean;
        readonly models: Readonly<Record<string, string>>;
    };
    /** The generation client shared with the rest of the plugin. */
    client: NearTokenImageClient;
    /** How long one generation may take, in milliseconds; also sizes the tool deadline. */
    timeoutMs: () => number;
}
/**
 * Choose the model and group one call uses.
 * @param selection - the enabled models and their groups.
 * @param requested - the model the caller named, when it named one.
 * @returns the model and group to call.
 * @throws {Error} when nothing is enabled, or the named model is not among them.
 */
export declare function resolveImageModel(selection: Readonly<Record<string, string>>, requested?: string): {
    model: string;
    group: string;
};
/** The structured outcome declared by the `generate_image` output schema. */
export interface GeneratedImageValue {
    /** Bare model name that drew the picture. */
    model: string;
    /** Group the request routed through. */
    group: string;
    image: {
        attachmentId: string;
        mediaType: ImageMediaType;
        bytes: number;
        width: number;
        height: number;
        name: string;
    };
    /** Where the picture was also written, when the caller named a path. */
    path?: string;
}
/**
 * Format a generated picture as the model-facing envelope beside its image block.
 * @param value - the generated image outcome.
 * @returns the model-facing envelope; the picture itself rides the adjacent image block.
 */
export declare function formatGenerateImageOutput(value: GeneratedImageValue): string;
/**
 * Register the `generate_image` tool.
 * @param ctx - a context carrying `tools` and `attachments`.
 * @param deps - the stored setting and the generation client.
 * @returns the registration's disposer.
 */
export declare function registerGenerateImageTool(ctx: Context, deps: ImageToolDeps): () => void;
