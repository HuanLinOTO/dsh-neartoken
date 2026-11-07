/**
 * What the messages API receives for a tool round: one result turn answers the
 * call batch of the assistant turn above it, every call is answered, and no
 * result is left dangling without a call.
 */
import { describe, expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, ReasoningEffortId, ReplayEnvelope, StreamChunk } from '@deepseek-ai/dsh-llm'
import { parseSse, serializeRequest } from './anthropic-wire.ts'
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


/** The signature the upstream issued for the turn's thinking block. */
const SIGNATURE = 'EqQBCkgIAhABGAIiQHNpZ25hdHVyZQ=='

/** One SSE frame carrying one event payload. */
function frame(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`
}

/** The whole turn: a signed thinking block, then the answer. */
const TURN = [
  frame({ type: 'message_start', message: { id: 'msg_1', usage: { input_tokens: 3 } } }),
  frame({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } }),
  frame({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'pondering' } }),
  frame({ type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: SIGNATURE } }),
  frame({ type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } }),
  frame({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'done' } }),
  frame({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } }),
  frame({ type: 'message_stop' }),
]

/**
 * Collect every chunk one parser produces.
 * @param pieces - the response body fragments.
 * @returns the chunks in emission order.
 */
async function drain(pieces: readonly string[]): Promise<StreamChunk[]> {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder()
      for (const piece of pieces) controller.enqueue(encoder.encode(piece))
      controller.close()
    },
  })
  const all: StreamChunk[] = []
  for await (const chunk of parseSse(new Response(body, { status: 200 }), undefined)) all.push(chunk)
  return all
}

/**
 * The replay state one streamed turn finishes with.
 * @param pieces - the response body fragments.
 * @returns the envelope from the terminal chunk, if the turn stored one.
 */
async function replayOf(pieces: readonly string[]): Promise<ReplayEnvelope | undefined> {
  const finish = (await drain(pieces)).at(-1)
  return finish?.type === 'finish' ? finish.replayState : undefined
}

/**
 * One request whose history holds a single assistant turn.
 * @param model - the catalog id this request asks for.
 * @param source - the stored provider, model, and replay state of that turn.
 * @returns the harness request.
 */
function withTurn(model: string, source: { provider: string; model: string; replayState?: unknown }): GenerateOptions {
  return {
    provider: 'neartoken',
    model,
    reasoningEffort: brandString<ReasoningEffortId>('high'),
    messages: [
      createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }),
      createAssistantMessage({
        content: [{ type: 'reasoning', text: 'pondering' }, { type: 'text', text: 'done' }],
        source,
      }),
    ],
  }
}

describe('Claude thinking signatures', () => {
  it('stores the signature the turn closed its thinking block with', async () => {
    expect(await replayOf(TURN)).toEqual({
      response: { kind: 'neartoken-anthropic', version: 1 },
      blocks: [{ type: 'reasoning', signature: SIGNATURE }, { type: 'text' }],
    })
  })

  it('stores nothing for a turn whose thinking block was never signed', async () => {
    const unsigned = TURN.filter(piece => !piece.includes('signature_delta'))
    expect(await replayOf(unsigned)).toBeUndefined()
  })

  it('sends the thinking block back ahead of the answer, signature intact', async () => {
    const replayState = await replayOf(TURN)
    const model = 'claude-sonnet-4.5'
    const body = serializeRequest(withTurn(model, { provider: 'neartoken', model, replayState }), model)
    const messages = body.messages as { role: string; content: Record<string, unknown>[] }[]
    expect(messages[1]?.content).toMatchObject([
      { type: 'thinking', thinking: 'pondering', signature: SIGNATURE },
      { type: 'text', text: 'done' },
    ])
  })

  it('replays a turn recorded under the catalog id it was picked from', async () => {
    const replayState = await replayOf(TURN)
    const id = '[特价] Claude::claude-sonnet-4.5'
    const body = serializeRequest(withTurn(id, { provider: 'neartoken', model: id, replayState }), 'claude-sonnet-4.5')
    const messages = body.messages as { content: Record<string, unknown>[] }[]
    expect(messages[1]?.content[0]).toMatchObject({ type: 'thinking', signature: SIGNATURE })
  })

  it('replays nothing recorded for another model', async () => {
    const replayState = await replayOf(TURN)
    const body = serializeRequest(
      withTurn('claude-sonnet-4.5', { provider: 'neartoken', model: 'claude-opus-4.5', replayState }),
      'claude-sonnet-4.5',
    )
    const messages = body.messages as { content: Record<string, unknown>[] }[]
    expect(messages[1]?.content.map(block => block['type'])).toEqual(['text'])
  })
})

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
