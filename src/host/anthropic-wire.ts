/**
 * The Anthropic messages wire: what a Claude model behind the gateway expects,
 * and the SSE events it answers with, folded back into harness chunks.
 *
 * @module
 */
import { brandString } from '@deepseek-ai/dsh-brand'
import { LlmError } from '@deepseek-ai/dsh-llm'
import type {
  FinishReason, GenerateOptions, RequestMessage, StreamChunk, ToolCallBlock, ToolCallId, TokenUsage,
} from '@deepseek-ai/dsh-llm'
import { numberOf, parseJsonObject, sseData, stringOf } from './sse.ts'

/** One Anthropic content block, as sent. */
type WireBlock = Record<string, unknown>

/**
 * Flatten one message's text blocks.
 * @param content - the message's content blocks.
 * @returns the joined plain text.
 */
function textOf(content: readonly unknown[]): string {
  let text = ''
  for (const block of content) {
    if (typeof block === 'object' && block !== null && (block as { type?: string }).type === 'text') {
      text += (block as { text: string }).text
    }
  }
  return text
}

/**
 * Map one harness message onto its Anthropic form.
 * @param message - one conversation message.
 * @returns the wire message, or undefined when it carries nothing.
 */
function serializeMessage(message: RequestMessage): WireBlock | undefined {
  const content = message.content as readonly unknown[]
  switch (message.role) {
    case 'user':
    case 'system': {
      const text = textOf(content)
      return text === '' ? undefined : { role: 'user', content: [{ type: 'text', text }] }
    }
    case 'assistant': {
      const blocks: WireBlock[] = []
      const text = textOf(content)
      if (text !== '') blocks.push({ type: 'text', text })
      for (const block of content) {
        if (typeof block !== 'object' || block === null) continue
        const call = block as Partial<ToolCallBlock> & { type?: string }
        if (call.type !== 'tool-call') continue
        let input: unknown = {}
        try { input = call.arguments === undefined || call.arguments === '' ? {} : JSON.parse(call.arguments) } catch { input = {} }
        blocks.push({ type: 'tool_use', id: call.id, name: call.name, input })
      }
      return blocks.length === 0 ? undefined : { role: 'assistant', content: blocks }
    }
    case 'tool': {
      const text = textOf(content)
      return {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: message.toolCallId, content: text }],
      }
    }
    default:
      return undefined
  }
}

/**
 * Serialize one harness request into an Anthropic messages body.
 * @param options - the harness request.
 * @param model - the real model id the provider should route to.
 * @returns the ready-to-JSON body object.
 */
export function serializeRequest(options: GenerateOptions, model: string): Record<string, unknown> {
  const messages: WireBlock[] = []
  for (const message of options.messages) {
    // The messages API has no system role inside the turn list; such a message
    // is folded into the user turn shape rather than dropped.
    const wire = serializeMessage(message)
    if (wire !== undefined) messages.push(wire)
  }
  const body: Record<string, unknown> = {
    model,
    // Anthropic requires max_tokens; the harness may leave it open.
    max_tokens: options.maxTokens ?? 8192,
    messages,
    stream: true,
  }
  if (options.system !== undefined && options.system.length > 0) body.system = options.system
  if (options.tools !== undefined && options.tools.length > 0) {
    body.tools = options.tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters,
    }))
  }
  if (options.temperature !== undefined) body.temperature = options.temperature
  if (options.stop !== undefined && options.stop.length > 0) body.stop_sequences = options.stop
  return body
}

/** Accumulator state for one in-flight Anthropic stream. */
interface Assembly {
  textIndex: number | null
  text: string
  reasoningIndex: number | null
  reasoning: string
  toolBase: number
  toolBlocks: Map<number, { index: number; id: string; name: string; arguments: string }>
  usage: { input: number; cacheRead: number; cacheWrite: number; output: number } | null
  finish: string | null
}

/**
 * Fold one Anthropic event into the assembly state.
 * @param payload - one SSE data payload.
 * @param state - the live assembly state.
 * @returns zero or more harness chunks.
 */
