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
import { asObject, numberOf, parseJsonObject, sseData, stringOf } from './sse.ts'
import { dataUrlOf, imageOf } from './wire-images.ts'
import type { WireImages } from './wire-images.ts'

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
 * Map one harness message onto its responses input items.
 *
 * An assistant turn that both speaks and calls tools expands to one message item
 * followed by one `function_call` item per call.
 * @param message - one conversation message.
 * @returns the items, empty when the message carries nothing.
 */
function serializeMessage(message: RequestMessage, images: WireImages = new Map()): InputItem[] {
  const content = message.content as readonly unknown[]
  switch (message.role) {
    case 'user':
    case 'system':
    case 'developer': {
      const text = textOf(content)
      const parts: Record<string, unknown>[] = []
      if (text !== '') parts.push({ type: 'input_text', text })
      // The responses API names its own text and image part types.
      for (const block of content) {
        const image = imageOf(block, images)
        if (image !== undefined) parts.push({ type: 'input_image', image_url: dataUrlOf(image) })
      }
      const hasImage = parts.some(part => part.type === 'input_image')
      return parts.length === 0 ? [] : [{ role: 'user', content: hasImage ? parts : text }]
    }
    case 'assistant': {
      const text = textOf(content)
      const items: InputItem[] = text === '' ? [] : [{ role: 'assistant', content: text }]
      for (const block of content) {
        if (typeof block !== 'object' || block === null) continue
        const call = block as Partial<ToolCallBlock> & { type?: string }
        if (call.type !== 'tool-call') continue
        items.push({
          type: 'function_call',
          call_id: call.id,
          name: call.name,
          arguments: call.arguments ?? '',
        })
      }
      return items
    }
    case 'tool':
      return [{ type: 'function_call_output', call_id: message.toolCallId, output: textOf(content) }]
    default:
      return []
  }
}

/**
 * Serialize one harness request into a responses body.
 * @param options - the harness request.
 * @param model - the real model id the provider should route to.
 * @returns the ready-to-JSON body object.
 */
