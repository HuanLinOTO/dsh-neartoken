/**
 * The wire vocabulary shared by the Host routes and the browser section: the
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
export declare const STATUS_PATH = "/neartoken/status";
/**
 * Re-read the wallet right now, then answer with the same state `STATUS_PATH`
 * reads. The Host already refreshes on its own cadence; this is the page asking
 * for that read early, and the answer carries the fresh numbers.
 */
export declare const REFRESH_PATH = "/neartoken/refresh";
/** Start a device authorization (the Host then polls the site). */
export declare const AUTHORIZE_PATH = "/neartoken/authorize";
/** Abandon the authorization in progress. */
export declare const CANCEL_PATH = "/neartoken/cancel";
/**
 * Ask the Host to open the pending confirmation page in the user's own browser.
 * The request carries no address: the Host opens the one it is waiting on.
 */
export declare const OPEN_PATH = "/neartoken/open";
/** Forget the stored key and revoke it on the site. */
export declare const LOGOUT_PATH = "/neartoken/logout";
/** Read the catalog beside the stored whitelist; POST a new whitelist. */
export declare const MODELS_PATH = "/neartoken/models";
/** Read the picture models and the image-generation setting; POST one change to it. */
export declare const IMAGES_PATH = "/neartoken/images";
/** Read the site's top-up offer; POST one order and open its checkout page. */
export declare const TOPUP_PATH = "/neartoken/topup";
/** One gateway method the site enabled. */
export interface NearTokenTopupMethod {
    /** The site's method type, posted back when starting an order. */
    readonly type: string;
    /** The label the site shows for it. */
    readonly name: string;
}
/** What the settings card may offer, as the Host reads it from the site. */
export interface NearTokenTopupInfo {
    /** Whether the site currently sells top-ups at all. */
    readonly enabled: boolean;
    /** The lowest amount the site accepts, in its display currency. */
    readonly minTopup: number;
    /** The amount ladder the site publishes. */
    readonly amountOptions: readonly number[];
    /** The gateway methods the site enabled, in its own order. */
    readonly methods: readonly NearTokenTopupMethod[];
}
/** One started order. */
export interface NearTokenTopupOrder {
    /** The site's order number, for support and for the card's own record. */
    readonly tradeNo: string;
    /** The site-relative checkout page that must be opened in the user's browser. */
    readonly payUrl: string;
}
/**
 * Check one top-up amount before it is sent.
 * @param amount - the number the user typed or picked.
 * @param min - the site's floor, in its display currency.
 * @returns the refusal to show, or undefined when the amount is acceptable.
 */
export declare function computeAmountError(amount: number, min: number): string | undefined;
/**
 * One group voucher the wallet carries: a balance that can only pay for its
 * own group. Amounts arrive as raw quota and are shown in the site's own
 * display currency, like every other money figure on the card.
 */
export interface NearTokenVoucher {
    /** Group name exactly as the site publishes it, badge prefixes included. */
    readonly group: string;
    /** The group's stable id, as the site's group registry numbers it. */
    readonly groupId: number;
    /** Remaining voucher balance, formatted in the site's display currency. */
    readonly amount: string;
}
/** One account's facts, as the settings card shows them. */
export interface NearTokenAccountSummary {
    /** The dashboard user name. */
    readonly username: string;
    /** The display name when the site set one, otherwise the user name. */
    readonly displayName: string;
    /** The user's own group, which is the default group a request routes by. */
    readonly group: string;
    /** Remaining quota, formatted in the site's own display currency. */
    readonly balance: string;
    /** Quota already spent, formatted the same way. */
    readonly used: string;
    /**
     * The per-group vouchers of the last wallet read, absent until one answered.
     * A grant does not carry them; they arrive with the first wallet refresh.
     */
    readonly vouchers?: readonly NearTokenVoucher[];
}
/** One authorization the human must finish in their browser. */
export interface NearTokenPendingAuthorization {
    /** The short code the site shows on its confirmation page. */
    readonly userCode: string;
    /** The page to open; carries no code of its own. */
    readonly verificationUri: string;
    /** The same page with the code prefilled. */
    readonly verificationUriComplete: string;
    /** When this attempt stops being valid, as epoch milliseconds. */
    readonly expiresAt: number;
}
/** The `GET /neartoken/status` answer. */
export interface NearTokenStatus {
    /** Whether an API key is stored, i.e. whether the provider route is mounted. */
    readonly configured: boolean;
    /** Site root the plugin talks to. */
    readonly baseURL: string;
    /** Name of the token the site created for this plugin. */
    readonly tokenName: string;
    /** Account facts, absent until a connection obtained them. */
    readonly account?: NearTokenAccountSummary;
    /** The authorization in progress, while one is running. */
    readonly pending?: NearTokenPendingAuthorization;
    /** Why the last attempt ended without a key, until the next one starts. */
    readonly error?: string;
}
/** One group's offering of a model, as the whitelist list shows it. */
export interface NearTokenModelGroup {
    /** Group name exactly as the site publishes it, badge prefixes included. */
    readonly group: string;
    /** The group's multiplier caption (`0.4x`), absent when the site published none. */
    readonly ratio?: string;
}
/** One model the whitelist can show or hide. */
export interface NearTokenModelEntry {
    /** Bare model name: the whitelist key, and what the site's API takes. */
    readonly model: string;
    /** Every group offering this model, in catalog order. */
    readonly groups: readonly NearTokenModelGroup[];
    /**
     * The cheapest multiplier among those groups, when the site published one.
     * The list shows it beside the group count; the per-group detail stays in
     * the hover panel.
     */
    readonly minRatio?: number;
    /** Context window the site declared for this model, in tokens. */
    readonly contextWindow?: number;
    /** Output ceiling the site declared for this model, in tokens. */
    readonly maxTokens?: number;
    /** Input modalities the site declared, reduced to the ones this harness knows. */
    readonly input?: readonly string[];
}
/**
 * The facts the settings page may state about one bare model name, winning over
 * both the site's declaration and the operator's `modelOverrides` entry.
 *
 * Every member is optional; an omitted member falls through to the next source.
 * A model whose value ends up with no member carries no entry at all.
 */
