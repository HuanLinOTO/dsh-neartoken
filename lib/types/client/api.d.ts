import type { BeginAuthorizationOutcome, NearTokenImagesPatch, NearTokenImagesState, NearTokenModelsState, NearTokenStatus, NearTokenTopupInfo } from '../protocol.ts';
/**
 * A top-up call the Host refused, carrying its stable code so the page can tell
 * "this key is not a device key, reconnect" from "the site said no".
 */
export declare class NearTokenTopupRefusal extends Error {
    /** The Host's stable refusal code, such as not-dsh. */
    readonly code: string;
    /**
     * @param code - the Host's refusal code.
     * @param message - the wording to show.
     */
    constructor(code: string, message: string);
}
/** The HTTP carrier, injectable so the section's behavior is testable. */
export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
/** What the section calls. */
export interface NearTokenApi {
    /** Read the key state, the account card, and any authorization in progress. */
    status(): Promise<NearTokenStatus>;
    /**
     * Re-read the wallet now and answer with the fresh state. The Host already
     * refreshes on its own cadence; this asks for that read early, so the card
     * shows money facts newer than the last poll.
     */
    refreshAccount(): Promise<NearTokenStatus>;
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
    /**
     * Save a whitelist; an empty list shows every model again. The meta
     * overrides are stored only when named, so the whitelist's own autosave
     * leaves them alone.
     */
    saveModels(enabled: readonly string[], meta?: Readonly<Record<string, import('../protocol.ts').NearTokenModelMeta>>): Promise<void>;
    /** Read the site's top-up offer, or be refused with a code the page acts on. */
    topupInfo(): Promise<NearTokenTopupInfo>;
    /**
     * Start one top-up order. The Host opens the site's checkout page in the
     * user's own browser, so this call only reports success.
     */
    startTopup(amount: number, paymentMethod: string): Promise<void>;
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
