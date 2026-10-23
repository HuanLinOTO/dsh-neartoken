/**
 * The four wires, read from the SSE frames the gateway actually sends.
 *
 * Frame samples are copied from live responses of the production gateway
 * (llm.pko.svcfusion.com) so the parsers are pinned to what the conversion
 * layer really emits: `"usage": null` on every chat frame, an estimated
 * `message_start` followed by real counts in `message_delta`, a thinking block
 * that opens before the text block, and `usageMetadata` repeated on every
 * Gemini frame.
 */
import { describe, expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { parseSse as parseChat, serializeRequest as serializeChat } from './openai-wire.ts'
import { parseSse as parseAnthropic, serializeRequest as serializeAnthropic } from './anthropic-wire.ts'
import { parseSse as parseGenai, serializeRequest as serializeGenai } from './genai-wire.ts'
import { parseSse as parseResponses, serializeRequest as serializeResponses } from './responses-wire.ts'
import { sseData } from './sse.ts'

/**
 * Build a streaming response whose body arrives in the given pieces.
 * @param pieces - body fragments, split to exercise line reassembly.
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
 * The one `usage` chunk of a finished stream.
 * @param chunks - the parser's output.
 * @returns the usage, or undefined when none was emitted.
 */
function usageOf(chunks: readonly StreamChunk[]): unknown {
  return chunks.find(chunk => chunk.type === 'usage')
}

/**
 * The blocks a finished stream closed, in emission order.
 * @param chunks - the parser's output.
 * @returns the assembled blocks.
 */
function blocksOf(chunks: readonly StreamChunk[]): unknown[] {
  return chunks.filter(chunk => chunk.type === 'block-end').map(chunk => (chunk as { block: unknown }).block)
}

/** A minimal harness request. */
function request(): GenerateOptions {
  return {
    provider: 'NearToken',
    model: 'x',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
  }
}

describe('sse plumbing', () => {
  it('yields a final payload that has no trailing newline', async () => {
    const response = streamed(['data: {"a":1}\n\ndata: {"a":2}'])
    const payloads: string[] = []
    for await (const payload of sseData(response, undefined)) payloads.push(payload)
    expect(payloads).toEqual(['{"a":1}', '{"a":2}'])
  })

  it('accepts CRLF line endings and reassembles split lines', async () => {
    const response = streamed(['data: {"a"', ':1}\r\n\r\ndata: [DONE]\r\n\r\n'])
    const payloads: string[] = []
    for await (const payload of sseData(response, undefined)) payloads.push(payload)
    expect(payloads).toEqual(['{"a":1}'])
  })
})

describe('chat completions wire', () => {
  it('survives the null usage every content frame carries', async () => {
    // The gateway sends "usage": null on each content frame; reading through it
    // used to throw and kill the stream mid-answer.
    const response = streamed([
      'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":null}],"usage":null}\n\n',
      'data: {"choices":[],"usage":{"prompt_tokens":4,"completion_tokens":2,"total_tokens":6,"prompt_tokens_details":{"cached_tokens":0}}}\n\n',
      'data: [DONE]\n\n',
    ])
    const chunks = await drain(parseChat(response, undefined))
    expect(blocksOf(chunks)).toEqual([{ type: 'text', text: 'ok' }])
    expect(usageOf(chunks)).toEqual({
      type: 'usage',
      usage: { inputTokens: 4, outputTokens: 2, totalTokens: 6 },
    })
  })

  it('separates cached prompt tokens from fresh input', async () => {
    const response = streamed([
      'data: {"choices":[{"delta":{"content":"hi"},"finish_reason":"stop"}],"usage":null}\n\n',
      'data: {"choices":[],"usage":{"prompt_tokens":100,"completion_tokens":5,"prompt_tokens_details":{"cached_tokens":80}}}\n\n',
    ])
    const chunks = await drain(parseChat(response, undefined))
    expect((usageOf(chunks) as { usage: unknown }).usage).toMatchObject({ inputTokens: 20, cacheReadTokens: 80 })
  })
})

describe('anthropic messages wire', () => {
  it('takes the real input tokens from message_delta, not the estimate', async () => {
    const response = streamed([
      'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":0,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"output_tokens":0}}}\n\n',
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"ok"}}\n\n',
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"input_tokens":4,"cache_read_input_tokens":569,"output_tokens":4}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ])
    const chunks = await drain(parseAnthropic(response, undefined))
    expect(usageOf(chunks)).toEqual({
      type: 'usage',
      usage: { inputTokens: 4, outputTokens: 4, cacheReadTokens: 569 },
    })
    expect(blocksOf(chunks)).toEqual([{ type: 'text', text: 'ok' }])
  })

  it('keeps a thinking block that opens before the text block', async () => {
    // Thinking first is the live ordering: the gateway opens it at index 0 and
    // the text at index 1.
    const response = streamed([
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":"","signature":""}}\n\n',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"17 x 23"}}\n\n',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"CAQS"}}\n\n',
      'data: {"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}\n\n',
      'data: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"391"}}\n\n',
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"input_tokens":9,"output_tokens":3}}\n\n',
    ])
    const chunks = await drain(parseAnthropic(response, undefined))
    expect(blocksOf(chunks)).toEqual([
      { type: 'reasoning', text: '17 x 23' },
      { type: 'text', text: '391' },
    ])
  })

  it('drops a thinking block that streamed no content', async () => {
    // A thinking block can open and close with nothing in it; an empty
    // reasoning block would still cost a transcript entry.
    const response = streamed([
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}\n\n',
      'data: {"type":"content_block_stop","index":0}\n\n',
      'data: {"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}\n\n',
      'data: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"ok"}}\n\n',
    ])
    const chunks = await drain(parseAnthropic(response, undefined))
    expect(blocksOf(chunks)).toEqual([{ type: 'text', text: 'ok' }])
  })

  it('does not repeat block-start for a block the wire re-announces', async () => {
    const response = streamed([
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"a"}}\n\n',
    ])
    const chunks = await drain(parseAnthropic(response, undefined))
    expect(chunks.filter(chunk => chunk.type === 'block-start')).toHaveLength(1)
  })

  it('assembles a streamed tool_use from input_json_delta', async () => {
    const response = streamed([
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"read"}}\n\n',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"pa"}}\n\n',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"th\\":1}"}}\n\n',
      'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"input_tokens":1,"output_tokens":2}}\n\n',
    ])
    const chunks = await drain(parseAnthropic(response, undefined))
    expect(blocksOf(chunks)).toEqual([
      { type: 'tool-call', id: 'toolu_1', name: 'read', arguments: '{"path":1}' },
    ])
    expect(chunks.at(-1)).toEqual({ type: 'finish', reason: { kind: 'tool-calls' } })
  })

  it('asks for adaptive thinking with the chosen effort', () => {
    // A token budget is rejected by the Claude 5 generation, while adaptive is
    // accepted by every generation behind this gateway.
    const body = serializeAnthropic(
      { ...request(), reasoningEffort: 'high' as GenerateOptions['reasoningEffort'] },
      'claude-opus-5-5',
    )
    expect(body.thinking).toEqual({ type: 'adaptive' })
    expect(body.output_config).toEqual({ effort: 'high' })
  })

  it('lowers the minimal effort, which the messages API does not know', () => {
    const body = serializeAnthropic(
      { ...request(), reasoningEffort: 'minimal' as GenerateOptions['reasoningEffort'] },
      'claude-opus-5-5',
    )
    expect(body.output_config).toEqual({ effort: 'low' })
  })

  it('sends no max_tokens when the caller set none and no thinking was asked for', () => {
    expect(serializeAnthropic(request(), 'claude-opus-5-5').max_tokens).toBeUndefined()
  })

  it('marks the prefix the next call replays, at the tool set, the system prompt, and the message tail', () => {
    // Without a breakpoint Anthropic writes no cache entry at all and bills the
    // whole prompt as fresh input, which is the entire cost of a long session.
    const body = serializeAnthropic(
      {
        ...request(),
        system: 'be brief',
        tools: [{ name: 'read', description: 'read a file', parameters: { type: 'object' } }],
        messages: [
          { role: 'user', content: [{ type: 'text', text: 'one' }] },
          { role: 'assistant', content: [{ type: 'text', text: 'two' }] },
          { role: 'user', content: [{ type: 'text', text: 'three' }] },
        ],
      } as unknown as GenerateOptions,
      'claude-opus-5-5',
    )
    const ephemeral = { type: 'ephemeral' }
    expect(body.system).toEqual([{ type: 'text', text: 'be brief', cache_control: ephemeral }])
    expect(body.tools).toEqual([
      { name: 'read', description: 'read a file', input_schema: { type: 'object' }, cache_control: ephemeral },
    ])
    const messages = body.messages as Array<{ content: Array<Record<string, unknown>> }>
    expect(messages.map(message => message.content.map(block => block.cache_control))).toEqual([
      [undefined],
      [ephemeral],
      [ephemeral],
    ])
  })

  it('marks a turn that ends with a tool result, which is the usual shape of a replayed call', () => {
    const body = serializeAnthropic({
      provider: 'NearToken',
      model: 'x',
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'read it' }] },
        { role: 'assistant', content: [{ type: 'tool-call', id: 'call_1', name: 'read', arguments: '{}' }] },
        { role: 'tool', toolCallId: 'call_1', content: [{ type: 'text', text: 'contents' }] },
      ],
    } as unknown as GenerateOptions, 'claude-opus-5-5')
    const messages = body.messages as Array<{ content: Array<Record<string, unknown>> }>
    expect(messages.at(-1)?.content.at(-1)).toEqual({
      type: 'tool_result',
      tool_use_id: 'call_1',
      content: 'contents',
      cache_control: { type: 'ephemeral' },
    })
  })
})

