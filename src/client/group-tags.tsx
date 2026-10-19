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
import type { BadgeTone } from './groups.ts'
import css from './group-tags.module.css'

/** CSS Module class carrying each tone's hue, kept parallel to {@link BadgeTone}. */
const TONE_CLASS: Record<BadgeTone, string> = {
  rose: css.toneRose,
  emerald: css.toneEmerald,
  violet: css.toneViolet,
  sky: css.toneSky,
  amber: css.toneAmber,
  cyan: css.toneCyan,
  fuchsia: css.toneFuchsia,
  indigo: css.toneIndigo,
  teal: css.toneTeal,
  lime: css.toneLime,
  orange: css.toneOrange,
  pink: css.tonePink,
}

/** One bracketed group tag as a coloured capsule. */
export function GroupTag(props: { text: string; tone: BadgeTone }) {
  return <span className={css.tag + ' ' + TONE_CLASS[props.tone]}>{props.text}</span>
}

/**
 * One group's multiplier as a capsule.
 * @param props - the multiplier caption the catalog carried (`0.3x`).
 * @returns the capsule, toned by whether it beats the base price.
 */
export function RatioChip(props: { ratio: string }) {
  const value = Number.parseFloat(props.ratio)
  let tone = css.ratioBase
  if (Number.isFinite(value)) {
    if (value < 1) tone = css.ratioCheap
    else if (value > 1) tone = css.ratioPricey
  }
  return <span className={css.ratioChip + ' ' + tone}>{props.ratio}</span>
}
