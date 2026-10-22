import type { BeginAuthorizationOutcome, NearTokenImagesPatch, NearTokenImagesState, NearTokenModelsState, NearTokenStatus } from '../protocol.ts';
/** The HTTP carrier, injectable so the section's behavior is testable. */
export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
/** What the section calls. */
export interface NearTokenApi {
    /** Read the key state, the account card, and any authorization in progress. */
    status(): Promise<NearTokenStatus>;
    /** Start a device authorization; the Host polls the site from then on. */
    begin(): Promise<BeginAuthorizationOutcome>;
    /** Abandon the authorization in progress. */
    cancel(): Promise<void>;
    /**
     * Hand the pending confirmation page to the user's own browser. The page
     * cannot do that itself: a window it opens stays inside the shell hosting it.
     */
    openBrowser(): Promise<void>;
    /** Forget the stored key and revoke it on the site. */
    signOut(): Promise<void>;
    /** Read the site's model catalog beside the stored whitelist. */
    models(): Promise<NearTokenModelsState>;
    /** Save a whitelist; an empty list shows every model again. */
    saveModels(enabled: readonly string[]): Promise<void>;
    /** Read the picture models beside the stored image-generation setting. */
    images(): Promise<NearTokenImagesState>;
    /** Save the image-generation setting: the tool's switch and one group per enabled model. */
    saveImages(patch: NearTokenImagesPatch): Promise<void>;
}
/**
 * Build the carrier.
 * @param fetcher - HTTP carrier; defaults to the page's own fetch.
 * @returns the section's four calls.
 */
export declare function createNearTokenApi(fetcher?: Fetch): NearTokenApi;
