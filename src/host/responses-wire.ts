/**
 * The OpenAI Responses wire: `POST /v1/responses`, whose SSE stream speaks in
 * typed events (`response.output_text.delta`, `response.function_call_arguments.delta`,
 * …) rather than chat deltas.
 *
 * @module
 */
import { brandString } from '@deepseek-ai/dsh-brand'
import { gatewayError, streamFailure } from './wire-error.ts'
import type {
  FinishReason, GenerateOptions, ReplayEnvelope, RequestMessage, StreamChunk, ToolCallBlock, ToolCallId, TokenUsage,
} from '@deepseek-ai/dsh-llm'
import { asArray, asObject, numberOf, parseJsonObject, sseData, stringOf } from './sse.ts'
import { decodeRoute } from './route-id.ts'
import { sessionKeyOf } from './session-key.ts'
import { wireCallId } from './wire-call-id.ts'
import { dataUrlOf, imageOf, imagesIn } from './wire-images.ts'
import type { WireImage, WireImages } from './wire-images.ts'

/** One responses input item, as sent. */
type InputItem = Record<string, unknown>

/** The replay envelope kind this wire writes and reads. */
const REPLAY_KIND = 'neartoken-responses'

/** The only envelope version this build understands. */
const REPLAY_VERSION = 1

/**
 * One reasoning item, reduced to what a later request sends back.
 *
 * The upstream issues the ciphertext on every turn; a client that keeps it can
 * hand the turn's reasoning back verbatim, which is what this wire stores it
 * for.
 */
interface ReasoningItem {
  /** The upstream item id, when the wire sent one. */
  id?: string
  /** The visible summary entries, exactly as the upstream wrote them. */
  summary: { type: 'summary_text'; text: string }[]
  /** The opaque ciphertext that makes the item replayable. */
  encryptedContent: string
}

/** Per-block replay metadata, index-aligned with the blocks the stream emitted. */
type ReplayBlock = { type: 'text' | 'tool-call' } | ({ type: 'reasoning' } & ReasoningItem)

/** What a stored envelope must match before this request may replay it. */
interface ReplayGate {
  /** The provider route this request goes to. */
  provider: string
  /** The model this request asks for. */
  model: string
}

/**
 * Read one summary list off the wire or out of a stored envelope.
 * @param value - the candidate summary value.
 * @returns the entries, or undefined when the value is not a summary list.
 */
function summaryOf(value: unknown): ReasoningItem['summary'] | undefined {
  if (!Array.isArray(value)) return undefined
  const summary: ReasoningItem['summary'] = []
  for (const raw of asArray(value)) {
    const entry = asObject(raw)
    const text = stringOf(entry?.text)
    // Only the one summary kind this wire echoes back: an entry of another kind
    // is not something a replay may relabel.
    if (entry?.type !== 'summary_text' || text === undefined) return undefined
    summary.push({ type: 'summary_text', text })
  }
  return summary
}

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
 * The reasoning items one assistant turn hands back, ready to send.
 *
 * Nothing is reconstructed here: the turn's own ciphertext is read out of its
 * replay state. An envelope this build cannot use — another wire's kind,
 * another version, another provider route, another model, or one whose
 * ciphertext is missing — is dropped whole, because a reasoning item without
 * its ciphertext is worse than none at all.
 * @param message - the durable assistant message.
 * @param gate - the provider route and model this request asks for.
 * @returns the reasoning items in upstream order; empty when nothing replays.
 */
