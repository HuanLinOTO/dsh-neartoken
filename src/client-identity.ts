/**
 * The plugin's own identity on every request it sends to the site.
 *
 * Two headers tell the gateway who spoke. `x-dsh-client` is static — the
 * plugin and the version that built the request — so the site's usage log can
 * mark a record as coming from DSH. `x-dsh-session-id` repeats the harness
 * session, which is what lets a sticky-session rule pin one conversation to one
 * upstream channel (the same reason `sessionKeyOf` repeats it in the body, see
 * `host/session-key.ts`).
 *
 * The module sits at the package top level on purpose: `../package.json`
 * resolves to the package root both from this file in the source tree and from
 * the bundled `lib/index.js`, so the version can never be hand-copied and
 * drift (the same arrangement as `@deepseek-ai/dsh-llm`'s attribution).
 *
 * @module
 */
import { createRequire } from 'node:module'

// The manifest is the single source of the version; `./package.json` is an
// export of this package, so the relative path resolves from `src/` and from
// the bundle in `lib/` alike.
const { version } = createRequire(import.meta.url)('../package.json') as { version: string }

/** The value `x-dsh-client` carries on every request. */
const CLIENT = `dsh-neartoken/${version}`

/**
 * What a legal header value looks like: printable ASCII, no control characters,
 * no newlines, bounded length.
 *
 * A session id that fails this is dropped rather than sent: undici validates
 * header values as ByteString, so one non-ASCII character throws and takes the
 * whole request down with it.
 */
const HEADER_VALUE = /^[\x20-\x7E]{1,200}$/

/**
 * The identity headers one request to the site carries.
 * @param sessionId - the harness session, when the call has one.
 * @returns `x-dsh-client` always; `x-dsh-session-id` only for a legal session id.
 */
export function clientHeaders(sessionId?: string): Record<string, string> {
  const headers: Record<string, string> = { 'x-dsh-client': CLIENT }
  if (sessionId !== undefined && HEADER_VALUE.test(sessionId)) headers['x-dsh-session-id'] = sessionId
  return headers
}
