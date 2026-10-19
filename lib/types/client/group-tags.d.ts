/**
 * The site's group vocabulary, rendered the way the site renders it: a group
 * name's leading tags become colour-coded capsules, its multiplier becomes a
 * capsule that reads green below the base price, and a model the site marks
 * with a `-c` suffix carries a note.
 *
 * Both surfaces that show groups — the settings page's whitelist and the
 * composer's model seat — share these so one group never looks like two
 * different things in the same product.
 */
import type { BadgeTone } from './groups.ts';
/** One bracketed group tag as a coloured capsule. */
export declare function GroupTag(props: {
    text: string;
    tone: BadgeTone;
}): import("react").JSX.Element;
/**
 * One group's multiplier as a capsule.
 * @param props - the multiplier caption the catalog carried (`0.3x`).
 * @returns the capsule, toned by whether it beats the base price.
 */
export declare function RatioChip(props: {
    ratio: string;
}): import("react").JSX.Element;
