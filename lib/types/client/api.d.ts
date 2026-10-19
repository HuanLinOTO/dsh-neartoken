import type { BeginAuthorizationOutcome, NearTokenModelsState, NearTokenStatus } from '../protocol.ts';
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
    /** Forget the stored key and revoke it on the site. */
    signOut(): Promise<void>;
    /** Read the site's model catalog beside the stored whitelist. */
    models(): Promise<NearTokenModelsState>;
    /** Save a whitelist; an empty list shows every model again. */
    saveModels(enabled: readonly string[]): Promise<void>;
}
/**
 * Build the carrier.
 * @param fetcher - HTTP carrier; defaults to the page's own fetch.
 * @returns the section's four calls.
 */
export declare function createNearTokenApi(fetcher?: Fetch): NearTokenApi;
