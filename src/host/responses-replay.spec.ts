/**
 * The reasoning item a Responses turn hands back.
 *
 * The upstream answers every turn with a reasoning item — a visible summary
 * plus opaque ciphertext — ahead of the message and the calls it produced, and
 * a buyer of these trajectories requires that item to travel back verbatim in
 * the next request. These tests pin both halves: what one stream stores, and
 * what the next request sends.
 */
import { describe, expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import { BlockAssembler, createAssistantMessage, createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import type {
  GenerateOptions, MessageSource, ReasoningEffortId, ReplayEnvelope, RequestMessage, StreamChunk, ToolCallId,
} from '@deepseek-ai/dsh-llm'
import { parseSse, serializeRequest, serializeStatefulRequest } from './responses-wire.ts'

/** The ciphertext one turn was issued; it must come back byte for byte. */
const ENCRYPTED = 'gAAAAABq0b83Zk9uYWdlbnQtc2VjcmV0'

/** The summary text the model actually streamed. */
const SUMMARY_TEXT = '**我先检查工作区状态**'

/** The reasoning item the upstream returns, exactly as it arrives. */
const REASONING_ITEM = {
  type: 'reasoning',
  id: 'rs_0b83',
  summary: [{ type: 'summary_text', text: SUMMARY_TEXT }],
  content: [],
  encrypted_content: ENCRYPTED,
}

/**
 * Build a streaming response over the given body fragments.
 * @param pieces - body fragments, in arrival order.
 * @returns a 200 response carrying them.
 */
function streamed(pieces: readonly string[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder()
      for (const piece of pieces) controller.enqueue(encoder.encode(piece))
      controller.close()
    },
  })
  return new Response(body, { status: 200 })
}

/**
 * Collect every chunk one parser produces.
 * @param chunks - the parser's stream.
 * @returns the chunks in emission order.
 */
async function drain(chunks: AsyncGenerator<StreamChunk>): Promise<StreamChunk[]> {
  const all: StreamChunk[] = []
  for await (const chunk of chunks) all.push(chunk)
  return all
}

/**
 * The replay state one streamed turn finishes with.
 * @param pieces - the response body fragments.
 * @returns the envelope from the terminal chunk, if the turn stored one.
 */
async function replayOf(pieces: readonly string[]): Promise<ReplayEnvelope | undefined> {
  const finish = (await drain(parseSse(streamed(pieces), undefined))).at(-1)
  return finish?.type === 'finish' ? finish.replayState : undefined
}