describe('genai wire', () => {
  it('routes thought parts to reasoning and text parts to text', async () => {
    const response = streamed([
      'data: {"candidates":[{"content":{"role":"model","parts":[{"thought":true,"text":""}]},"finishReason":null}],"usageMetadata":{"promptTokenCount":259,"candidatesTokenCount":0}}\n\n',
      'data: {"candidates":[{"content":{"role":"model","parts":[{"thought":true,"text":"thinking"}]},"finishReason":null}],"usageMetadata":{"promptTokenCount":259,"candidatesTokenCount":0}}\n\n',
      'data: {"candidates":[{"content":{"role":"model","parts":[{"text":"ok"}]},"finishReason":null}],"usageMetadata":{"promptTokenCount":259,"candidatesTokenCount":1}}\n\n',
      'data: {"candidates":[{"content":{"role":"model","parts":[]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":259,"candidatesTokenCount":1,"totalTokenCount":260}}\n\n',
    ])
    const chunks = await drain(parseGenai(response, undefined))
    expect(blocksOf(chunks)).toEqual([
      { type: 'reasoning', text: 'thinking' },
      { type: 'text', text: 'ok' },
    ])
    expect((usageOf(chunks) as { usage: unknown }).usage).toMatchObject({ inputTokens: 259, outputTokens: 1 })
  })

  it('keeps the last non-zero counts when a frame repeats zeroes', async () => {
    const response = streamed([
      'data: {"candidates":[{"content":{"parts":[{"text":"a"}]}}],"usageMetadata":{"promptTokenCount":10,"candidatesTokenCount":1}}\n\n',
      'data: {"candidates":[{"content":{"parts":[]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":0,"candidatesTokenCount":0}}\n\n',
    ])
    const chunks = await drain(parseGenai(response, undefined))
    expect((usageOf(chunks) as { usage: unknown }).usage).toMatchObject({ inputTokens: 10, outputTokens: 1 })
  })

  it('emits a whole tool-call block for one functionCall part', async () => {
    const response = streamed([
      'data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"read","args":{"path":"a"}}}]},"finishReason":"STOP"}]}\n\n',
    ])
    const chunks = await drain(parseGenai(response, undefined))
    expect(blocksOf(chunks)).toEqual([
      { type: 'tool-call', id: 'tool_read_0', name: 'read', arguments: '{"path":"a"}' },
    ])
    expect(chunks.at(-1)).toEqual({ type: 'finish', reason: { kind: 'tool-calls' } })
  })

  it('names a tool result after the function that was called', () => {
    const options = {
      provider: 'NearToken',
      model: 'x',
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'read a file' }] },
        { role: 'assistant', content: [{ type: 'tool-call', id: 'call_1', name: 'read', arguments: '{}' }] },
        { role: 'tool', toolCallId: 'call_1', content: [{ type: 'text', text: 'done' }] },
      ],
    } as unknown as GenerateOptions
    const body = serializeGenai(options, 'gemini-3-flash')
    const contents = body.contents as Array<{ role: string; parts: Array<Record<string, unknown>> }>
    expect(contents.at(-1)).toEqual({
      role: 'user',
      parts: [{ functionResponse: { name: 'read', response: { result: 'done' } } }],
    })
  })

  it('requests thought parts when a reasoning effort was chosen', () => {
    const body = serializeGenai(
      { ...request(), reasoningEffort: 'low' as GenerateOptions['reasoningEffort'] },
      'gemini-3-flash',
    )
    expect(body.generationConfig).toMatchObject({ thinkingConfig: { thinkingBudget: 2048, includeThoughts: true } })
  })

  it('asks Gemini 4 for a thinking level, which replaced the token budget', () => {
    // The live gateway answers 400 "Use thinking level instead" for a budget.
    const body = serializeGenai(
      { ...request(), reasoningEffort: 'high' as GenerateOptions['reasoningEffort'] },
      'gemini-4-argon',
    )
    expect(body.generationConfig).toMatchObject({ thinkingConfig: { thinkingLevel: 'high', includeThoughts: true } })
  })
})

