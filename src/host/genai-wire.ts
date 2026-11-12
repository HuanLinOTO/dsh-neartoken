/**
 * The Google genai wire: `models/{model}:streamGenerateContent`, whose
 * `candidates[0].content.parts` arrive one SSE frame at a time.
 *
 * Function calls come back as whole `functionCall` parts rather than token
 * deltas, so each one is emitted as a complete tool-call block. Sending a tool
 * result back requires the function's own name, which the harness tool message
 * does not carry: it is looked up from the assistant turn that called it.
 *
 * @module
 */
import { brandString } from '@deepseek-ai/dsh-brand'
import { gatewayError } from './wire-error.ts'
import type {
  FinishReason, GenerateOptions, ReplayEnvelope, RequestMessage, StreamChunk, ToolCallBlock, ToolCallId,
  TokenUsage, ToolResultMessage,
} from '@deepseek-ai/dsh-llm'
import { asArray, asObject, numberOf, parseJsonObject, sseData, stringOf } from './sse.ts'
import { wireCallId } from './wire-call-id.ts'
import { imageOf, imagesIn } from './wire-images.ts'
import type { WireImages } from './wire-images.ts'

/** One genai content object, as sent. */
type WireContent = Record<string, unknown>

/** The replay envelope kind this wire writes and reads. */
const REPLAY_KIND = 'neartoken-genai'

/** The only envelope version this build understands. */
const REPLAY_VERSION = 1

/**
 * The signature a model turn must hand back on one of its calls.
 *
 * Gemini 3 and later validate every replayed model turn that called a
 * function: a turn whose call parts carry no `thoughtSignature` is refused
 * with 400 "Function call is missing a thought_signature in functionCall
 * parts". The value is opaque and cannot be derived, so it is kept exactly as
 * the upstream issued it and never synthesised.
 *
 * The envelope's block entries are index-aligned with the turn's content
 * blocks, because the harness drops a whole envelope whose entries do not line
 * up with the blocks it assembled. An entry of another wire, another version,
 * or the wrong length is therefore ignored entire.
 *
 * The turn is deliberately not gated on provider or model, unlike the messages
 * and responses wires: live probes showed one signature staying valid across
 * requests and across Gemini models, while a turn that dropped a valid
 * signature fails outright. Gating here would manufacture the failure the
 * envelope exists to prevent.
 * @param message - one conversation message.
 * @returns one entry per content block, or undefined when nothing replays.
 */
function replayBlocksOf(message: RequestMessage): readonly unknown[] | undefined {
  const source = (message as { source?: { kind?: string, replayState?: unknown } }).source
  if (source?.kind !== 'model' || source.replayState === undefined) return undefined
  const envelope = asObject(source.replayState)
  const response = asObject(envelope?.response)
  if (response?.kind !== REPLAY_KIND || response.version !== REPLAY_VERSION) return undefined
  return asArray(envelope?.blocks)
}

/**
 * Put each turn's own signature back on the call part it was issued for.
 *
 * The signature belongs on a `functionCall` part of the turn it was issued
 * for — a signature parked on a part of its own is refused, while any call
 * part of the turn accepts it. Blocks pair by position, so a batch keeps its
 * pairing even when two calls name the same function.
 * @param message - the durable assistant turn.
 * @param content - its content blocks, in the order the turn streamed them.
 * @param parts - its parts, already in wire order.
 * @param callSlot - part index for each tool-call, keyed by its content index.
 */