/** One frame carrying the full reasoning item. */
function frame(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`
}

/** The whole turn the gateway answers: reasoning, then text, then one call. */
const TURN = [
  frame({ type: 'response.output_item.added', item: REASONING_ITEM }),
  frame({ type: 'response.reasoning_summary_text.delta', delta: SUMMARY_TEXT }),
  frame({ type: 'response.output_item.done', item: REASONING_ITEM }),
  frame({ type: 'response.output_text.delta', delta: 'done' }),
  frame({ type: 'response.output_item.added', item: { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'read' } }),
  frame({ type: 'response.function_call_arguments.delta', item_id: 'fc_1', delta: '{"a":1}' }),
  frame({
    type: 'response.completed',
    response: { status: 'completed', output: [REASONING_ITEM, { type: 'message' }, { type: 'function_call', id: 'fc_1' }] },
  }),
]

/**
 * One request whose history holds a single assistant turn.
 * @param model - the model this request asks for.
 * @param source - the stored provider, model, and replay state of that turn.
 * @returns the harness request.
 */
function withTurn(
  model: string, source: { provider: string; model: string; replayState?: unknown },
): GenerateOptions {
  return {
    provider: 'neartoken',
    model,
    messages: [
      createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }),
      createAssistantMessage({
        content: [
          { type: 'reasoning', text: SUMMARY_TEXT },
          { type: 'text', text: 'done' },
          { type: 'tool-call', id: brandString<ToolCallId>('call_1'), name: 'read', arguments: '{"a":1}' },
        ],
        source,
      }),
    ],
  }
}

/**
 * The items one request sends for its assistant turn.
 * @param model - the model the request asks for.
 * @param source - the stored provider, model, and replay state.
 * @returns the input array of the serialized body.
 */
function inputOf(
  model: string, source: { provider: string; model: string; replayState?: unknown },
): Record<string, unknown>[] {
  return serializeRequest(withTurn(model, source), model).input as Record<string, unknown>[]
}


/**
 * The text the turn's single reasoning block ends up carrying.
 * @param pieces - the response body fragments.
 * @returns the block text, or undefined when no reasoning block was emitted.
 */
async function reasoningTextOf(pieces: readonly string[]): Promise<string | undefined> {
  const chunks = await drain(parseSse(streamed(pieces), undefined))
  for (const chunk of chunks) {
    if (chunk.type === 'block-end' && chunk.block.type === 'reasoning') return chunk.block.text
  }
  return undefined
}

/** One summary part opening at the given index. */
function partAdded(itemId: string, summaryIndex: number): string {
  return frame({
    type: 'response.reasoning_summary_part.added',
    item_id: itemId,
    output_index: 0,
    summary_index: summaryIndex,
    part: { type: 'summary_text', text: '' },
  })
}

/** One summary delta at the given index. */
function partDelta(itemId: string, summaryIndex: number, delta: string): string {
  return frame({ type: 'response.reasoning_summary_text.delta', item_id: itemId, output_index: 0, summary_index: summaryIndex, delta })
}

describe('responses reasoning summary parts', () => {
  it('keeps one thought per line instead of running the parts together', async () => {
    const text = await reasoningTextOf([
      partAdded('rs_1', 0), partDelta('rs_1', 0, '**梳理下一步优先级**'),
      partAdded('rs_1', 1), partDelta('rs_1', 1, '**手动核验新界面**'),
      partAdded('rs_1', 2), partDelta('rs_1', 2, '**我先备份存档**'),
    ])
    expect(text).toBe('**梳理下一步优先级**\n\n**手动核验新界面**\n\n**我先备份存档**')
  })

  it('separates two reasoning items, whose parts both start at zero', async () => {
    const text = await reasoningTextOf([
      partAdded('rs_1', 0), partDelta('rs_1', 0, 'first item'),
      partAdded('rs_2', 0), partDelta('rs_2', 0, 'second item'),
    ])
    expect(text).toBe('first item\n\nsecond item')
  })

  it('adds nothing in front of the first part', async () => {
    const text = await reasoningTextOf([partAdded('rs_1', 0), partDelta('rs_1', 0, 'only thought')])
    expect(text).toBe('only thought')
  })

  it('leaves a stream without part events exactly as it arrived', async () => {
    // A gateway that never announces its parts still streams one summary; no
    // separator may be invented for it.
    const text = await reasoningTextOf([
      frame({ type: 'response.reasoning_summary_text.delta', delta: 'one ' }),
      frame({ type: 'response.reasoning_summary_text.delta', delta: 'line' }),
    ])
    expect(text).toBe('one line')
  })
})

describe('responses reasoning replay', () => {
  it('stores the turn reasoning item with the ciphertext it came with', async () => {
    expect(await replayOf(TURN)).toEqual({
      response: { kind: 'neartoken-responses', version: 1 },
      blocks: [
        {
          type: 'reasoning',
          id: 'rs_0b83',
          summary: [{ type: 'summary_text', text: SUMMARY_TEXT }],
          encryptedContent: ENCRYPTED,
        },
        { type: 'text' },
        { type: 'tool-call' },
      ],
    })
  })

  it('reads the item from the terminal event when no item event arrives', async () => {
    const envelope = await replayOf([
      frame({ type: 'response.reasoning_summary_text.delta', delta: SUMMARY_TEXT }),
      frame({ type: 'response.completed', response: { status: 'completed', output: [REASONING_ITEM] } }),
    ])
    expect(envelope?.blocks).toEqual([
      {
        type: 'reasoning',
        id: 'rs_0b83',
        summary: [{ type: 'summary_text', text: SUMMARY_TEXT }],
        encryptedContent: ENCRYPTED,
      },
    ])
  })


  it('stores the item from the terminal event of a turn that streamed no summary', async () => {
    // An upstream may answer with the reasoning item only in the events that
    // close the turn. The ciphertext is still good, so the envelope leads with
    // it instead of being dropped for a summary that never streamed.
    const envelope = await replayOf([
      frame({ type: 'response.output_text.delta', delta: 'done' }),
      frame({ type: 'response.completed', response: { status: 'completed', output: [REASONING_ITEM, { type: 'message' }] } }),
    ])
    expect(envelope?.blocks).toEqual([
      {
        type: 'reasoning',
        id: 'rs_0b83',
        summary: [{ type: 'summary_text', text: SUMMARY_TEXT }],
        encryptedContent: ENCRYPTED,
      },
      { type: 'text' },
    ])
  })
  it('sends the reasoning item ahead of the message and its calls, ciphertext intact', async () => {
    const replayState = await replayOf(TURN)
    const input = inputOf('gpt-5.5', { provider: 'neartoken', model: 'gpt-5.5', replayState })
    expect(input).toEqual([
      { role: 'user', content: 'go' },
      {
        type: 'reasoning',
        id: 'rs_0b83',
        summary: [{ type: 'summary_text', text: SUMMARY_TEXT }],
        encrypted_content: ENCRYPTED,
      },
      { role: 'assistant', content: 'done' },
      { type: 'function_call', call_id: 'call_1', name: 'read', arguments: '{"a":1}' },
    ])
  })

  it('sends the turn id back, and leaves the field out when there is none', () => {
    // The id is the upstream's own name for the item, so it travels back
    // verbatim; a turn the upstream named nothing travels without the field,
    // never with a placeholder.
    const itemFor = (id: unknown): Record<string, unknown> => {
      const replayState = {
        response: { kind: 'neartoken-responses', version: 1 },
        blocks: [{
          type: 'reasoning',
          ...id === undefined ? {} : { id },
          summary: [{ type: 'summary_text', text: SUMMARY_TEXT }],
          encryptedContent: ENCRYPTED,
        }],
      }
      return inputOf('gpt-5.5', { provider: 'neartoken', model: 'gpt-5.5', replayState })[1] ?? {}
    }

    expect(itemFor('rs_0b83')).toMatchObject({ id: 'rs_0b83', encrypted_content: ENCRYPTED })
    for (const missing of [undefined, '', 42]) {
      const item = itemFor(missing)
      expect(item).toMatchObject({ type: 'reasoning', encrypted_content: ENCRYPTED })
      expect(Object.hasOwn(item, 'id')).toBe(false)
    }
  })

  it('replays nothing recorded for another model', async () => {
    const replayState = await replayOf(TURN)
    const input = inputOf('gpt-5.5', { provider: 'neartoken', model: 'gpt-5.4', replayState })
    expect(input.map(item => item.type ?? item.role)).toEqual(['user', 'assistant', 'function_call'])
  })


  it('replays a turn recorded under the catalog id it was picked from', async () => {
    // The durable message keeps the id the model was picked from, group prefix
    // and all; the request only ever names the bare model inside it. Both
    // halves have to be decoded before they can be compared.
    const replayState = await replayOf(TURN)
    const id = '[特价] GPT::gpt-5.5'
    // The request names the bare model; the history names the catalog id.
    const body = serializeRequest(withTurn(id, { provider: 'neartoken', model: id, replayState }), 'gpt-5.5')
    const input = body.input as Record<string, unknown>[]
    expect(input.map(item => item.type ?? item.role)).toEqual(['user', 'reasoning', 'assistant', 'function_call'])
  })

  it('replays nothing for another model picked from the same group', async () => {
    const replayState = await replayOf(TURN)
    const body = serializeRequest(
      withTurn('[特价] GPT::gpt-5.5', { provider: 'neartoken', model: '[特价] GPT::gpt-5.4', replayState }),
      'gpt-5.5',
    )
    const input = body.input as Record<string, unknown>[]
    expect(input.map(item => item.type ?? item.role)).toEqual(['user', 'assistant', 'function_call'])
  })

  it('asks for the ciphertext and for no stored turn', () => {
    // Without the include an upstream may answer with no reasoning item at
    // all, and a turn with no ciphertext cannot be replayed.
    const body = serializeRequest({
      provider: 'neartoken',
      model: 'gpt-5.5',
      reasoningEffort: brandString<ReasoningEffortId>('high'),
      messages: [createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } })],
    }, 'gpt-5.5')
    expect(body).toMatchObject({ store: false, include: ['reasoning.encrypted_content'] })
  })

  it('keeps the include out of a call that took no reasoning effort', () => {
    const body = serializeRequest({
      provider: 'neartoken',
      model: 'gpt-5.5',
      messages: [createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } })],
    }, 'gpt-5.5')
    expect(body.store).toBe(false)
    expect(Object.hasOwn(body, 'include')).toBe(false)
  })
  it('replays nothing from another provider route', async () => {
    const replayState = await replayOf(TURN)
    const input = inputOf('gpt-5.5', { provider: 'deepseek', model: 'gpt-5.5', replayState })
    expect(input.map(item => item.type ?? item.role)).toEqual(['user', 'assistant', 'function_call'])
  })

  it('drops the whole envelope when the ciphertext is missing', () => {
    // A reasoning item without its ciphertext is not a replay item: sending one
    // back half-formed would fail the turn, so nothing is sent at all.
    const replayState = {
      response: { kind: 'neartoken-responses', version: 1 },
      blocks: [{ type: 'reasoning', summary: [{ type: 'summary_text', text: SUMMARY_TEXT }] }],
    }
    const input = inputOf('gpt-5.5', { provider: 'neartoken', model: 'gpt-5.5', replayState })
    expect(input.map(item => item.type ?? item.role)).toEqual(['user', 'assistant', 'function_call'])
  })

  it('drops an envelope of another kind or version', () => {
    const blocks = [{ type: 'reasoning', summary: [{ type: 'summary_text', text: SUMMARY_TEXT }], encryptedContent: ENCRYPTED }]
    for (const response of [
      { kind: 'deepseek-messages', version: 1 },
      { kind: 'neartoken-responses', version: 2 },
    ]) {
      const input = inputOf('gpt-5.5', { provider: 'neartoken', model: 'gpt-5.5', replayState: { response, blocks } })
      expect(input.map(item => item.type ?? item.role)).toEqual(['user', 'assistant', 'function_call'])
    }
  })

  it('reaches the next request through the real assembler', async () => {
    // The envelope is only useful if the harness keeps it: assembly copies it
    // onto the assistant source and prunes it in step with the blocks.
    const assembler = new BlockAssembler()
    for (const chunk of await drain(parseSse(streamed(TURN), undefined))) assembler.push(chunk)
    const message = assembler.message({
      provider: 'neartoken',
      model: 'gpt-5.5',
      replayState: assembler.replayState,
    })
    const input = serializeRequest(
      { provider: 'neartoken', model: 'gpt-5.5', messages: [message] }, 'gpt-5.5',
    ).input as Record<string, unknown>[]
    expect(input).toEqual([
      {
        type: 'reasoning',
        id: 'rs_0b83',
        summary: [{ type: 'summary_text', text: SUMMARY_TEXT }],
        encrypted_content: ENCRYPTED,
      },
      { role: 'assistant', content: 'done' },
      { type: 'function_call', call_id: 'call_1', name: 'read', arguments: '{"a":1}' },
    ])
  })

  it('sends the plain turn when the history carries no replay state', () => {
    const input = inputOf('gpt-5.5', { provider: 'neartoken', model: 'gpt-5.5' })
    expect(input.map(item => item.type ?? item.role)).toEqual(['user', 'assistant', 'function_call'])
  })
})

/** The id a site that stores the turn answers with. */
const RESPONSE_ID = 'resp_01J8ZQ9m2Q'

/** One turn the site kept: reasoning, visible text, and the id it stored it under. */
const STATEFUL_TURN = [
  frame({ type: 'response.reasoning_summary_text.delta', delta: SUMMARY_TEXT }),
  frame({ type: 'response.output_text.delta', delta: 'done' }),
  frame({ type: 'response.completed', response: { id: RESPONSE_ID, status: 'completed', output: [] } }),
]

/**
 * The envelope one stateful stream finishes with.
 * @param pieces - the response body fragments.
 * @returns the envelope from the terminal chunk, if the turn stored one.
 */
async function storedOf(pieces: readonly string[]): Promise<ReplayEnvelope | undefined> {
  const finish = (await drain(parseSse(streamed(pieces), undefined, { stateful: true }))).at(-1)
  return finish?.type === 'finish' ? finish.replayState : undefined
}

/** The envelope a stored turn is continued by. */
const STORED: ReplayEnvelope = {
  response: { kind: 'neartoken-responses', version: 2, id: RESPONSE_ID },
  blocks: [{ type: 'text' }],
}

/**
 * One conversation that continues a stored turn: that turn, its tool result,
 * and the question that follows.
 * @param source - the stored provider, model, and replay state of the turn.
 * @returns the harness request.
 */
function continued(source: { provider: string; model: string; replayState?: unknown }): GenerateOptions {
  return {
    provider: 'neartoken',
    model: 'gpt-5.5',
    messages: [
      createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }),
      createAssistantMessage({
        content: [
          { type: 'text', text: 'done' },
          { type: 'tool-call', id: brandString<ToolCallId>('call_1'), name: 'read', arguments: '{"a":1}' },
        ],
        source,
      }),
      createToolResultMessage({
        callId: brandString<ToolCallId>('call_1'), content: [{ type: 'text', text: 'ok' }], isError: false,
      }),
      createUserMessage({ content: [{ type: 'text', text: 'and?' }], source: { kind: 'user' } }),
    ],
  }
}

/**
 * The one user message a compaction leaves in place of the span it summarized.
 * @returns the checkpoint message, carrying the source kind the harness gives it.
 */
function checkpoint(): RequestMessage {
  return createUserMessage({
    content: [{ type: 'text', text: 'Turns 1-40, summarized.' }],
    // The kind is declared by the compaction package, which this plugin does not
    // depend on; the wire reads it structurally like every other source kind.
    source: { kind: 'compact-checkpoint', compactionId: 'cmp_1' } as unknown as MessageSource,
  })
}

describe('responses stateful replay', () => {
  it('records the id the site stored the turn under', async () => {
    const envelope = await storedOf(STATEFUL_TURN)
    expect(envelope?.response).toEqual({ kind: 'neartoken-responses', version: 2, id: RESPONSE_ID })
    // One entry per emitted block, so assembly prunes the envelope with them.
    expect(envelope?.blocks).toHaveLength(2)
  })

  it('records nothing for a turn the site gave no id', async () => {
    expect(await storedOf([
      frame({ type: 'response.output_text.delta', delta: 'done' }),
      frame({ type: 'response.completed', response: { status: 'completed' } }),
    ])).toBeUndefined()
  })

  it('reads the same turn as a client-held envelope when nothing said stateful', async () => {
    // The version is the only difference: a stream that carries both the
    // reasoning item and the stored id records the client-held envelope with
    // the ciphertext, and the stored one with the id — so a turn recorded by
    // either path is still understood by the path that recorded it.
    const turn = [
      frame({ type: 'response.output_item.done', item: REASONING_ITEM }),
      frame({ type: 'response.output_text.delta', delta: 'done' }),
      frame({ type: 'response.completed', response: { id: RESPONSE_ID, status: 'completed', output: [] } }),
    ]
    expect((await replayOf(turn))?.response).toEqual({ kind: 'neartoken-responses', version: 1 })
    expect((await replayOf(turn))?.blocks).toContainEqual({ type: 'reasoning', ...{
      id: 'rs_0b83',
      summary: [{ type: 'summary_text', text: SUMMARY_TEXT }],
      encryptedContent: ENCRYPTED,
    } })
    expect((await storedOf(turn))?.response).toEqual({ kind: 'neartoken-responses', version: 2, id: RESPONSE_ID })
  })

  it('asks the site to keep the first turn and never for the ciphertext', () => {
    const body = serializeStatefulRequest({
      provider: 'neartoken',
      model: 'gpt-5.5',
      reasoningEffort: brandString<ReasoningEffortId>('high'),
      messages: [createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } })],
    }, 'gpt-5.5')
    expect(body.store).toBe(true)
    expect(body.input).toEqual([{ role: 'user', content: 'go' }])
    expect(Object.hasOwn(body, 'include')).toBe(false)
    expect(Object.hasOwn(body, 'previous_response_id')).toBe(false)
  })

  it('continues the stored turn with only the messages after it', () => {
    const body = serializeStatefulRequest(
      continued({ provider: 'neartoken', model: 'gpt-5.5', replayState: STORED }), 'gpt-5.5',
    )
    expect(body.previous_response_id).toBe(RESPONSE_ID)
    expect(body.store).toBe(true)
    expect(body.input).toEqual([
      { type: 'function_call_output', call_id: 'call_1', output: 'ok' },
      { role: 'user', content: 'and?' },
    ])
  })

  it('sends the whole history when nothing follows the stored turn', () => {
    const body = serializeStatefulRequest(
      withTurn('gpt-5.5', { provider: 'neartoken', model: 'gpt-5.5', replayState: STORED }), 'gpt-5.5',
    )
    expect(Object.hasOwn(body, 'previous_response_id')).toBe(false)
    expect(body.input).toHaveLength(3)
  })

  it('starts a new chain when the history carries a compaction checkpoint', () => {
    // The site's chain still holds every turn the summary replaced, so naming a
    // turn from before the checkpoint appends the compacted tail onto a history
    // that never shrank: the reading stays high and every step compacts again.
    const stored = continued({ provider: 'neartoken', model: 'gpt-5.5', replayState: STORED })
    const body = serializeStatefulRequest({
      ...stored,
      messages: [...stored.messages.slice(0, 2), checkpoint(), ...stored.messages.slice(2)],
    }, 'gpt-5.5')
    expect(Object.hasOwn(body, 'previous_response_id')).toBe(false)
    // The whole history goes out, the checkpoint included.
    expect(body.input).toHaveLength(6)
  })

  it('starts a new chain when a checkpoint precedes the turn it would continue', () => {
    const stored = continued({ provider: 'neartoken', model: 'gpt-5.5', replayState: STORED })
    const body = serializeStatefulRequest({
      ...stored,
      messages: [checkpoint(), ...stored.messages],
    }, 'gpt-5.5')
    expect(Object.hasOwn(body, 'previous_response_id')).toBe(false)
    expect(body.input).toHaveLength(6)
  })

  it('continues nothing another model or another provider stored', () => {
    for (const source of [
      { provider: 'neartoken', model: 'gpt-5.4', replayState: STORED },
      { provider: 'deepseek', model: 'gpt-5.5', replayState: STORED },
    ]) {
      expect(Object.hasOwn(serializeStatefulRequest(continued(source), 'gpt-5.5'), 'previous_response_id'))
        .toBe(false)
    }
  })

  it('continues nothing from a client-held envelope', () => {
    const body = serializeStatefulRequest(continued({
      provider: 'neartoken', model: 'gpt-5.5',
      replayState: { response: { kind: 'neartoken-responses', version: 1 }, blocks: [] },
    }), 'gpt-5.5')
    expect(Object.hasOwn(body, 'previous_response_id')).toBe(false)
    // The stateful path replays no reasoning item: the site holds that turn.
    expect(JSON.stringify(body.input)).not.toContain('reasoning')
  })

  it('reaches the next request through the real assembler', async () => {
    const assembler = new BlockAssembler()
    for (const chunk of await drain(parseSse(streamed(STATEFUL_TURN), undefined, { stateful: true }))) {
      assembler.push(chunk)
    }
    const message = assembler.message({
      provider: 'neartoken', model: 'gpt-5.5', replayState: assembler.replayState,
    })
    const body = serializeStatefulRequest({
      provider: 'neartoken',
      model: 'gpt-5.5',
      messages: [message, createUserMessage({ content: [{ type: 'text', text: 'and?' }], source: { kind: 'user' } })],
    }, 'gpt-5.5')
    expect(body.previous_response_id).toBe(RESPONSE_ID)
    expect(body.input).toEqual([{ role: 'user', content: 'and?' }])
  })
})