describe('responses wire', () => {
  it('reads text, tool arguments, and usage from typed events', async () => {
    const response = streamed([
      'data: {"type":"response.output_item.added","item":{"type":"function_call","id":"fc_1","call_id":"call_1","name":"read"}}\n\n',
      'data: {"type":"response.function_call_arguments.delta","item_id":"fc_1","delta":"{\\"a\\":"}\n\n',
      'data: {"type":"response.function_call_arguments.delta","item_id":"fc_1","delta":"1}"}\n\n',
      'data: {"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":4125,"input_tokens_details":{"cached_tokens":3968},"output_tokens":5,"output_tokens_details":{"reasoning_tokens":0}}}}\n\n',
    ])
    const chunks = await drain(parseResponses(response, undefined))
    expect(blocksOf(chunks)).toEqual([
      { type: 'tool-call', id: 'call_1', name: 'read', arguments: '{"a":1}' },
    ])
    expect((usageOf(chunks) as { usage: unknown }).usage).toMatchObject({
      inputTokens: 157,
      outputTokens: 5,
      cacheReadTokens: 3968,
      reasoningTokens: 0,
    })
  })

  it('falls back to the finished item when no argument deltas arrived', async () => {
    const response = streamed([
      'data: {"type":"response.output_item.added","item":{"type":"function_call","id":"fc_1","call_id":"call_1","name":"read"}}\n\n',
      'data: {"type":"response.output_item.done","item":{"type":"function_call","id":"fc_1","call_id":"call_1","name":"read","arguments":"{\\"a\\":1}"}}\n\n',
      'data: {"type":"response.completed","response":{"status":"completed"}}\n\n',
    ])
    const chunks = await drain(parseResponses(response, undefined))
    expect(blocksOf(chunks)).toEqual([
      { type: 'tool-call', id: 'call_1', name: 'read', arguments: '{"a":1}' },
    ])
  })

  it('survives a null input_tokens_details and a missing output_tokens_details', async () => {
    const response = streamed([
      'data: {"type":"response.output_text.delta","delta":"ok"}\n\n',
      'data: {"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":7,"input_tokens_details":null,"output_tokens":2}}}\n\n',
    ])
    const chunks = await drain(parseResponses(response, undefined))
    expect(usageOf(chunks)).toEqual({ type: 'usage', usage: { inputTokens: 7, outputTokens: 2 } })
  })

  it('reports truncation rather than tool calls for an incomplete response', async () => {
    const response = streamed([
      'data: {"type":"response.output_item.added","item":{"type":"function_call","id":"fc_1","call_id":"call_1","name":"read"}}\n\n',
      'data: {"type":"response.incomplete","response":{"status":"incomplete"}}\n\n',
    ])
    const chunks = await drain(parseResponses(response, undefined))
    expect(chunks.at(-1)).toEqual({ type: 'finish', reason: { kind: 'max-tokens' } })
  })

  it('expands an assistant turn into a message item plus its calls', () => {
    const options = {
      provider: 'NearToken',
      model: 'x',
      messages: [{
        role: 'assistant',
        content: [
          { type: 'text', text: 'reading' },
          { type: 'tool-call', id: 'call_1', name: 'read', arguments: '{}' },
        ],
      }],
    } as unknown as GenerateOptions
    expect(serializeResponses(options, 'gpt-5.5').input).toEqual([
      { role: 'assistant', content: 'reading' },
      { type: 'function_call', call_id: 'call_1', name: 'read', arguments: '{}' },
    ])
  })

  it('raises a provider error when the stream reports a failure', async () => {
    const response = streamed(['data: {"type":"response.failed","response":{"status":"failed","error":{"message":"boom"}}}\n\n'])
    await expect(drain(parseResponses(response, undefined))).rejects.toThrow(/boom/)
  })
})

