/**
 * What the messages API receives for a tool round: one result turn answers the
 * call batch of the assistant turn above it, every call is answered, and no
 * result is left dangling without a call.
 */
import { describe, expect, it } from 'vitest'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import { wireFor } from './protocol-router.ts'

/** A harness message as the loop hands it over, without durable identity. */
interface Loose {
  role: string
  content: unknown[]
  toolCallId?: string
}

/** One serialized wire message. */
interface SentMessage {
  role: string
  content: Record<string, unknown>[]
}

/**
 * Serialize one harness history for a Claude route.
 * @param messages - the harness history, in send order.
 * @returns the messages the wire carries.
 */
function sent(messages: readonly Loose[]): SentMessage[] {
  const request = { messages } as unknown as GenerateOptions
  const body = wireFor('claude-sonnet-4.5').serialize(request, 'claude-sonnet-4.5', new Map())
  return (body as { messages: SentMessage[] }).messages
}

/**
 * The call ids answered by one turn, in block order.
 * @param turn - one serialized turn.
 * @returns the \`tool_use_id\` of every result block.
 */
function resultIds(turn: SentMessage): unknown[] {
  return turn.content.filter(block => block['type'] === 'tool_result').map(block => block['tool_use_id'])
}

/** A user turn carrying one line of text. */
function text(value: string): Loose {
  return { role: 'user', content: [{ type: 'text', text: value }] }
}

/** A tool result carrying one line of text. */
function result(callId: string, value: string): Loose {
  return { role: 'tool', toolCallId: callId, content: [{ type: 'text', text: value }] }
}

/** An assistant turn asking for the given calls, by id. */
function calls(...ids: string[]): Loose {
  return {
    role: 'assistant',
    content: ids.map(id => ({ type: 'tool-call', id, name: 'read', arguments: '{}' })),
  }
}

describe('Claude tool rounds', () => {
  it('answers a parallel batch in the single turn that follows it', () => {
    const messages = sent([text('go'), calls('c1', 'c2'), result('c1', 'one'), result('c2', 'two')])
    expect(messages.map(message => message.role)).toEqual(['user', 'assistant', 'user'])
    expect(resultIds(messages[2] as SentMessage)).toEqual(['c1', 'c2'])
  })

  it('answers a call whose result never reached the request', () => {
    const messages = sent([text('go'), calls('c1', 'c2'), result('c1', 'one'), calls('c3'), result('c3', 'three')])
    expect(messages.map(message => message.role)).toEqual(['user', 'assistant', 'user', 'assistant', 'user'])
    const answered = messages[2] as SentMessage
    expect(resultIds(answered)).toEqual(['c1', 'c2'])
    expect(answered.content[1]?.content).toMatch(/no result was recorded/i)
  })

  it('drops a result whose call no assistant turn announced', () => {
    const messages = sent([text('go'), { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }, result('c9', 'stray')])
    expect(messages.map(message => message.role)).toEqual(['user', 'assistant'])
  })

  it('keeps a user turn that arrived mid-batch behind the results', () => {
    const messages = sent([text('go'), calls('c1', 'c2'), result('c1', 'one'), text('note'), result('c2', 'two')])
    const answered = messages[2] as SentMessage
    expect(resultIds(answered)).toEqual(['c1', 'c2'])
    expect(answered.content.at(-1)).toMatchObject({ type: 'text', text: 'note' })
  })

  it('folds consecutive user turns into one', () => {
    const messages = sent([text('one'), text('two')])
    expect(messages).toHaveLength(1)
    expect(messages[0]?.content).toMatchObject([{ type: 'text', text: 'one' }, { type: 'text', text: 'two' }])
  })
})