function* consume(payload: string, state: Assembly): Generator<StreamChunk> {
  const event = parseJsonObject(payload)
  if (event === undefined) return
  const type = stringOf(event.type)
  if (type === 'message_start') {
    const usage = (event.message as { usage?: Record<string, unknown> } | undefined)?.usage ?? {}
    state.usage = {
      input: numberOf(usage.input_tokens) ?? 0,
      cacheRead: numberOf(usage.cache_read_input_tokens) ?? 0,
      cacheWrite: numberOf(usage.cache_creation_input_tokens) ?? 0,
      output: numberOf(usage.output_tokens) ?? 0,
    }
    return
  }
  if (type === 'content_block_start') {
    const index = numberOf(event.index) ?? 0
    const block = (event.content_block ?? {}) as Record<string, unknown>
    const kind = stringOf(block.type)
    if (kind === 'tool_use') {
      const entry = {
        index: state.toolBase + index,
        id: stringOf(block.id) ?? `tool_${index}`,
        name: stringOf(block.name) ?? '',
        arguments: '',
      }
      state.toolBlocks.set(index, entry)
      yield { type: 'block-start', index: entry.index, blockType: 'tool-call' }
      return
    }
    if (kind === 'thinking' || kind === 'redacted_thinking') {
      if (state.reasoningIndex === null) state.reasoningIndex = 1
      yield { type: 'block-start', index: 1, blockType: 'reasoning' }
      return
    }
    if (kind === 'text') {
      if (state.textIndex === null) state.textIndex = 0
      yield { type: 'block-start', index: 0, blockType: 'text' }
      return
    }
    return
  }
  if (type === 'content_block_delta') {
    const index = numberOf(event.index) ?? 0
    const delta = (event.delta ?? {}) as Record<string, unknown>
    const kind = stringOf(delta.type)
    if (kind === 'text_delta') {
      const text = stringOf(delta.text) ?? ''
      if (text === '') return
      state.text += text
      yield { type: 'text-delta', index: 0, text }
      return
    }
    if (kind === 'thinking_delta') {
      const text = stringOf(delta.thinking) ?? ''
      if (text === '') return
      state.reasoning += text
      yield { type: 'reasoning-delta', index: 1, text }
      return
    }
    if (kind === 'input_json_delta') {
      const partial = stringOf(delta.partial_json) ?? ''
      const entry = state.toolBlocks.get(index)
      if (entry === undefined || partial === '') return
      entry.arguments += partial
      yield {
        type: 'tool-call-delta',
        index: entry.index,
        id: brandString<ToolCallId>(entry.id),
        ...(entry.name !== '' ? { name: entry.name } : {}),
        argumentsDelta: partial,
      }
    }
    return
  }
  if (type === 'message_delta') {
    const delta = (event.delta ?? {}) as Record<string, unknown>
    const stop = stringOf(delta.stop_reason)
    if (stop !== undefined) state.finish = stop
    const usage = (event.usage ?? {}) as Record<string, unknown>
    const output = numberOf(usage.output_tokens)
    if (state.usage !== null && output !== undefined) state.usage.output = output
  }
}

/**
 * Fold one Anthropic stop reason into a harness finish reason.
 * @param reason - the raw stop_reason.
 * @returns the finish reason.
 */
function finishOf(reason: string | null): FinishReason {
  switch (reason) {
    case 'tool_use': return { kind: 'tool-calls' }
    case 'max_tokens': return { kind: 'max-tokens' }
    default: return { kind: 'stop' }
  }
}

/**
 * Parse one streamed Anthropic response into harness chunks.
 * @param response - the streaming fetch response.
 * @param signal - cancellation passthrough for the read loop.
 * @returns the chunk stream.
 */
export async function* parseSse(response: Response, signal: AbortSignal | undefined): AsyncGenerator<StreamChunk> {
  if (!response.ok || response.body === null) {
    const detail = await response.text().catch(() => '')
    throw new LlmError(`NearToken answered ${response.status}: ${detail.slice(0, 500)}`, 'PROVIDER_ERROR')
  }
  const state: Assembly = {
    textIndex: null, text: '', reasoningIndex: null, reasoning: '',
    toolBase: 2, toolBlocks: new Map(), usage: null, finish: null,
  }
  for await (const payload of sseData(response, signal)) yield* consume(payload, state)
  if (state.textIndex !== null) {
    yield { type: 'block-end', index: state.textIndex, block: { type: 'text', text: state.text } }
  }
  if (state.reasoningIndex !== null) {
    yield { type: 'block-end', index: state.reasoningIndex, block: { type: 'reasoning', text: state.reasoning } }
  }
  for (const block of state.toolBlocks.values()) {
    yield {
      type: 'block-end',
      index: block.index,
      block: {
        type: 'tool-call',
        id: brandString<ToolCallId>(block.id),
        name: block.name,
        arguments: block.arguments,
      },
    }
  }
  if (state.usage !== null) {
    const usage: TokenUsage = {
      inputTokens: state.usage.input,
      outputTokens: state.usage.output,
      ...(state.usage.cacheRead > 0 ? { cacheReadTokens: state.usage.cacheRead } : {}),
      ...(state.usage.cacheWrite > 0 ? { cacheWriteTokens: state.usage.cacheWrite } : {}),
    }
    yield { type: 'usage', usage }
  }
  yield { type: 'finish', reason: finishOf(state.finish) }
}
