/**
 * The OpenAI Responses wire: `POST /v1/responses`, whose SSE stream speaks in
 * typed events (`response.output_text.delta`, `response.function_call_arguments.delta`,
 * …) rather than chat deltas.
 *
 * @module
 */
import { brandString } from '@deepseek-ai/dsh-brand'
import { LlmError } from '@deepseek-ai/dsh-llm'
import type {
  FinishReason, GenerateOptions, RequestMessage, StreamChunk, ToolCallBlock, ToolCallId, TokenUsage,
} from '@deepseek-ai/dsh-llm'
import { numberOf, parseJsonObject, sseData, stringOf } from './sse.ts'

/** One responses input item, as sent. */
type InputItem = Record<string, unknown>

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
 * Map one harness message onto its responses input item.
 * @param message - one conversation message.
 * @returns the input item, or undefined when it carries nothing.
 */
function serializeMessage(message: RequestMessage): InputItem | undefined {
  const content = message.content as readonly unknown[]
  switch (message.role) {
    case 'user':
    case 'system':
    case 'developer': {
      const text = textOf(content)
      return text === '' ? undefined : { role: 'user', content: text }
    }
    case 'assistant': {
      const text = textOf(content)
      const calls: InputItem[] = []
      for (const block of content) {
        if (typeof block !== 'object' || block === null) continue
        const call = block as Partial<ToolCallBlock> & { type?: string }
        if (call.type !== 'tool-call') continue
        calls.push({
          type: 'function_call',
          call_id: call.id,
          name: call.name,
          arguments: call.arguments ?? '',
        })
      }
      if (text !== '') calls.unshift({ role: 'assistant', content: text })
      return calls.length === 0 ? undefined : { items: calls }
    }
    case 'tool': {
      const text = textOf(content)
      return { type: 'function_call_output', call_id: message.toolCallId, output: text }
    }
    default:
      return undefined
  }
}

/**
 * Serialize one harness request into a responses body.
 * @param options - the harness request.
 * @param model - the real model id the provider should route to.
 * @returns the ready-to-JSON body object.
 */
export function serializeRequest(options: GenerateOptions, model: string): Record<string, unknown> {
  const input: InputItem[] = []
  for (const message of options.messages) {
    const wire = serializeMessage(message)
    if (wire === undefined) continue
    // An assistant turn that carries both text and calls expands to several items.
    if (Array.isArray(wire.items)) input.push(...wire.items as InputItem[])
    else input.push(wire)
  }
  const body: Record<string, unknown> = { model, input, stream: true }
  if (options.system !== undefined && options.system.length > 0) body.instructions = options.system
  if (options.tools !== undefined && options.tools.length > 0) {
    body.tools = options.tools.map(tool => ({
      type: 'function',
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    }))
  }
  if (options.temperature !== undefined) body.temperature = options.temperature
  if (options.maxTokens !== undefined) body.max_output_tokens = options.maxTokens
  if (options.reasoningEffort !== undefined) {
    body.reasoning = { effort: options.reasoningEffort, summary: 'auto' }
  }
  return body
}

/** Accumulator state for one in-flight responses stream. */
interface Assembly {
  textIndex: number | null
  text: string
  reasoningIndex: number | null
  reasoning: string
  toolBase: number
  toolBlocks: Map<string, { index: number; id: string; name: string; arguments: string }>
  usage: TokenUsage | null
  finish: string | null
  incomplete: boolean
}

/**
 * Fold one responses event into the assembly state.
 * @param payload - one SSE data payload.
 * @param state - the live assembly state.
 * @returns zero or more harness chunks.
 */
function* consume(payload: string, state: Assembly): Generator<StreamChunk> {
  const event = parseJsonObject(payload)
  if (event === undefined) return
  const type = stringOf(event.type)
  switch (type) {
    case 'response.output_item.added': {
      const item = (event.item ?? {}) as Record<string, unknown>
      if (stringOf(item.type) !== 'function_call') return
      const key = stringOf(item.id) ?? `call_${state.toolBlocks.size}`
      const entry = {
        index: state.toolBase + state.toolBlocks.size,
        id: stringOf(item.call_id) ?? key,
        name: stringOf(item.name) ?? '',
        arguments: '',
      }
      state.toolBlocks.set(key, entry)
      yield { type: 'block-start', index: entry.index, blockType: 'tool-call' }
      return
    }
    case 'response.output_text.delta': {
      const text = stringOf(event.delta) ?? ''
      if (text === '') return
      if (state.textIndex === null) {
        state.textIndex = 0
        yield { type: 'block-start', index: 0, blockType: 'text' }
      }
      state.text += text
      yield { type: 'text-delta', index: 0, text }
      return
    }
    case 'response.reasoning_summary_text.delta':
    case 'response.reasoning_text.delta': {
      const text = stringOf(event.delta) ?? ''
      if (text === '') return
      if (state.reasoningIndex === null) {
        state.reasoningIndex = 1
        yield { type: 'block-start', index: 1, blockType: 'reasoning' }
      }
      state.reasoning += text
      yield { type: 'reasoning-delta', index: 1, text }
      return
    }
    case 'response.function_call_arguments.delta': {
      const key = stringOf(event.item_id) ?? ''
      const entry = state.toolBlocks.get(key)
      const delta = stringOf(event.delta) ?? ''
      if (entry === undefined || delta === '') return
      entry.arguments += delta
      yield {
        type: 'tool-call-delta',
        index: entry.index,
        id: brandString<ToolCallId>(entry.id),
        ...(entry.name !== '' ? { name: entry.name } : {}),
        argumentsDelta: delta,
      }
      return
    }
    case 'response.completed':
    case 'response.incomplete': {
      const response = (event.response ?? {}) as Record<string, unknown>
      const usage = response.usage as Record<string, unknown> | undefined
      if (usage !== undefined) {
        const cached = numberOf((usage.input_tokens_details as Record<string, unknown> | undefined)?.cached_tokens) ?? 0
        const input = numberOf(usage.input_tokens) ?? 0
        const reasoningTokens = numberOf((usage.output_tokens_details as Record<string, unknown> | undefined)?.reasoning_tokens)
        state.usage = {
          inputTokens: Math.max(0, input - cached),
          outputTokens: numberOf(usage.output_tokens) ?? 0,
          ...(cached > 0 ? { cacheReadTokens: cached } : {}),
          ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
        }
      }
      if (type === 'response.incomplete') state.incomplete = true
      const status = stringOf(response.status)
      if (status !== undefined) state.finish = status
      return
    }
    default:
      return
  }
}

/**
 * Fold one responses status into a harness finish reason.
 * @param reason - the raw status.
 * @param incomplete - whether the response stopped early.
 * @param hadToolCalls - whether any function_call item was produced.
 * @returns the finish reason.
 */
function finishOf(reason: string | null, incomplete: boolean, hadToolCalls: boolean): FinishReason {
  if (hadToolCalls) return { kind: 'tool-calls' }
  if (incomplete || reason === 'incomplete') return { kind: 'max-tokens' }
  return { kind: 'stop' }
}

/**
 * Parse one streamed responses response into harness chunks.
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
    toolBase: 2, toolBlocks: new Map(), usage: null, finish: null, incomplete: false,
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
  if (state.usage !== null) yield { type: 'usage', usage: state.usage }
  yield {
    type: 'finish',
    reason: finishOf(state.finish, state.incomplete, state.toolBlocks.size > 0),
  }
}
