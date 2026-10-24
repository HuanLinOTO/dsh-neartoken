import type { Context } from '@deepseek-ai/cordis';
import type { BeginAuthorizationOutcome, NearTokenStatus } from '../protocol.ts';
import { type NearTokenTopupInfo, type NearTokenTopupOrder } from './topup.ts';
/**
 * How often the wallet facts are re-read while a key is stored. Five minutes
 * matches how stale the card's money numbers may look on an open settings page.
 */
export declare const WALLET_REFRESH_MS = 300000;
/** External facts the account reads from the plugin configuration. */
export interface NearTokenSite {
    /** Site root without a trailing slash. */
    baseURL: () => string;
    /** Credential reference the adapter resolves, such as `NEARTOKEN_API_KEY`. */
    apiKeyRef: () => string;
}
/** The NearToken account, one instance per plugin mount. */
export declare class NearTokenAccount {
    private readonly ctx;
    private readonly site;
    private readonly onGranted;
    private readonly client;
    /** The authorization being polled, while one is. */
    private attempt;
    /** Account facts obtained by the last grant in this process. */
    private summary;
    /** The read that restores those facts from the stored key, while one is running. */
    private summaryLoad;
    /** The last snapshot write, so two of them never race on one file. */
    private summaryWrite;
    /** The site-side token name behind the stored key. */
    private tokenName;
    /** Why the last attempt ended without a key. */
    private error;
    /** Cached `/api/status` currency facts. */
    private currency;
    /**
     * @param ctx - the owning plugin context, for the credentials service.
     * @param site - site root and the API key reference.
     * @param onGranted - called once a key has been stored, so the provider route can mount.
     */
    constructor(ctx: Context, site: NearTokenSite, onGranted: () => void);
    /**
     * Whether an API key is stored, i.e. whether the provider route can serve.
     * @returns true when the credential resolves to a non-empty value.
     */
    configured(): Promise<boolean>;
    /**
     * Read the site's top-up offer with the stored key.
     *
     * The site answers this only for a key its own device-authorization flow
     * minted, so a key pasted in from elsewhere is a reason the page can act on
     * rather than a bug.
     * @returns the amount ladder, the floor and the enabled gateway methods.
     * @throws {NearTokenTopupError} when the key is missing, refused, or the site is unreachable.
     */
    topupInfo(): Promise<NearTokenTopupInfo>;
    /**
     * Start one top-up order.
     * @param amount - the amount the user picked, in the site's display currency.
     * @param paymentMethod - one gateway type from {@link topupInfo}.
     * @returns the order number and the site-relative checkout link.
     * @throws {NearTokenTopupError} when the key is missing, refused, or the site is unreachable.
     */
    createTopup(amount: number, paymentMethod: string): Promise<NearTokenTopupOrder>;
    /**
     * Read the state the settings page draws: the key state, the account, and any
     * authorization still waiting for its human.
     * @returns the current status.
     */
    status(): Promise<NearTokenStatus>;
    /**
     * Keep the card's money facts live: while a key is stored, re-read the site's
     * wallet endpoint on a fixed cadence, starting immediately.
     *
     * The grant that minted the key carried the account facts exactly once, and
     * wallet balances move with every billed request and every rebate — without
     * this the card would freeze at the moment of authorization forever.
     * @param intervalMs - cadence of one wallet read.
     */
    startWalletRefresh(intervalMs?: number): void;
    /**
     * Read the wallet once: balance, spent quota, and every per-group voucher,
     * formatted in the site's own display currency.
     *
     * A site that does not serve the endpoint yet (or one that cannot be reached)
     * keeps the last known facts: a refresh must never cost the card its numbers.
     * @returns after the read settles, either way.
     */
    refreshWallet(): Promise<void>;
    /**
     * Start an authorization, or report the one already running.
     * @returns the codes the human needs, or why the site refused to issue them.
     */
    begin(): Promise<BeginAuthorizationOutcome>;
    /**
     * Abandon the authorization in progress.
     * @returns after the poll loop stops; the site's own record expires on its own.
     */
    cancel(): Promise<void>;
    /**
     * Forget the stored key, and tell the site to revoke it.
     *
     * The revocation is best-effort: the credential this plugin holds is gone the
     * moment this resolves, and a site that cannot be reached must not leave the
     * user connected here.
     * @returns after the credential record is removed.
     */
    signOut(): Promise<void>;
    /**
     * Poll the site until the human decides, the attempt expires, or it is withdrawn.
     * @param attempt - the authorization to poll.
     */
    private pollUntilSettled;
    /**
     * Store a granted key and announce the provider route.
     * @param attempt - the authorization that was granted.
     * @param outcome - the grant, with the key and the account it belongs to.
     */
    private commit;
    /**
     * End one attempt with a message for the page.
     * @param attempt - the attempt that ended.
     * @param message - why it ended without a key.
     */
    private settle;
    /**
     * Retire one attempt if it is still the current one.
     * @param attempt - the attempt to retire.
     */
    private clearAttempt;
    /** Withdraw whatever attempt is running. */
    private stop;
    /**
     * Restore the card's facts for a key that was stored before this process.
     *
     * One read per process: a grant fills the summary itself, and the settings
     * page asks for the status on every poll while an authorization waits, so a
     * second concurrent read would only repeat the first.
     * @returns after the read settles, whether or not it found anything.
     */
    private loadSummary;
    /** Where the account snapshot lives, when the composition exposes a profile. */
    private snapshotPath;
    /** Read the snapshot a previous process recorded when the grant arrived. */
    private restoreSummary;
    /**
     * Record the facts a grant carried, so they outlive this process.
     *
     * A grant and a wallet read can both want to store the card within the same
     * tick, so writes are queued behind one another and each lands atomically: a
     * reader (a restarted process) must never open a half-written file.
     * @returns after this write landed, or was found unnecessary.
     */
    private persistSummary;
    /**
     * Drop the snapshot once the key it describes is gone.
     * @returns after the file is gone, behind any write still queued.
     */
    private forgetSummary;
    /** Read one credential reference, or undefined when nothing is stored. */
    private read;
    /** Write one credential reference. */
    private write;
    /** Remove one credential reference. */
    private clear;
    /**
     * The cached currency facts, read from the site when the cache is cold.
     * @returns the formatting facts.
     * @throws {NewApiError} when a cold read fails.
     */
    private currencyInfo;
}
