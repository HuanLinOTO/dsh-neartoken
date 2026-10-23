/**
 * The browser half of the settings-page carrier: same-origin calls to the Host
 * routes declared in ../protocol.ts.
 *
 * @module
 */
import {
  AUTHORIZE_PATH, CANCEL_PATH, IMAGES_PATH, LOGOUT_PATH, MODELS_PATH, OPEN_PATH, REFRESH_PATH, STATUS_PATH,
} from '../protocol.ts'
import type {
  BeginAuthorizationOutcome, NearTokenImagesPatch, NearTokenImagesState, NearTokenModelsPatch,
  NearTokenModelsState, NearTokenStatus,
} from '../protocol.ts'

/** The HTTP carrier, injectable so the section's behavior is testable. */
export type Fetch = (input: string, init?: RequestInit) => Promise<Response>

/** What the section calls. */
export interface NearTokenApi {
  /** Read the key state, the account card, and any authorization in progress. */
  status(): Promise<NearTokenStatus>
  /**
   * Re-read the wallet now and answer with the fresh state. The Host already
   * refreshes on its own cadence; this asks for that read early, so the card
   * shows money facts newer than the last poll.
   */
  refreshAccount(): Promise<NearTokenStatus>
  /** Start a device authorization; the Host polls the site from then on. */
  begin(): Promise<BeginAuthorizationOutcome>
  /** Abandon the authorization in progress. */
  cancel(): Promise<void>
  /**
   * Hand the pending confirmation page to the user's own browser. The page
   * cannot do that itself: a window it opens stays inside the shell hosting it.
   */
  openBrowser(): Promise<void>
  /** Forget the stored key and revoke it on the site. */
  signOut(): Promise<void>
  /** Read the site's model catalog beside the stored whitelist. */
  models(): Promise<NearTokenModelsState>
  /** Save a whitelist; an empty list shows every model again. */
  saveModels(enabled: readonly string[]): Promise<void>
  /** Read the picture models beside the stored image-generation setting. */
  images(): Promise<NearTokenImagesState>
  /** Save the image-generation setting: the tool's switch and one group per enabled model. */
  saveImages(patch: NearTokenImagesPatch): Promise<void>
}

/**
 * Read one JSON answer, turning an HTTP refusal into a thrown error.
 * @param response - the pending response.
 * @returns the parsed body.
 * @throws {Error} when the route answered a non-2xx status.
 */
async function jsonOf<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
  return await response.json() as T
}

/**
 * Build the carrier.
 * @param fetcher - HTTP carrier; defaults to the page's own fetch.
 * @returns the section's four calls.
 */
export function createNearTokenApi(fetcher: Fetch = (input, init) => fetch(input, init)): NearTokenApi {
  /** POST one empty JSON body and read its JSON answer. */
  const post = async <T>(path: string): Promise<T> => jsonOf<T>(await fetcher(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  }))
  return {
    async status() {
      return await jsonOf<NearTokenStatus>(await fetcher(STATUS_PATH, { headers: { accept: 'application/json' } }))
    },
    async refreshAccount() {
      return await post<NearTokenStatus>(REFRESH_PATH)
    },
    async begin() {
      return await post<BeginAuthorizationOutcome>(AUTHORIZE_PATH)
    },
    async cancel() {
      await post<unknown>(CANCEL_PATH)
    },
    async openBrowser() {
      // No body: the Host opens the page it is already waiting on, so this route
      // can never be asked to launch an arbitrary address.
      const response = await fetcher(OPEN_PATH, { method: 'POST' })
      if (!response.ok) {
        // The Host names why the platform launcher did not run; that reason is
        // what the reader needs, not a status code.
        const refusal = await response.json().catch(() => ({ message: `HTTP ${String(response.status)}` })) as { message?: string }
        throw new Error(refusal.message ?? `HTTP ${String(response.status)}`)
      }
    },
    async signOut() {
      await post<unknown>(LOGOUT_PATH)
    },
    async models() {
      return await jsonOf<NearTokenModelsState>(await fetcher(MODELS_PATH, { headers: { accept: 'application/json' } }))
    },
    async saveModels(enabled) {
      await jsonOf<unknown>(await fetcher(MODELS_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled } satisfies NearTokenModelsPatch),
      }))
    },
    async images() {
      return await jsonOf<NearTokenImagesState>(await fetcher(IMAGES_PATH, { headers: { accept: 'application/json' } }))
    },
    async saveImages(patch) {
      const response = await fetcher(IMAGES_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (!response.ok) {
        // The Host refuses a selection its catalog does not have; its message
        // names the reason, so the page shows that rather than a status code.
        const refusal = await response.json().catch(() => ({ message: `HTTP ${String(response.status)}` })) as { message?: string }
        throw new Error(refusal.message ?? `HTTP ${String(response.status)}`)
      }
    },
  }
}