describe('chat wire serialization', () => {
  it('keeps the bare model and streaming usage request', () => {
    const body = serializeChat(request(), 'grok-4.6')
    expect(body).toMatchObject({ model: 'grok-4.6', stream: true, stream_options: { include_usage: true } })
  })
})

describe('session affinity key', () => {
  /**
   * One request carrying a session identity.
   * @param sessionId - the session the loop stamped on the request.
   * @returns the harness request.
   */
  function inSession(sessionId: string): GenerateOptions {
    return { ...request(), sessionId: brandString<NonNullable<GenerateOptions['sessionId']>>(sessionId) }
  }

  it('presents the session to the responses wire, whose path the affinity rule matches', () => {
    expect(serializeResponses(inSession('sess-1'), 'gpt-5.5').prompt_cache_key).toBe('sess-1')
  })

  it('presents the session to the chat wire too', () => {
    expect(serializeChat(inSession('sess-1'), 'grok-4.6').prompt_cache_key).toBe('sess-1')
  })

  it('routes a Claude request by the session, which is the field this gateway reads', () => {
    expect(serializeAnthropic(inSession('sess-1'), 'claude-opus-5-5').metadata).toEqual({ user_id: 'sess-1' })
  })

  it('sends no key at all when the request carries no session', () => {
    // An empty key would match the affinity rule and then bind to nothing,
    // which is worse than leaving the field out.
    expect(serializeResponses(request(), 'gpt-5.5').prompt_cache_key).toBeUndefined()
    expect(serializeChat(request(), 'grok-4.6').prompt_cache_key).toBeUndefined()
    expect(serializeAnthropic(request(), 'claude-opus-5-5').metadata).toBeUndefined()
    expect(serializeResponses(inSession(''), 'gpt-5.5').prompt_cache_key).toBeUndefined()
  })
})
