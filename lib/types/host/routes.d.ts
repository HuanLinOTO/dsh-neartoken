/**
 * The settings page's HTTP carrier: four same-origin endpoints the `NearToken`
 * section calls, because a plugin cannot extend the application's Remote
 * namespaces and the browser cannot reach the site directly (CORS).
 *
 * Every route asks the composition's `connection` service for a rejection
 * first — the same Host/Origin fence the application's own routes use — so no
 * other page can start an authorization in the user's name.
 *
 * @module
 */
import type { Context } from '@deepseek-ai/cordis';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { NearTokenImagesState, NearTokenModelMeta, NearTokenModelsState } from '../protocol.ts';
import type { NearTokenAccount } from './account.ts';
import type { JsonObject } from './new-api.ts';
/** What the routes need from the plugin. */
export interface NearTokenRouteDeps {
    /** The account the authorization and the stored key live on. */
    account: NearTokenAccount;
    /** Runs after the stored key was removed, so the provider route can unmount. */
    onDisconnect: () => void;
    /**
     * Open one address in the user's own browser.
     * @param address - the pending confirmation page.
     */
    openInBrowser: (address: string) => Promise<void>;
    /** The site's catalog beside the stored whitelist. */
    models: () => Promise<NearTokenModelsState>;
    /**
     * Persist a whitelist, and the meta overrides when the save names them.
     * @param enabled - model names to keep visible; an empty list restores the whole catalog.
     * @param meta - the complete per-model overrides; absent keeps the stored ones.
     */
    saveModels: (enabled: readonly string[], meta: Readonly<Record<string, NearTokenModelMeta>> | undefined) => Promise<void>;
    /** The picture models beside the stored image-generation setting. */
    images: () => Promise<NearTokenImagesState>;
    /**
     * Persist the image-generation setting.
     * @param body - the raw request body, validated against the current catalog.
     * @returns a refusal message, or nothing once the setting was stored.
     */
    saveImages: (body: unknown) => Promise<{
        readonly message: string;
    } | undefined>;
}
/**
 * @param ctx - a context that carries `webServer`.
 * @param deps - the account and the disconnect callback.
 */
export declare function registerNearTokenRoutes(ctx: Context, deps: NearTokenRouteDeps): void;
/**
 * Collect a bounded JSON object request body.
 * @param req - the request to read.
 * @param res - the response to answer on when the body is unusable.
 * @param limit - largest accepted body, in bytes.
 * @returns the parsed object, or undefined once a refusal was sent.
 */
export declare function readJsonObject(req: IncomingMessage, res: ServerResponse, limit?: number): Promise<JsonObject | undefined>;
