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
import { LlmError } from '@deepseek-ai/dsh-llm'
import type {
  FinishReason, GenerateOptions, RequestMessage, StreamChunk, ToolCallBlock, ToolCallId, TokenUsage,
} from '@deepseek-ai/dsh-llm'
import { asArray, asObject, numberOf, parseJsonObject, sseData, stringOf } from './sse.ts'

/** One genai content object, as sent. */
type WireContent = Record<string, unknown>

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
 * @returns the wire content, or undefined when it carries nothing.
 */
function serializeMessage(message: RequestMessage, toolNames: Map<string, string>): WireContent | undefined {
  const content = message.content as readonly unknown[]
  switch (message.role) {
    case 'user':
    case 'system':
    case 'developer': {
      const text = textOf(content)
      return text === '' ? undefined : { role: 'user', parts: [{ text }] }
    }
    case 'assistant': {
      const parts: Record<string, unknown>[] = []
      const text = textOf(content)
      if (text !== '') parts.push({ text })
      for (const block of content) {
        if (typeof block !== 'object' || block === null) continue
        const call = block as Partial<ToolCallBlock> & { type?: string }
        if (call.type !== 'tool-call') continue
        let args: unknown = {}
        try { args = call.arguments === undefined || call.arguments === '' ? {} : JSON.parse(call.arguments) } catch { args = {} }
        parts.push({ functionCall: { name: call.name, args } })
      }
      return parts.length === 0 ? undefined : { role: 'model', parts }
    }
    case 'tool': {
      const text = textOf(content)
      const name = toolNames.get(String(message.toolCallId)) ?? String(message.toolCallId)
      return {
        role: 'user',
        parts: [{ functionResponse: { name, response: { result: text } } }],
      }
    }
    default:
      return undefined
  }
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
 * Serialize one harness request into a genai request body.
 * @param options - the harness request.
 * @param model - the real model id the provider should route to; genai carries
 * it in the URL, so the body does not repeat it.
 * @returns the ready-to-JSON body object.
 */
export function serializeRequest(options: GenerateOptions, model: string): Record<string, unknown> {
  const toolNames = toolNamesOf(options.messages)
  const contents: WireContent[] = []
  for (const message of options.messages) {
    const wire = serializeMessage(message, toolNames)
    if (wire !== undefined) contents.push(wire)
  }
  const generationConfig: Record<string, unknown> = {}
  if (options.temperature !== undefined) generationConfig.temperature = options.temperature
  if (options.maxTokens !== undefined) generationConfig.maxOutputTokens = options.maxTokens
  if (options.stop !== undefined && options.stop.length > 0) generationConfig.stopSequences = options.stop
  const budget = options.reasoningEffort === undefined ? undefined : thinkingBudget(options.reasoningEffort)
  if (budget !== undefined) {
    // Without includeThoughts the gateway never returns a thought part, so the
    // reasoning stream would stay empty even for a thinking model.
    generationConfig.thinkingConfig = { thinkingBudget: budget, includeThoughts: true }
  }
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
}

/** Accumulator state for one in-flight genai stream. */
interface Assembly {
  text: OpenBlock | null
  reasoning: OpenBlock | null
  toolBlocks: OpenBlock[]
  nextIndex: number
  usage: { input: number; cached: number; output: number; reasoning: number | undefined } | null
  finish: string | null
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
    if (call === undefined) continue
    const name = stringOf(call.name) ?? ''
    const slot = state.toolBlocks.length
    const id = stringOf(call.id) ?? (name === '' ? `tool_${slot}` : `tool_${name}_${slot}`)
    const args = call.args === undefined ? '{}' : JSON.stringify(call.args)
    const block: OpenBlock = { ...open(state, 'tool-call'), id, name, body: args }
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
    throw new LlmError(`NearToken answered ${response.status}: ${detail.slice(0, 500)}`, 'PROVIDER_ERROR')
  }
  const state: Assembly = {
    text: null, reasoning: null, toolBlocks: [], nextIndex: 0, usage: null, finish: null,
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
  yield { type: 'finish', reason: finishOf(state.finish, state.toolBlocks.length > 0) }
}
