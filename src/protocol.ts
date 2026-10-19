/**
 * The wire vocabulary shared by the Host routes and the browser section: four
 * route paths and the JSON each answers. Both build faces import this file, so
 * a route rename cannot leave the browser calling a path the Host stopped
 * serving.
 *
 * Nothing here carries a password: the plugin never collects site credentials.
 * A connection is authorized by the site's own device-authorization flow, in
 * the user's browser — the Host only polls its result.
 *
 * @module
 */

/** State read by the settings page before it draws, and while it waits. */
export const STATUS_PATH = '/neartoken/status'
/** Start a device authorization (the Host then polls the site). */
export const AUTHORIZE_PATH = '/neartoken/authorize'
/** Abandon the authorization in progress. */
export const CANCEL_PATH = '/neartoken/cancel'
/** Forget the stored key and revoke it on the site. */
export const LOGOUT_PATH = '/neartoken/logout'
/** Read the catalog beside the stored whitelist; POST a new whitelist. */
export const MODELS_PATH = '/neartoken/models'
/** Read the picture models and the image-generation setting; POST one change to it. */
export const IMAGES_PATH = '/neartoken/images'

/** One account's facts, as the settings card shows them. */
export interface NearTokenAccountSummary {
  /** The dashboard user name. */
  readonly username: string
  /** The display name when the site set one, otherwise the user name. */
  readonly displayName: string
  /** The user's own group, which is the default group a request routes by. */
  readonly group: string
  /** Remaining quota, formatted in the site's own display currency. */
  readonly balance: string
  /** Quota already spent, formatted the same way. */
  readonly used: string
}

/** One authorization the human must finish in their browser. */
export interface NearTokenPendingAuthorization {
  /** The short code the site shows on its confirmation page. */
  readonly userCode: string
  /** The page to open; carries no code of its own. */
  readonly verificationUri: string
  /** The same page with the code prefilled. */
  readonly verificationUriComplete: string
  /** When this attempt stops being valid, as epoch milliseconds. */
  readonly expiresAt: number
}

/** The `GET /neartoken/status` answer. */
export interface NearTokenStatus {
  /** Whether an API key is stored, i.e. whether the provider route is mounted. */
  readonly configured: boolean
  /** Site root the plugin talks to. */
  readonly baseURL: string
  /** Name of the token the site created for this plugin. */
  readonly tokenName: string
  /** Account facts, absent until a connection obtained them. */
  readonly account?: NearTokenAccountSummary
  /** The authorization in progress, while one is running. */
  readonly pending?: NearTokenPendingAuthorization
  /** Why the last attempt ended without a key, until the next one starts. */
  readonly error?: string
}

/** One group's offering of a model, as the whitelist list shows it. */
export interface NearTokenModelGroup {
  /** Group name exactly as the site publishes it, badge prefixes included. */
  readonly group: string
  /** The group's multiplier caption (`0.4x`), absent when the site published none. */
  readonly ratio?: string
}

/** One model the whitelist can show or hide. */
export interface NearTokenModelEntry {
  /** Bare model name: the whitelist key, and what the site's API takes. */
  readonly model: string
  /** Every group offering this model, in catalog order. */
  readonly groups: readonly NearTokenModelGroup[]
  /**
   * The cheapest multiplier among those groups, when the site published one.
   * The list shows it beside the group count; the per-group detail stays in
   * the hover panel.
   */
  readonly minRatio?: number
}

/** The `GET /neartoken/models` answer. */
export interface NearTokenModelsState {
  /** Every model the site offers, in catalog order. */
  readonly models: readonly NearTokenModelEntry[]
  /** The stored whitelist; empty means no whitelist, so every model is shown. */
  readonly enabled: readonly string[]
}

/** The `POST /neartoken/models` request body. */
export interface NearTokenModelsPatch {
  /** Model names to keep visible; an empty list restores the whole catalog. */
  readonly enabled: readonly string[]
}

/** The `POST /neartoken/authorize` answer. */
export type BeginAuthorizationOutcome =
  | { readonly status: 'pending'; readonly pending: NearTokenPendingAuthorization }
  | { readonly status: 'failed'; readonly message: string }

/** Which request shape one picture model speaks: the images endpoint or a chat completion. */
export type NearTokenImageChannel = 'images' | 'chat'

/** One picture model the image-generation setting can enable. */
export interface NearTokenImageModelEntry {
  /** Bare model name, as the site's API takes it. */
  readonly model: string
  /** The request shape this model answers. */
  readonly channel: NearTokenImageChannel
  /** Every group offering this model, in catalog order. */
  readonly groups: readonly NearTokenModelGroup[]
  /** The cheapest multiplier among those groups, when the site published one. */
  readonly minRatio?: number
}

/** The `GET /neartoken/images` answer. */
export interface NearTokenImagesState {
  /** Whether the `generate_image` tool is mounted for this profile. */
  readonly enabled: boolean
  /** Every picture model the site offers, in catalog order. */
  readonly models: readonly NearTokenImageModelEntry[]
  /** The enabled models and the group each one routes through; empty means the tool has no model to call. */
  readonly selection: Readonly<Record<string, string>>
}

/** The `POST /neartoken/images` request body. */
export interface NearTokenImagesPatch {
  /** Whether the tool should be mounted. */
  readonly enabled: boolean
  /** Bare model name to the group name it must route through. */
  readonly models: Readonly<Record<string, string>>
}

