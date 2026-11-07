/**
 * The id a tool call travels under.
 *
 * A history carried over from another provider can hold an id the model APIs
 * refuse — a composite `call_<call id>|<item id>` runs past the 64-character
 * cap the Responses wire enforces — and one such turn fails every request that
 * replays it, so the id is shortened before it reaches the wire.
 */
import { describe, expect, it } from 'vitest'
import { wireCallId } from './wire-call-id.ts'

/** An id a Responses upstream refused: a harness call id paired with its item id, 91 characters. */
const COMPOSITE = 'call_94f08b1bd1c140c49605225f285886ab|fc_0e16f668eb0a995a016accc24717c481918755704238d6de66'

describe('wire call ids', () => {
  it('sends an id that already fits unchanged', () => {
    expect(wireCallId('call_3d89f19268344e33ba0dace6')).toBe('call_3d89f19268344e33ba0dace6')
  })

  it('shortens an id that runs past the cap', () => {
    expect(COMPOSITE).toHaveLength(91)
    const wire = wireCallId(COMPOSITE)
    expect(wire.length).toBeLessThanOrEqual(64)
    expect(wire).toMatch(/^call_[0-9a-f]{24}$/)
  })

  it('answers a call and its result with the same id', () => {
    // The two sides of one call are serialized by separate passes, so the
    // shortening has to be a digest rather than a counter.
    expect(wireCallId(COMPOSITE)).toBe(wireCallId(COMPOSITE))
  })

  it('keeps distinct calls apart', () => {
    const sibling = COMPOSITE.replace('94f08b1b', 'fa2bbb92')
    expect(wireCallId(COMPOSITE)).not.toBe(wireCallId(sibling))
  })

  it('replaces an id the messages API would refuse, however short', () => {
    expect(wireCallId('call_1|fc_2')).toMatch(/^call_[0-9a-f]{24}$/)
  })
})