function attachSignatures(
  message: RequestMessage, content: readonly unknown[], parts: WireContent[],
  callSlot: ReadonlyMap<number, number>,
): void {
  const blocks = replayBlocksOf(message)
  // The entries pair with the blocks the harness assembled; a length mismatch
  // means this build cannot tell which call a signature belongs to, and a
  // guess would vouch for a call the upstream never signed.
  if (blocks === undefined || blocks.length !== content.length) return
  for (const [index, slot] of callSlot) {
    const block = asObject(blocks[index])
    if (block?.type !== 'tool-call') continue
    const signature = stringOf(block.signature)
    if (signature === undefined || signature === '') continue
    parts[slot].thoughtSignature = signature
  }
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
 * Collect every tool call name by its call id across the conversation.
 *
 * A genai `functionResponse` is matched to its call by function name, while the
 * harness tool message only carries the call id, so the name has to be recovered
 * from the assistant turn that issued it.
 * @param messages - the whole conversation.
 * @returns call id to function name.
 */
function toolNamesOf(messages: readonly RequestMessage[]): Map<string, string> {
  const names = new Map<string, string>()
  for (const message of messages) {
    if (message.role !== 'assistant') continue
    for (const block of message.content as readonly unknown[]) {
      if (typeof block !== 'object' || block === null) continue
      const call = block as Partial<ToolCallBlock> & { type?: string }
      if (call.type !== 'tool-call') continue
      if (call.id !== undefined && call.name !== undefined) names.set(String(call.id), call.name)
    }
  }
  return names
}

/**
 * Map one harness message onto its genai form.
 * @param message - one conversation message.
 * @param toolNames - call id to function name, for tool results.
 * @param images - the request's inlined images.
 * @param callIds - whether the model matches a response to its call by id.
 * @returns the wire content, or undefined when it carries nothing.
 */
function serializeMessage(
  message: RequestMessage, toolNames: Map<string, string>, images: WireImages = new Map(),
  callIds = false,
): WireContent | undefined {
  const content = message.content as readonly unknown[]
  switch (message.role) {
    case 'user':
    case 'system':
    case 'developer': {
      const text = textOf(content)
      const parts: Record<string, unknown>[] = []
      if (text !== '') parts.push({ text })
      // generateContent takes inline bytes under its own camelCase member.
      for (const block of content) {
        const image = imageOf(block, images)
        if (image !== undefined) parts.push({ inlineData: { mimeType: image.mediaType, data: image.data } })
      }
      return parts.length === 0 ? undefined : { role: 'user', parts }
    }
    case 'assistant': {
      const parts: Record<string, unknown>[] = []
      const callSlot = new Map<number, number>()
      const text = textOf(content)
      if (text !== '') parts.push({ text })
      content.forEach((raw, index) => {
        if (typeof raw !== 'object' || raw === null) return
        const call = raw as Partial<ToolCallBlock> & { type?: string }
        if (call.type !== 'tool-call') return
        let args: unknown = {}
        try { args = call.arguments === undefined || call.arguments === '' ? {} : JSON.parse(call.arguments) } catch { args = {} }
        const functionCall: Record<string, unknown> = { name: call.name, args }
        if (callIds && call.id !== undefined) functionCall.id = wireCallId(String(call.id))
        callSlot.set(index, parts.length)
        parts.push({ functionCall })
      })
      // A turn that called a tool only replays when it hands its own signature
      // back; a signature this build never stored is not replaced with a
      // synthetic one, so the upstream refuses the turn instead of the plugin
      // silently vouching for a call it cannot sign for.
      if (callSlot.size > 0) attachSignatures(message, content, parts, callSlot)
      return parts.length === 0 ? undefined : { role: 'model', parts }
    }
    case 'tool':
      return { role: 'user', parts: toolPartsOf(message, toolNames, images, callIds) }
    default:
      return undefined
  }
}

/**
 * The parts one tool result contributes to the user turn that answers a call.
 *
 * A functionResponse carries JSON, not bytes: a picture a tool returned follows
 * as its own inlineData part in the same user turn.
 * @param message - the harness tool message.
 * @param toolNames - call id to function name.
 * @param images - the request's inlined images.
 * @param callIds - whether the model matches a response to its call by id.
 * @returns the parts, starting with the functionResponse.
 */
function toolPartsOf(
  message: ToolResultMessage, toolNames: Map<string, string>, images: WireImages, callIds: boolean,
): Record<string, unknown>[] {
  const content = message.content as readonly unknown[]
  const callId = String(message.toolCallId)
  const name = toolNames.get(callId) ?? callId
  const functionResponse: Record<string, unknown> = { name, response: { result: textOf(content) } }
  // Without an id a batch that called the same function twice is answered by
  // name alone, which the model cannot tell apart.
  if (callIds) functionResponse.id = wireCallId(callId)
  const parts: Record<string, unknown>[] = [{ functionResponse }]
  for (const image of imagesIn(content, images)) {
    parts.push({ inlineData: { mimeType: image.mediaType, data: image.data } })
  }
  return parts
}

/**
 * Thinking budget for one harness reasoning effort.
 *
 * genai takes a token budget rather than an effort name. Levels are only
 * advertised for models whose catalog entry lists them, so a model that cannot
 * think never receives this field.
 * @param effort - the harness effort id.
 * @returns the budget in tokens, or undefined when the effort is not a level.
 */
function thinkingBudget(effort: string): number | undefined {
  switch (effort) {
    case 'minimal': return 1024
    case 'low': return 2048
    case 'medium': return 8192
    case 'high': return 16384
    case 'xhigh': return 24576
    case 'max': return 32768
    default: return undefined
  }
}

/**
 * Whether a model takes a thinking level instead of a token budget.
 *
 * Gemini 4 dropped `thinkingBudget`; sending one answers 400 "Use thinking
 * level instead". The level names it accepts are the effort ids themselves.
 * @param model - the bare model id.
 * @returns true for the level vocabulary.
 */
function usesThinkingLevel(model: string): boolean {
  const major = /gemini-(\d+)/i.exec(model)?.[1]
  return major !== undefined && Number(major) >= 4
}

/**
 * Whether a model takes an id on its function calls and responses.
 *
 * Gemini 3 added `id` to both, which is what tells two calls of the same
 * function apart inside one batch; earlier generations match on the function
 * name alone and refuse a member they do not declare. Gemma carries no version
 * in its name and stays on the older form.
 * @param model - the bare model id.
 * @returns true for the generations that declare the field.
 */
function usesCallIds(model: string): boolean {
  const major = /gemini-(\d+)/i.exec(model)?.[1]
  return major !== undefined && Number(major) >= 3
}

/**
 * The `thinkingConfig` for one request, in the vocabulary the model speaks.
 * @param model - the bare model id.
 * @param effort - the harness reasoning effort, when one was chosen.
 * @returns the config, or undefined when the model gets no thinking request.
 */
function thinkingConfigOf(model: string, effort: string | undefined): Record<string, unknown> | undefined {
  if (effort === undefined) return undefined
  // Without includeThoughts the gateway never returns a thought part, so the
  // reasoning stream would stay empty even for a thinking model.
  // The level vocabulary starts at 'low'; 'minimal' is rejected upstream.
  if (usesThinkingLevel(model)) return { thinkingLevel: effort === 'minimal' ? 'low' : effort, includeThoughts: true }
  const budget = thinkingBudget(effort)
  return budget === undefined ? undefined : { thinkingBudget: budget, includeThoughts: true }
}

/**
 * Serialize one harness request into a genai request body.
 * @param options - the harness request.
 * @param model - the real model id the provider should route to; genai carries
 * it in the URL, so the body does not repeat it.
 * @returns the ready-to-JSON body object.
 */
export function serializeRequest(
  options: GenerateOptions, model: string, images: WireImages = new Map(),
): Record<string, unknown> {
  const toolNames = toolNamesOf(options.messages)
  const callIds = usesCallIds(model)
  const contents: WireContent[] = []
  // A functionCall turn is answered by functionResponse parts in the single user
  // turn that follows it. One user turn per tool result instead leaves the counts
  // mismatched, and the gateway refuses the request with a 400 asking for as many
  // function responses as function calls.
  let batch: Record<string, unknown>[] | null = null
  for (const message of options.messages) {
    if (message.role === 'tool') {
      if (batch === null) {
        batch = []
        contents.push({ role: 'user', parts: batch })
      }
      batch.push(...toolPartsOf(message, toolNames, images, callIds))
      continue
    }
    batch = null
    const wire = serializeMessage(message, toolNames, images, callIds)
    if (wire !== undefined) contents.push(wire)
  }
  const generationConfig: Record<string, unknown> = {}
  if (options.temperature !== undefined) generationConfig.temperature = options.temperature
  if (options.maxTokens !== undefined) generationConfig.maxOutputTokens = options.maxTokens
  if (options.stop !== undefined && options.stop.length > 0) generationConfig.stopSequences = options.stop
  const thinking = thinkingConfigOf(model, options.reasoningEffort)
  if (thinking !== undefined) generationConfig.thinkingConfig = thinking
  const body: Record<string, unknown> = { contents }
  if (Object.keys(generationConfig).length > 0) body.generationConfig = generationConfig
  if (options.system !== undefined && options.system.length > 0) {
    body.systemInstruction = { parts: [{ text: options.system }] }
  }
  if (options.tools !== undefined && options.tools.length > 0) {
    body.tools = [{
      functionDeclarations: options.tools.map(tool => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      })),
    }]
  }
  return body
}

