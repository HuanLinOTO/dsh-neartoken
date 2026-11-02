/**
 * The usage overview: one window of the account's spending and token counts,
 * read with the relay key the plugin already stores, and turned into the series
 * the settings page stacks by model.
 *
 * The site answers raw quota units, so every money figure is scaled through
 * {@link MoneyFormat} — the same facts the wallet card prints with. Nothing here
 * judges the answer beyond its shape: a site that predates the endpoint, and a
 * site that cannot be reached, are both stated as "no window to draw" with the
 * reason the page labels.
 *
 * @module
 */
import type { NearTokenUsageRange, NearTokenUsageState } from '../protocol.ts';
/**
 * How the site prints one quota amount: the symbol its money figures carry, and
 * the value one raw quota unit is worth in its display currency.
 */
export interface MoneyFormat {
    /** The symbol every amount carries (￥ or $). */
    readonly symbol: string;
    /**
     * The money one quota amount is worth, unrounded.
     * @param quota - raw quota units.
     * @returns the value in the site's display currency.
     */
    readonly value: (quota: number) => number;
}
/** What one usage read needs from the account. */
export interface UsageRead {
    /** Site root without a trailing slash. */
    readonly baseURL: string;
    /** The stored relay key, which is what authorizes the read. */
    readonly apiKey: string;
    /**
     * The card's current balance, already formatted in the site's currency. The
     * endpoint reports what the window spent; what is left of the balance is a
     * wallet fact, so it is carried in rather than asked for twice.
     */
    readonly balance: string;
    /** How the site prints money, so a band can be stacked without parsing strings. */
    readonly format: MoneyFormat;
}
/**
 * Read one window of the account's usage.
 * @param read - the site root, the key, the balance, and the money format.
 * @param range - the window to read.
 * @returns the window, or why there is none to draw.
 */
export declare function readUsage(read: UsageRead, range: NearTokenUsageRange): Promise<NearTokenUsageState>;
