/**
 * The Anthropic messages wire: what a Claude model behind the gateway expects,
 * and the SSE events it answers with, folded back into harness chunks.
 *
 * Two properties of the gateway shape this module:
 *
 * - Content block indexes arrive in the order the gateway opened them, which is
 *   not fixed (a thinking block can precede the text block). Blocks are read by
 *   the index the wire sent, never by a guessed position.
 * - `message_start.usage` carries the gateway's own prompt estimate; the real
 *   counts arrive with `message_delta`. Both are read, the later one winning.
 *
 * @module
 */
import { brandString } from '@deepseek-ai/dsh-brand'
import { LlmError } from '@deepseek-ai/dsh-llm'
import type {
  FinishReason, GenerateOptions, RequestMessage, StreamChunk, ToolCallBlock, ToolCallId, TokenUsage,
} from '@deepseek-ai/dsh-llm'
import { asObject, numberOf, parseJsonObject, sseData, stringOf } from './sse.ts'
import { imageOf } from './wire-images.ts'
import type { WireImages } from './wire-images.ts'

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
 *
 * Assistant thinking blocks are not sent back: the harness ReasoningBlock
 * carries no signature, and the gateway drops a thinking block without one.
 * @param message - one conversation message.
 * @returns the wire message, or undefined when it carries nothing.
 */
function serializeMessage(message: RequestMessage, images: WireImages = new Map()): WireBlock | undefined {
  const content = message.content as readonly unknown[]
  switch (message.role) {
    case 'user':
    case 'system': {
      const text = textOf(content)
      const blocks: WireBlock[] = []
      if (text !== '') blocks.push({ type: 'text', text })
      // Anthropic takes the bytes themselves, with the media type beside them.
      for (const block of content) {
        const image = imageOf(block, images)
        if (image !== undefined) {
          blocks.push({ type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } })
        }
      }
      return blocks.length === 0 ? undefined : { role: 'user', content: blocks }
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
 * The effort the messages API accepts for one harness level.
 *
 * `minimal` is not a value the API knows; `low` is its floor.
 * @param effort - the harness effort id.
 * @returns the effort to send.
 */
function claudeEffort(effort: string): string {
  return effort === 'minimal' ? 'low' : effort
}

/**
 * Serialize one harness request into an Anthropic messages body.
 *
 * Reasoning is requested as `thinking.type = "adaptive"` with the effort in
 * `output_config`, which every Claude generation behind this gateway accepts.
 * The older `thinking.type = "enabled"` budget form is not portable: models of
 * the Claude 5 generation reject it outright ("requires adaptive thinking"),
 * and an adaptive request still works on the older ones.
 *
 * `max_tokens` is only sent when the caller set one: the gateway does not
 * require it, and inventing a cap would truncate long answers.
 * @param options - the harness request.
 * @param model - the real model id the provider should route to.
 * @returns the ready-to-JSON body object.
 */
export function serializeRequest(
  options: GenerateOptions, model: string, images: WireImages = new Map(),
): Record<string, unknown> {
  const messages: WireBlock[] = []
  for (const message of options.messages) {
    // The messages API has no system role inside the turn list; such a message
    // is folded into the user turn shape rather than dropped.
    const wire = serializeMessage(message, images)
    if (wire !== undefined) messages.push(wire)
  }
  const body: Record<string, unknown> = { model, messages, stream: true }
  if (options.reasoningEffort !== undefined) {
    body.thinking = { type: 'adaptive' }
    body.output_config = { effort: claudeEffort(options.reasoningEffort) }
  }
  if (options.maxTokens !== undefined) body.max_tokens = options.maxTokens
  if (options.temperature !== undefined) body.temperature = options.temperature
  if (options.system !== undefined && options.system.length > 0) body.system = options.system
  if (options.tools !== undefined && options.tools.length > 0) {
    body.tools = options.tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters,
    }))
  }
  if (options.stop !== undefined && options.stop.length > 0) body.stop_sequences = options.stop
  return body
}

/** One block being assembled, keyed by the index the wire gave it. */
interface OpenBlock {
  index: number
  kind: 'text' | 'reasoning' | 'tool-call'
  id: string
  name: string
  body: string
}

/** Accumulator state for one in-flight Anthropic stream. */
interface Assembly {
  /** Blocks in first-seen order, keyed by the wire's own block index. */
  blocks: Map<number, OpenBlock>
  nextIndex: number
  usage: { input: number; cacheRead: number; cacheWrite: number; output: number } | null
  finish: string | null
}

/**
 * Open (or re-open) the block a wire index refers to.
 * @param state - the live assembly state.
 * @param wireIndex - the index the wire used for this block.
 * @param kind - the block kind the wire announced.
 * @returns the block, and whether it was just opened.
 */