export function serializeRequest(
  options: GenerateOptions, model: string, images: WireImages = new Map(),
): Record<string, unknown> {
  const input: InputItem[] = []
  for (const message of options.messages) input.push(...serializeMessage(message, images))
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

/** One block being assembled, keyed by the wire's item id. */
interface OpenBlock {
  index: number
  kind: 'text' | 'reasoning' | 'tool-call'
  id: string
  name: string
  body: string
}

/** Accumulator state for one in-flight responses stream. */
interface Assembly {
  text: OpenBlock | null
  reasoning: OpenBlock | null
  /** Tool calls keyed by the wire item id that owns their argument stream. */
  toolBlocks: Map<string, OpenBlock>
  nextIndex: number
  usage: TokenUsage | null
  status: string | null
  incomplete: boolean
}

/**
 * Allocate the next block index.
 * @param state - the live assembly state.
 * @param kind - the block kind being opened.
 * @returns the new block.
 */
function open(state: Assembly, kind: OpenBlock['kind']): OpenBlock {
  const block: OpenBlock = { index: state.nextIndex, kind, id: '', name: '', body: '' }
  state.nextIndex += 1
  return block
}

/**
 * Fold one responses usage object into harness token accounting.
 * @param value - the raw `response.usage` value.
 * @returns the usage, or undefined when the field is absent or not an object.
 */
function usageOf(value: unknown): TokenUsage | undefined {
  const usage = asObject(value)
  if (usage === undefined) return undefined
  const cached = numberOf(asObject(usage.input_tokens_details)?.cached_tokens) ?? 0
  const input = numberOf(usage.input_tokens) ?? 0
  const reasoningTokens = numberOf(asObject(usage.output_tokens_details)?.reasoning_tokens)
  const total = numberOf(usage.total_tokens)
  return {
    inputTokens: Math.max(0, input - cached),
    outputTokens: numberOf(usage.output_tokens) ?? 0,
    ...(total !== undefined ? { totalTokens: total } : {}),
    ...(cached > 0 ? { cacheReadTokens: cached } : {}),
    ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
  }
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
      const item = asObject(event.item) ?? {}
      if (stringOf(item.type) !== 'function_call') return
      const key = stringOf(item.id) ?? `call_${state.toolBlocks.size}`
      const block: OpenBlock = {
        ...open(state, 'tool-call'),
        id: stringOf(item.call_id) ?? key,
        name: stringOf(item.name) ?? '',
      }
      state.toolBlocks.set(key, block)
      yield { type: 'block-start', index: block.index, blockType: 'tool-call' }
      return
    }
    case 'response.output_item.done': {
      // Some upstreams only publish the finished arguments here.
      const item = asObject(event.item) ?? {}
      if (stringOf(item.type) !== 'function_call') return
      const key = stringOf(item.id) ?? ''
      const block = state.toolBlocks.get(key)
      const args = stringOf(item.arguments)
      if (block === undefined || args === undefined || args === '' || block.body !== '') return
      block.body = args
      yield {
        type: 'tool-call-delta',
        index: block.index,
        id: brandString<ToolCallId>(block.id),
        ...(block.name !== '' ? { name: block.name } : {}),
        argumentsDelta: args,
      }
      return
    }
    case 'response.output_text.delta': {
      const text = stringOf(event.delta) ?? ''
      if (text === '') return
      if (state.text === null) {
        state.text = open(state, 'text')
        yield { type: 'block-start', index: state.text.index, blockType: 'text' }
      }
      state.text.body += text
      yield { type: 'text-delta', index: state.text.index, text }
      return
    }
    case 'response.reasoning_summary_text.delta':
    case 'response.reasoning_text.delta': {
      const text = stringOf(event.delta) ?? ''
      if (text === '') return
      if (state.reasoning === null) {
        state.reasoning = open(state, 'reasoning')
        yield { type: 'block-start', index: state.reasoning.index, blockType: 'reasoning' }
      }
      state.reasoning.body += text
      yield { type: 'reasoning-delta', index: state.reasoning.index, text }
      return
    }
    case 'response.function_call_arguments.delta': {
      const block = state.toolBlocks.get(stringOf(event.item_id) ?? '')
      const delta = stringOf(event.delta) ?? ''
      if (block === undefined || delta === '') return
      block.body += delta
      yield {
        type: 'tool-call-delta',
        index: block.index,
        id: brandString<ToolCallId>(block.id),
        ...(block.name !== '' ? { name: block.name } : {}),
        argumentsDelta: delta,
      }
      return
    }
    case 'response.completed':
    case 'response.incomplete': {
      const response = asObject(event.response) ?? {}
      const usage = usageOf(response.usage)
      if (usage !== undefined) state.usage = usage
      if (type === 'response.incomplete') state.incomplete = true
      const status = stringOf(response.status)
      if (status !== undefined) state.status = status
      return
    }
    case 'response.failed':
    case 'error': {
      const response = asObject(event.response)
      const error = asObject(event.error) ?? asObject(response?.error)
      const message = stringOf(error?.message) ?? stringOf(response?.status) ?? 'responses stream failed'
      throw new LlmError(`NearToken answered with a stream failure: ${message.slice(0, 500)}`, 'PROVIDER_ERROR')
    }
    default:
      return
  }
}

/**
 * Fold one responses outcome into a harness finish reason.
 *
 * An incomplete response is reported as truncation even when a tool call was in
 * flight: its arguments are partial, and the harness drops tool calls it cannot
 * dispatch safely.
 * @param state - the finished assembly state.
 * @returns the finish reason.
 */
function finishOf(state: Assembly): FinishReason {
  if (state.incomplete || state.status === 'incomplete') return { kind: 'max-tokens' }
  if (state.toolBlocks.size > 0) return { kind: 'tool-calls' }
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
    text: null, reasoning: null, toolBlocks: new Map(), nextIndex: 0, usage: null, status: null, incomplete: false,
  }
  for await (const payload of sseData(response, signal)) yield* consume(payload, state)
  if (state.text !== null) {
    yield { type: 'block-end', index: state.text.index, block: { type: 'text', text: state.text.body } }
  }
  if (state.reasoning !== null) {
    yield {
      type: 'block-end',
      index: state.reasoning.index,
      block: { type: 'reasoning', text: state.reasoning.body },
    }
  }
  for (const block of state.toolBlocks.values()) {
    yield {
      type: 'block-end',
      index: block.index,
      block: {
        type: 'tool-call',
        id: brandString<ToolCallId>(block.id),
        name: block.name,
        arguments: block.body,
      },
    }
  }
  if (state.usage !== null) yield { type: 'usage', usage: state.usage }
  yield { type: 'finish', reason: finishOf(state) }
}
