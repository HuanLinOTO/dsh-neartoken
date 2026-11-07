/**
 * The id one tool call travels under on every model wire.
 *
 * The Responses wire caps `call_id` at 64 characters and chat completions caps
 * `tool_call_id` the same way, while the messages API only tolerates
 * `[A-Za-z0-9_-]`. The harness keeps whatever id produced its history, which
 * includes composite ids such as `call_<call id>|<item id>` handed down by a
 * provider that pairs its own item id with the wire call id — those run past
 * the cap, and one such turn fails every request that replays it.
 * @module
 */
import { createHash } from 'node:crypto'

/** The longest tool-call id the model APIs accept. */
const WIRE_CALL_ID_LIMIT = 64

/** The characters every one of those APIs accepts in an id. */
const WIRE_CALL_ID_CHARS = /^[A-Za-z0-9_-]+$/

/**
 * Shorten one harness tool-call id to something the wire accepts.
 *
 * The replacement is a pure digest of the original, so a call and the result
 * that answers it land on the same id without either pass carrying state: the
 * assistant turn and the tool message are serialized separately.
 * @param id - the harness tool-call id.
 * @returns the id to send; unchanged when it is already acceptable.
 */
export function wireCallId(id: string): string {
  if (id.length <= WIRE_CALL_ID_LIMIT && WIRE_CALL_ID_CHARS.test(id)) return id
  return `call_${createHash('sha256').update(id).digest('hex').slice(0, 24)}`
}