function open(state: Assembly, wireIndex: number, kind: OpenBlock['kind']): { block: OpenBlock; fresh: boolean } {
  const existing = state.blocks.get(wireIndex)
  if (existing !== undefined) return { block: existing, fresh: false }
  const block: OpenBlock = { index: state.nextIndex, kind, id: '', name: '', body: '' }
  state.nextIndex += 1
  state.blocks.set(wireIndex, block)
  return { block, fresh: true }
}

/**
 * Fold one Anthropic event into the assembly state.
 * @param payload - one SSE data payload.
 * @param state - the live assembly state.
 * @returns zero or more harness chunks. Text and reasoning blocks open on
 * their first non-empty delta; tool calls open on `content_block_start`, which
 * is where their id and name arrive.
 */
function* consume(payload: string, state: Assembly): Generator<StreamChunk> {
  const event = parseJsonObject(payload)
  if (event === undefined) return
  const type = stringOf(event.type)
  if (type === 'message_start') {
    const usage = asObject(asObject(event.message)?.usage) ?? {}
    state.usage = {
      input: numberOf(usage.input_tokens) ?? 0,
      cacheRead: numberOf(usage.cache_read_input_tokens) ?? 0,
      cacheWrite: numberOf(usage.cache_creation_input_tokens) ?? 0,
      output: numberOf(usage.output_tokens) ?? 0,
    }
    return
  }
  if (type === 'content_block_start') {
    const wireIndex = numberOf(event.index) ?? 0
    const block = asObject(event.content_block) ?? {}
    const kind = stringOf(block.type)
    if (kind === 'tool_use') {
      const opened = open(state, wireIndex, 'tool-call')
      if (opened.fresh) {
        opened.block.id = stringOf(block.id) ?? `tool_${wireIndex}`
        opened.block.name = stringOf(block.name) ?? ''
        yield { type: 'block-start', index: opened.block.index, blockType: 'tool-call' }
      }
      return
    }
    // Text and thinking blocks are opened by their first non-empty delta, so a
    // thinking block that arrives empty never becomes a block of its own. A
    // tool_use has to open here: its id and name only exist in this event.
    return
  }
  if (type === 'content_block_delta') {
    const wireIndex = numberOf(event.index) ?? 0
    const delta = asObject(event.delta) ?? {}
    const kind = stringOf(delta.type)
    const known = state.blocks.get(wireIndex)
    // A delta for a block the wire never opened is still delivered: the block
    // is opened here from the delta's own kind, so no content is ever dropped.
    if (kind === 'text_delta') {
      const text = stringOf(delta.text) ?? ''
      if (text === '') return
      const opened = known === undefined ? open(state, wireIndex, 'text') : { block: known, fresh: false }
      if (opened.fresh) yield { type: 'block-start', index: opened.block.index, blockType: 'text' }
      opened.block.body += text
      yield { type: 'text-delta', index: opened.block.index, text }
      return
    }
    if (kind === 'thinking_delta') {
      const text = stringOf(delta.thinking) ?? ''
      if (text === '') return
      const opened = known === undefined ? open(state, wireIndex, 'reasoning') : { block: known, fresh: false }
      if (opened.fresh) yield { type: 'block-start', index: opened.block.index, blockType: 'reasoning' }
      opened.block.body += text
      yield { type: 'reasoning-delta', index: opened.block.index, text }
      return
    }
    if (kind === 'input_json_delta') {
      const partial = stringOf(delta.partial_json) ?? ''
      if (partial === '' || known === undefined || known.kind !== 'tool-call') return
      known.body += partial
      yield {
        type: 'tool-call-delta',
        index: known.index,
        id: brandString<ToolCallId>(known.id),
        ...(known.name !== '' ? { name: known.name } : {}),
        argumentsDelta: partial,
      }
    }
    // signature_delta and other thinking metadata are not part of the harness
    // vocabulary: the ReasoningBlock has no place to keep them.
    return
  }
  if (type === 'message_delta') {
    const stop = stringOf(asObject(event.delta)?.stop_reason)
    if (stop !== undefined) state.finish = stop
    const usage = asObject(event.usage)
    if (usage === undefined || state.usage === null) return
    // The real counts land here; message_start only carried an estimate.
    state.usage.input = numberOf(usage.input_tokens) ?? state.usage.input
    state.usage.cacheRead = numberOf(usage.cache_read_input_tokens) ?? state.usage.cacheRead
    state.usage.cacheWrite = numberOf(usage.cache_creation_input_tokens) ?? state.usage.cacheWrite
    state.usage.output = numberOf(usage.output_tokens) ?? state.usage.output
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
  const state: Assembly = { blocks: new Map(), nextIndex: 0, usage: null, finish: null }
  for await (const payload of sseData(response, signal)) yield* consume(payload, state)
  for (const block of state.blocks.values()) {
    if (block.kind === 'text') {
      yield { type: 'block-end', index: block.index, block: { type: 'text', text: block.body } }
      continue
    }
    if (block.kind === 'reasoning') {
      yield { type: 'block-end', index: block.index, block: { type: 'reasoning', text: block.body } }
      continue
    }
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
