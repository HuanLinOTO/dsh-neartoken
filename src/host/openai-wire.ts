/**
 * Minimal OpenAI chat-completions wire for the NearToken adapter: request
 * serialization from the harness message vocabulary and SSE response parsing
 * into `StreamChunk`s. Text, images, and tool calls round-trip; files do not
 * (a file block contributes no wire member).
 */
import { brandString } from '@deepseek-ai/dsh-brand'
import { gatewayError } from './wire-error.ts'
import type {
  FinishReason, GenerateOptions, RequestMessage, StreamChunk, ToolCallBlock, ToolCallId, TokenUsage,
} from '@deepseek-ai/dsh-llm'
import { asArray, asObject, numberOf, parseJsonObject, sseData, stringOf } from './sse.ts'
import { sessionKeyOf } from './session-key.ts'
import { dataUrlOf, imageOf } from './wire-images.ts'
import type { WireImages } from './wire-images.ts'

/** One wire-format chat message. */
type WireMessage = Record<string, unknown>

/**
 * Flatten one message's text blocks; non-text blocks contribute nothing here.
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
 * Serialize one fully-assembled request into an OpenAI chat-completions body.
 * @param options - the harness request.
 * @param model - the real model id the provider should route to.
 * @returns the ready-to-JSON body object.
 */
export function serializeRequest(
  options: GenerateOptions, model: string, images: WireImages = new Map(),
): Record<string, unknown> {
  const messages: WireMessage[] = []
  if (options.system !== undefined && options.system.length > 0) {
    messages.push({ role: 'system', content: options.system })
  }
  for (const message of options.messages) {
    const wire = serializeMessage(message, images)
    if (wire !== undefined) messages.push(wire)
  }
  const body: Record<string, unknown> = {
    model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
  }
  const affinityKey = sessionKeyOf(options)
  if (affinityKey !== undefined) body.prompt_cache_key = affinityKey
  if (options.tools !== undefined && options.tools.length > 0) {
    body.tools = options.tools.map(tool => ({
      type: 'function',
      function: { name: tool.name, description: tool.description, parameters: tool.parameters },
    }))
  }
  if (options.temperature !== undefined) body.temperature = options.temperature
  if (options.maxTokens !== undefined) body.max_tokens = options.maxTokens
  if (options.stop !== undefined && options.stop.length > 0) body.stop = options.stop
  if (options.reasoningEffort !== undefined) body.reasoning_effort = options.reasoningEffort
  return body
}

/**
 * Map one harness message onto its OpenAI wire form.
 * @param message - one conversation or user-input message.
 * @returns the wire message, or undefined for a message with nothing to send.
 */
/**
 * Build one user turn's content: plain text when it carries only text, a part
 * list once a picture has to ride along.
 * @param content - the message's content blocks.
 * @param images - the request's inlined images.
 * @returns the wire content member.
 */
function userContentOf(content: readonly unknown[], images: WireImages): string | readonly unknown[] {
  const text = textOf(content)
  const parts: unknown[] = []
  if (text !== '') parts.push({ type: 'text', text })
  for (const block of content) {
    const image = imageOf(block, images)
    if (image !== undefined) parts.push({ type: 'image_url', image_url: { url: dataUrlOf(image) } })
  }
  return parts.some(part => (part as { type?: string }).type === 'image_url') ? parts : text
}

function serializeMessage(message: RequestMessage, images: WireImages): WireMessage | undefined {
  const content = message.content as readonly unknown[]
  switch (message.role) {
    case 'system':
    case 'developer': {
      const text = textOf(content)
      return text === '' ? undefined : { role: 'system', content: text }
    }
    case 'user':
      return { role: 'user', content: userContentOf(content, images) }
    case 'assistant': {
      const toolCalls = content
        .filter((block): block is ToolCallBlock => typeof block === 'object' && block !== null
          && (block as { type?: string }).type === 'tool-call')
        .map(block => ({
          type: 'function',
          id: block.id,
          function: { name: block.name, arguments: block.arguments },
        }))
      const text = textOf(content)
      const wire: WireMessage = { role: 'assistant', content: text === '' && toolCalls.length > 0 ? null : text }
      if (toolCalls.length > 0) wire.tool_calls = toolCalls
      return wire
    }
    case 'tool':
      return { role: 'tool', tool_call_id: message.toolCallId, content: textOf(content) }
    default:
      return undefined
  }
}

/** Accumulator state for one in-flight SSE response. */
interface SseAssembly {
  textIndex: number | null
  text: string
  reasoningIndex: number | null
  reasoning: string
  toolBase: number
  toolBlocks: Map<number, { index: number; id: string; name: string; arguments: string }>
  usage: TokenUsage | null
  finish: string | null
}