function replayItems(message: RequestMessage, gate: ReplayGate): InputItem[] {
  const source = (message as {
    source?: { kind?: string; provider?: string; model?: string; replayState?: unknown }
  }).source
  if (source?.kind !== 'model' || source.replayState === undefined) return []
  // The gate names the bare model, because that is what the request asks the
  // upstream for. The durable message records the catalog id it was chosen
  // from, which still carries the group prefix the request never sees — so
  // the two are decoded before they are compared. Comparing them raw is how a
  // turn chosen from a group stopped replaying at all.
  const recorded = decodeRoute(source.model ?? '').model
  if (source.provider !== gate.provider || recorded !== gate.model) return []
  const envelope = asObject(source.replayState)
  const response = asObject(envelope?.response)
  if (response?.kind !== REPLAY_KIND || response.version !== REPLAY_VERSION) return []
  const items: InputItem[] = []
  for (const raw of asArray(envelope?.blocks)) {
    const block = asObject(raw)
    if (block?.type !== 'reasoning') continue
    const encryptedContent = stringOf(block.encryptedContent)
    const summary = summaryOf(block.summary)
    if (encryptedContent === undefined || encryptedContent === '' || summary === undefined) return []
    // The id travels with the item whenever the upstream issued one. It is the
    // upstream's own name for the item, not a handle into server-side state:
    // the request asks for store:false, so the ciphertext is the whole of what
    // makes the item replayable. An item that arrived without an id is sent
    // without one, never with an empty placeholder.
    const id = stringOf(block.id)
    items.push({
      type: 'reasoning',
      ...id === undefined || id === '' ? {} : { id },
      summary,
      encrypted_content: encryptedContent,
    })
  }
  return items
}

/**
 * Map one harness message onto its responses input items.
 *
 * An assistant turn that both speaks and calls tools expands to one message item
 * followed by one `function_call` item per call. Its reasoning item goes back
 * ahead of both, which is the order the upstream answered in.
 * @param message - one conversation message.
 * @param gate - the provider route and model this request asks for.
 * @returns the items, empty when the message carries nothing.
 */
function serializeMessage(message: RequestMessage, gate: ReplayGate, images: WireImages = new Map()): InputItem[] {
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
      const turn: InputItem[] = text === '' ? [] : [{ role: 'assistant', content: text }]
      for (const block of content) {
        if (typeof block !== 'object' || block === null) continue
        const call = block as Partial<ToolCallBlock> & { type?: string }
        if (call.type !== 'tool-call') continue
        turn.push({
          type: 'function_call',
          call_id: call.id === undefined ? undefined : wireCallId(String(call.id)),
          name: call.name,
          arguments: call.arguments ?? '',
        })
      }
      return turn.length === 0 ? [] : [...replayItems(message, gate), ...turn]
    }
    case 'tool':
      return [{ type: 'function_call_output', call_id: wireCallId(String(message.toolCallId)), output: textOf(content) }]
    default:
      return []
  }
}

/**
 * Build the user item carrying the pictures a run of tool results returned.
 *
 * A function_call_output holds a string only, so the pictures follow as input
 * the model reads the same way it reads a pasted screenshot.
 * @param pictures - the run's pictures, in tool-result order.
 * @returns one user item naming them and holding their bytes.
 */