export interface NearTokenModelMeta {
    /** Context capacity in tokens; the fallback is the plugin's default. */
    readonly contextWindow?: number;
    /** Output ceiling in tokens; the only source that puts `max_tokens` on the wire. */
    readonly maxTokens?: number;
    /** Input modalities (`text` / `image`); without `image` the harness refuses image requests. */
    readonly input?: readonly ('text' | 'image')[];
}
/** The `GET /neartoken/models` answer. */
export interface NearTokenModelsState {
    /** Every model the site offers, in catalog order. */
    readonly models: readonly NearTokenModelEntry[];
    /** The stored whitelist; empty means no whitelist, so every model is shown. */
    readonly enabled: readonly string[];
    /** The stored per-model meta overrides; a model with no override carries no entry. */
    readonly meta: Readonly<Record<string, NearTokenModelMeta>>;
}
/** The `POST /neartoken/models` request body. */
export interface NearTokenModelsPatch {
    /** Model names to keep visible; an empty list restores the whole catalog. */
    readonly enabled: readonly string[];
    /**
     * The complete per-model meta overrides. Absent keeps the stored ones: the
     * whitelist autosaves without them, and such a save must not erase what the
     * meta editor wrote.
     */
    readonly meta?: Readonly<Record<string, NearTokenModelMeta>>;
}
/** The `POST /neartoken/authorize` answer. */
export type BeginAuthorizationOutcome = {
    readonly status: 'pending';
    readonly pending: NearTokenPendingAuthorization;
} | {
    readonly status: 'failed';
    readonly message: string;
};
/**
 * Which request shape one picture model speaks: the images endpoint, Gemini's
 * own generateContent, or a chat completion.
 */
export type NearTokenImageChannel = 'images' | 'genai' | 'chat';
/** One picture model the image-generation setting can enable. */
export interface NearTokenImageModelEntry {
    /** Bare model name, as the site's API takes it. */
    readonly model: string;
    /** The request shape this model answers. */
    readonly channel: NearTokenImageChannel;
    /** Every group offering this model, in catalog order. */
    readonly groups: readonly NearTokenModelGroup[];
    /** The cheapest multiplier among those groups, when the site published one. */
    readonly minRatio?: number;
}
/** The `GET /neartoken/images` answer. */
export interface NearTokenImagesState {
    /** Whether the `generate_image` tool is mounted for this profile. */
    readonly enabled: boolean;
    /** Every picture model the site offers, in catalog order. */
    readonly models: readonly NearTokenImageModelEntry[];
    /** The enabled models and the group each one routes through; empty means the tool has no model to call. */
    readonly selection: Readonly<Record<string, string>>;
}
/** The `POST /neartoken/images` request body. */
export interface NearTokenImagesPatch {
    /** Whether the tool should be mounted. */
    readonly enabled: boolean;
    /** Bare model name to the group name it must route through. */
    readonly models: Readonly<Record<string, string>>;
}