/** One block being assembled, in first-seen order. */
interface OpenBlock {
  index: number
  kind: 'text' | 'reasoning' | 'tool-call'
  id: string
  name: string
  body: string
  /** The turn's signature, on the call part that carried it. */
  signature?: string
}

/** Accumulator state for one in-flight genai stream. */
interface Assembly {
  text: OpenBlock | null
  reasoning: OpenBlock | null
  toolBlocks: OpenBlock[]
  nextIndex: number
  usage: { input: number; cached: number; output: number; reasoning: number | undefined } | null
  finish: string | null
  /** A signature that arrived before the call it belongs to did. */
  pendingSignature: string | null
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
 * Fold the per-frame usage block, keeping the last non-zero counts.
 *
 * Every frame repeats `usageMetadata`, and the running counts are cumulative;
 * a zero-valued frame must not erase what an earlier frame already reported.
 * @param state - the live assembly state.
 * @param value - the raw `usageMetadata` value.
 */
function absorbUsage(state: Assembly, value: unknown): void {
  const usage = asObject(value)
  if (usage === undefined) return
  const cached = numberOf(usage.cachedContentTokenCount) ?? 0
  const prompt = numberOf(usage.promptTokenCount) ?? 0
  const output = numberOf(usage.candidatesTokenCount) ?? 0
  const reasoning = numberOf(usage.thoughtsTokenCount)
  const previous = state.usage
  state.usage = {
    input: prompt > 0 ? Math.max(0, prompt - cached) : previous?.input ?? 0,
    cached: cached > 0 ? cached : previous?.cached ?? 0,
    output: output > 0 ? output : previous?.output ?? 0,
    reasoning: reasoning !== undefined && reasoning > 0 ? reasoning : previous?.reasoning,
  }
}

/**
 * Fold one genai frame into the assembly state.
 * @param payload - one SSE data payload.
 * @param state - the live assembly state.
 * @returns zero or more harness chunks.
 */
function* consume(payload: string, state: Assembly): Generator<StreamChunk> {
  const frame = parseJsonObject(payload)
  if (frame === undefined) return
  absorbUsage(state, frame.usageMetadata)
  const candidate = asObject(asArray(frame.candidates)[0])
  if (candidate === undefined) return
  for (const entry of asArray(asObject(candidate.content)?.parts)) {
    const part = asObject(entry)
    if (part === undefined) continue
    // The signature is what makes this turn replayable at all. It rides on the
    // turn's first call part, and can also arrive on a part of its own that
    // holds nothing else, so it is read before either part shape is dispatched.
    const raw = stringOf(part.thoughtSignature)
    const issued = raw === undefined || raw === '' ? null : raw
    const text = stringOf(part.text)
    const thought = part.thought === true
    if (text !== undefined && text.length > 0) {
      if (thought) {
        if (state.reasoning === null) {
          state.reasoning = open(state, 'reasoning')
          yield { type: 'block-start', index: state.reasoning.index, blockType: 'reasoning' }
        }
        state.reasoning.body += text
        yield { type: 'reasoning-delta', index: state.reasoning.index, text }
      } else {
        if (state.text === null) {
          state.text = open(state, 'text')
          yield { type: 'block-start', index: state.text.index, blockType: 'text' }
        }
        state.text.body += text
        yield { type: 'text-delta', index: state.text.index, text }
      }
      continue
    }
    const call = asObject(part.functionCall)
    if (call === undefined) {
      if (issued !== null && state.pendingSignature === null) state.pendingSignature = issued
      continue
    }
    const name = stringOf(call.name) ?? ''
    const slot = state.toolBlocks.length
    const id = stringOf(call.id) ?? (name === '' ? `tool_${slot}` : `tool_${name}_${slot}`)
    const args = call.args === undefined ? '{}' : JSON.stringify(call.args)
    const bound = issued ?? state.pendingSignature
    const block: OpenBlock = { ...open(state, 'tool-call'), id, name, body: args }
    if (bound !== null) {
      block.signature = bound
      state.pendingSignature = null
    }
    state.toolBlocks.push(block)
    yield { type: 'block-start', index: block.index, blockType: 'tool-call' }
    yield {
      type: 'tool-call-delta',
      index: block.index,
      id: brandString<ToolCallId>(block.id),
      ...(name !== '' ? { name } : {}),
      argumentsDelta: args,
    }
  }
  const finish = stringOf(candidate.finishReason)
  if (finish !== undefined && finish !== '') state.finish = finish
}

/**
 * Fold one genai finishReason into a harness finish reason.
 * @param reason - the raw finishReason.
 * @param hadToolCalls - whether any functionCall part was produced.
 * @returns the finish reason.
 */
function finishOf(reason: string | null, hadToolCalls: boolean): FinishReason {
  if (reason === 'MAX_TOKENS') return { kind: 'max-tokens' }
  if (hadToolCalls) return { kind: 'tool-calls' }
  return { kind: 'stop' }
}

/**
 * Parse one streamed genai response into harness chunks.
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
    text: null, reasoning: null, toolBlocks: [], nextIndex: 0, usage: null, finish: null,
    pendingSignature: null,
  }
  for await (const payload of sseData(response, signal)) yield* consume(payload, state)
  // Emitted in first-seen order: genai may open a thought part before the text.
  const ordered = [
    ...(state.text === null ? [] : [state.text]),
    ...(state.reasoning === null ? [] : [state.reasoning]),
    ...state.toolBlocks,
  ].sort((left, right) => left.index - right.index)
  for (const block of ordered) {
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
      ...(state.usage.cached > 0 ? { cacheReadTokens: state.usage.cached } : {}),
      ...(state.usage.reasoning !== undefined ? { reasoningTokens: state.usage.reasoning } : {}),
    }
    yield { type: 'usage', usage }
  }
  // A signature that arrived after the last call still belongs to this turn:
  // the upstream validates the call parts, and a turn whose calls all came
  // unsigned is the shape it refuses.
  if (state.pendingSignature !== null && state.toolBlocks.length > 0 && state.toolBlocks[0].signature === undefined) {
    state.toolBlocks[0].signature = state.pendingSignature
  }
  const reason = finishOf(state.finish, state.toolBlocks.length > 0)
  // One entry per emitted block, index-aligned: the harness keeps the envelope
  // only when its entries line up with the blocks it assembled, so a shorter
  // list is dropped whole and the turn loses its signature on the next request.
  const replay: ReplayEnvelope | undefined = ordered.some(block => block.signature !== undefined)
    ? {
      response: { kind: REPLAY_KIND, version: REPLAY_VERSION },
      blocks: ordered.map(block => ({
        type: block.kind,
        ...block.signature === undefined ? {} : { signature: block.signature },
      })),
    }
    : undefined
  yield replay === undefined ? { type: 'finish', reason } : { type: 'finish', reason, replayState: replay }
}
