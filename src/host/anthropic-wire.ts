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
 * Prompt caching is explicit on this wire: Anthropic writes a cache entry only
 * where a `cache_control` breakpoint marks the end of a prefix, and charges the
 * whole prompt as fresh input without one. The harness replays the conversation
 * on every call, so the breakpoints are placed once per request over the bytes
 * the next call will reuse (see `serializeRequest`).
 *
 * The system prompt owns the `system` slot even when the query carries it as a
 * leading system-role message, which is how a loop-built request delivers it
 * (see `GenerateOptions`). Folded into the turn list instead, it would lose the
 * slot the model weights as system, and its breakpoint would be the moving tail
 * of the message list rather than a fixed end of the prompt prefix.
 *
 * @module
 */
import { brandString } from '@deepseek-ai/dsh-brand'
import { gatewayError } from './wire-error.ts'
import type {
  FinishReason, GenerateOptions, RequestMessage, StreamChunk, ToolCallBlock, ToolCallId, TokenUsage,
} from '@deepseek-ai/dsh-llm'
import { sessionKeyOf } from './session-key.ts'
import { asObject, numberOf, parseJsonObject, sseData, stringOf } from './sse.ts'
import { imageOf, imagesIn } from './wire-images.ts'
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
      // A tool result is itself a block list, so the pictures a tool handed back
      // (read_image does exactly that) travel inside the result rather than being
      // flattened into its text.
      const pictures = imagesIn(content, images)
      if (pictures.length === 0) {
        return {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: message.toolCallId, content: text }],
        }
      }
      const blocks: WireBlock[] = text === '' ? [] : [{ type: 'text', text }]
      for (const image of pictures) {
        blocks.push({ type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } })
      }
      return {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: message.toolCallId, content: blocks }],
      }
    }
    default:
      return undefined
  }
}

/** How many trailing messages carry a breakpoint; with the tool and system
 * marks this stays within the four the messages API accepts per request. */
const TAIL_BREAKPOINTS = 2

/**
 * The breakpoint that marks a cacheable prefix end.
 * @returns a fresh `cache_control` value; a new object each time, so no caller
 * can mutate another block's mark through the shared one.
 */
function cacheBreakpoint(): WireBlock {
  return { type: 'ephemeral' }
}

/**
 * Mark the last block of the trailing messages as the end of a cacheable prefix.
 *
 * The next call replays every message this one sent, so the longest prefix the
 * two share ends inside the final message. The message before it is marked as
 * well: a turn that ends with a fresh user message leaves the previous call's
 * trailing breakpoint on the second-to-last message, and a mark that misses
 * costs a cache write rather than nothing.
 * @param messages - the serialized conversation, in send order.
 */
function markTailBreakpoints(messages: readonly WireBlock[]): void {
  for (const message of messages.slice(-TAIL_BREAKPOINTS)) {
    const blocks: unknown = message.content
    if (!Array.isArray(blocks) || blocks.length === 0) continue
    const last: unknown = blocks[blocks.length - 1]
    if (typeof last !== 'object' || last === null) continue
    ;(last as WireBlock).cache_control = cacheBreakpoint()
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
  let system = options.system
  for (const message of options.messages) {
    // The first system-role message supplies the system slot, which is where a
    // loop-built request puts the prompt. It is lifted out of the turn list
    // rather than folded into a user turn so the prompt stays in the slot the
    // model reads as system, and so its breakpoint ends the prompt prefix
    // instead of moving with the message tail.
    if (message.role === 'system' && system === undefined) {
      const text = textOf(message.content as readonly unknown[])
      if (text !== '') {
        system = text
        continue
      }
    }
    // The messages API has no system role inside the turn list; any later system
    // message (a prompt update) is folded into the user turn shape rather than
    // dropped, so it is read after the cached history.
    const wire = serializeMessage(message, images)
    if (wire !== undefined) messages.push(wire)
  }
  const body: Record<string, unknown> = { model, messages, stream: true }
  // The messages API has no cache key of its own; this gateway routes a Claude
  // request by `metadata.user_id` instead, and a per-session value is what
  // keeps the session's cache on one upstream account.
  const affinityKey = sessionKeyOf(options)
  if (affinityKey !== undefined) body.metadata = { user_id: affinityKey }
  if (options.reasoningEffort !== undefined) {
    // `display` decides whether the block has any text at all: a Claude 5
    // generation omits the summary unless it is asked for, and streams a
    // thinking block whose content is empty with only its signature filled in.
    // The harness has nowhere to keep a signature, so an omitted display reads
    // as "this model never thought".
    body.thinking = { type: 'adaptive', display: 'summarized' }
    body.output_config = { effort: claudeEffort(options.reasoningEffort) }
  }
  if (options.maxTokens !== undefined) body.max_tokens = options.maxTokens
  if (options.temperature !== undefined) body.temperature = options.temperature
  // A plain string cannot carry a breakpoint, and the system prompt is the most
  // reused bytes of the request: it travels as one marked text block.
  if (system !== undefined && system.length > 0) {
    body.system = [{ type: 'text', text: system, cache_control: cacheBreakpoint() }]
  }
  if (options.tools !== undefined && options.tools.length > 0) {
    const tools: WireBlock[] = options.tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters,
    }))
    // Tool definitions precede the system prompt on the wire, so the last one
    // ends the request's most stable prefix: a tool set that does not change
    // from turn to turn is read from cache for the whole session.
    const lastTool = tools[tools.length - 1]
    if (lastTool !== undefined) lastTool.cache_control = cacheBreakpoint()
    body.tools = tools
  }
  if (options.stop !== undefined && options.stop.length > 0) body.stop_sequences = options.stop
  markTailBreakpoints(messages)
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
    throw gatewayError(detail, response.status, response.headers)
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