function toolImagesItem(pictures: readonly WireImage[]): InputItem {
  return {
    role: 'user',
    content: [
      { type: 'input_text', text: 'The tool results above included these images:' },
      ...pictures.map(image => ({ type: 'input_image', image_url: dataUrlOf(image) })),
    ],
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
  const pending: WireImage[] = []
  const gate: ReplayGate = { provider: options.provider, model }
  for (const message of options.messages) {
    // A function_call_output is a string. The pictures an uninterrupted run of
    // tool results returned follow the last one, so a parallel batch keeps its
    // tool items together instead of splitting them with a user item.
    if (pending.length > 0 && message.role !== 'tool') {
      input.push(toolImagesItem(pending))
      pending.length = 0
    }
    if (message.role === 'tool') pending.push(...imagesIn(message.content as readonly unknown[], images))
    input.push(...serializeMessage(message, gate, images))
  }
  if (pending.length > 0) input.push(toolImagesItem(pending))
  // store:false keeps the turn on the client, and `include` is what makes the
  // upstream emit the ciphertext at all: an upstream that was not asked may
  // answer with no reasoning item, and a turn without ciphertext cannot be
  // replayed — a delivery that requires the ciphertext refuses the record too.
  // Only a model that took a reasoning effort is asked; the include names a
  // reasoning field an unasked model has nothing to put in.
  const body: Record<string, unknown> = {
    model,
    input,
    stream: true,
    store: false,
    ...options.reasoningEffort === undefined ? {} : { include: ['reasoning.encrypted_content'] },
  }
  const affinityKey = sessionKeyOf(options)
  if (affinityKey !== undefined) body.prompt_cache_key = affinityKey
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
  /** The turn's finished reasoning item, kept to replay the next turn's history. */
  reasoningItem: ReasoningItem | null
  /** The (item, part) pair the last summary delta belonged to. */
  summaryPart: string | null
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
 * Read one wire reasoning item down to what a replay sends back.
 * @param item - the wire's `item` or one entry of `response.output`.
 * @returns the item, or undefined when it carries no ciphertext or no summary.
 */
function reasoningItemOf(item: Record<string, unknown>): ReasoningItem | undefined {
  const encryptedContent = stringOf(item.encrypted_content)
  const summary = summaryOf(item.summary)
  if (encryptedContent === undefined || encryptedContent === '' || summary === undefined) return undefined
  const id = stringOf(item.id)
  return { ...id === undefined ? {} : { id }, summary, encryptedContent }
}

/**
 * Build the envelope this stream stores for the next turn.
 *
 * One entry per emitted block, in the same order and at the same positions, so
 * assembly can prune a block and its entry together. Only the reasoning block
 * carries anything the next request needs.
 * @param state - the finished assembly state.
 * @param item - the reasoning item the wire returned this turn.
 * @returns the versioned envelope.
 */
function replayOf(state: Assembly, item: ReasoningItem): ReplayEnvelope {
  const blocks = new Map<number, ReplayBlock>()
  if (state.text !== null) blocks.set(state.text.index, { type: 'text' })
  if (state.reasoning !== null) blocks.set(state.reasoning.index, { type: 'reasoning', ...item })
  for (const block of state.toolBlocks.values()) blocks.set(block.index, { type: 'tool-call' })
  const entries = [...blocks.entries()].sort(([left], [right]) => left - right)
  // A turn whose reasoning never streamed a visible summary still has an item
  // worth handing back: the request sends it first regardless of a position it
  // never occupied, so it leads the list.
  if (state.reasoning === null) entries.unshift([-1, { type: 'reasoning', ...item }])
  return {
    response: { kind: REPLAY_KIND, version: REPLAY_VERSION },
    blocks: entries.map(([, block]) => block),
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
      if (stringOf(item.type) === 'reasoning') {
        // The finished item is where the ciphertext arrives, and the turn it
        // belongs to is the one this stream is still assembling.
        state.reasoningItem = reasoningItemOf(item) ?? state.reasoningItem
        return
      }
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
    case 'response.reasoning_summary_part.added': {
      // Every summary part is a thought of its own. Concatenating the deltas of
      // two parts runs them together into one unreadable line — the upstream
      // writes no separator because a part boundary is the separator — so one
      // is inserted here, once per part, before its text arrives.
      const part = `${stringOf(event.item_id) ?? ''}:${numberOf(event.summary_index) ?? 0}`
      if (state.summaryPart !== null && state.summaryPart !== part && state.reasoning !== null) {
        state.reasoning.body += '\n\n'
        yield { type: 'reasoning-delta', index: state.reasoning.index, text: '\n\n' }
      }
      state.summaryPart = part
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
      // The terminal event repeats the whole output, so a turn whose
      // reasoning item never arrived as its own `output_item.done` is still
      // replayed from here.
      if (state.reasoningItem === null) {
        for (const raw of asArray(response.output)) {
          const item = asObject(raw)
          if (item === undefined || stringOf(item.type) !== 'reasoning') continue
          state.reasoningItem = reasoningItemOf(item) ?? null
          if (state.reasoningItem !== null) break
        }
      }
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
      throw streamFailure(message)
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
    throw gatewayError(detail, response.status, response.headers)
  }
  const state: Assembly = {
    text: null,
    reasoning: null,
    reasoningItem: null,
    summaryPart: null,
    toolBlocks: new Map(),
    nextIndex: 0,
    usage: null,
    status: null,
    incomplete: false,
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
  const reason = finishOf(state)
  // The envelope is worth storing whenever the turn has a reasoning item to
  // hand back. A visible summary is not the test: an upstream may stream the
  // item only with its terminal events, and requiring the streamed block threw
  // away exactly those turns — the ones whose ciphertext was still good.
  const replay = state.reasoningItem === null ? undefined : replayOf(state, state.reasoningItem)
  yield replay === undefined ? { type: 'finish', reason } : { type: 'finish', reason, replayState: replay }
}