/**
 * Fold one chat-completions chunk into the assembly state.
 *
 * The gateway sends `"usage": null` on every content frame and the real numbers
 * only on the last one, so the field must be read as `unknown` and discarded
 * when it is not an object.
 * @param payload - one SSE data payload.
 * @param state - the live assembly state.
 * @returns zero or more stream chunks in wire order.
 */
function* consume(payload: string, state: SseAssembly): Generator<StreamChunk> {
  const chunk = parseJsonObject(payload)
  if (chunk === undefined) return
  const usage = asObject(chunk.usage)
  if (usage !== undefined) {
    const details = asObject(usage.prompt_tokens_details)
    const cached = numberOf(details?.cached_tokens) ?? 0
    const prompt = numberOf(usage.prompt_tokens) ?? 0
    const completionDetails = asObject(usage.completion_tokens_details)
    const reasoningTokens = numberOf(completionDetails?.reasoning_tokens)
    const total = numberOf(usage.total_tokens)
    state.usage = {
      inputTokens: Math.max(0, prompt - cached),
      outputTokens: numberOf(usage.completion_tokens) ?? 0,
      ...(total !== undefined ? { totalTokens: total } : {}),
      ...(cached > 0 ? { cacheReadTokens: cached } : {}),
      ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
    }
  }
  const choice = asObject(asArrayFirst(chunk.choices))
  if (choice === undefined) return
  const delta = asObject(choice.delta) ?? {}
  const content = stringOf(delta.content)
  if (content !== undefined && content.length > 0) {
    if (state.textIndex === null) {
      state.textIndex = 0
      yield { type: 'block-start', index: 0, blockType: 'text' }
    }
    state.text += content
    yield { type: 'text-delta', index: 0, text: content }
  }
  const reasoning = stringOf(delta.reasoning_content) ?? stringOf(delta.reasoning)
  if (reasoning !== undefined && reasoning.length > 0) {
    if (state.reasoningIndex === null) {
      state.reasoningIndex = 1
      yield { type: 'block-start', index: 1, blockType: 'reasoning' }
    }
    state.reasoning += reasoning
    yield { type: 'reasoning-delta', index: 1, text: reasoning }
  }
  for (const candidate of asArray(delta.tool_calls)) {
    const call = asObject(candidate)
    if (call === undefined) continue
    const fn = asObject(call.function)
    const slot = numberOf(call.index) ?? 0
    let block = state.toolBlocks.get(slot)
    if (block === undefined) {
      block = { index: state.toolBase + slot, id: '', name: '', arguments: '' }
      state.toolBlocks.set(slot, block)
      yield { type: 'block-start', index: block.index, blockType: 'tool-call' }
    }
    const id = stringOf(call.id)
    if (id !== undefined && block.id === '') block.id = id
    const name = stringOf(fn?.name)
    if (name !== undefined && name !== '' && block.name === '') block.name = name
    const argument = stringOf(fn?.arguments)
    if (argument !== undefined && argument.length > 0) {
      block.arguments += argument
      yield {
        type: 'tool-call-delta',
        index: block.index,
        id: brandString<ToolCallId>(block.id),
        ...(block.name !== '' ? { name: block.name } : {}),
        argumentsDelta: argument,
      }
    }
  }
  const finish = stringOf(choice.finish_reason)
  if (finish !== undefined && finish.length > 0) state.finish = finish
}

/**
 * First entry of a decoded array, as an object.
 * @param value - any decoded JSON value.
 * @returns the first object, or undefined when there is none.
 */
function asArrayFirst(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : undefined
}

/**
 * Parse one streamed OpenAI chat-completions response into harness chunks.
 * @param response - the streaming fetch response.
 * @param signal - cancellation passthrough for the read loop.
 * @returns the chunk stream: block-start/delta as they arrive, then
 * block-end/usage/finish once the stream completes.
 */
export async function* parseSse(response: Response, signal: AbortSignal | undefined): AsyncGenerator<StreamChunk> {
  if (!response.ok || response.body === null) {
    const detail = await response.text().catch(() => '')
    throw gatewayError(detail, response.status, response.headers)
  }
  const state: SseAssembly = {
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
  if (state.usage !== null) yield { type: 'usage', usage: state.usage }
  yield { type: 'finish', reason: finishOf(state.finish) }
}

/**
 * @param reason - the provider's finish_reason, when it sent one.
 * @returns the harness finish reason.
 */
function finishOf(reason: string | null): FinishReason {
  switch (reason) {
    case 'tool_calls': return { kind: 'tool-calls' }
    case 'length': return { kind: 'max-tokens' }
    default: return { kind: 'stop' }
  }
}
