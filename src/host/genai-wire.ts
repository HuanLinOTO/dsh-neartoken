/**
 * The Google genai wire: `models/{model}:streamGenerateContent`, whose
 * `candidates[0].content.parts` arrive one SSE frame at a time.
 *
 * Function calls come back as whole `functionCall` parts rather than token
 * deltas, so each one is emitted as a complete tool-call block.
 *
 * @module
 */
import { brandString } from '@deepseek-ai/dsh-brand'
import { LlmError } from '@deepseek-ai/dsh-llm'
import type {
  FinishReason, GenerateOptions, RequestMessage, StreamChunk, ToolCallBlock, ToolCallId, TokenUsage,
} from '@deepseek-ai/dsh-llm'
import { numberOf, parseJsonObject, sseData, stringOf } from './sse.ts'

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
 * Map one harness message onto its genai form.
 * @param message - one conversation message.
 * @returns the wire content, or undefined when it carries nothing.
 */
function serializeMessage(message: RequestMessage): WireContent | undefined {
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
      return {
        role: 'user',
        parts: [{
          functionResponse: {
            name: message.toolCallId,
            response: { result: text },
          },
        }],
      }
    }
    default:
      return undefined
  }
}

/**
 * Serialize one harness request into a genai request body.
 * @param options - the harness request.
 * @param model - the real model id the provider should route to.
 * @returns the ready-to-JSON body object.
 */
export function serializeRequest(options: GenerateOptions, model: string): Record<string, unknown> {
  const contents: WireContent[] = []
  for (const message of options.messages) {
    const wire = serializeMessage(message)
    if (wire !== undefined) contents.push(wire)
  }
  const generationConfig: Record<string, unknown> = {}
  if (options.temperature !== undefined) generationConfig.temperature = options.temperature
  if (options.maxTokens !== undefined) generationConfig.maxOutputTokens = options.maxTokens
  if (options.stop !== undefined && options.stop.length > 0) generationConfig.stopSequences = options.stop
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
  // Marked so the URL builder and the body agree on the model being asked for.
  void model
  return body
}

/** Accumulator state for one in-flight genai stream. */
interface Assembly {
  reasoningIndex: number | null
  reasoning: string
  textIndex: number | null
  text: string
  toolBase: number
  toolBlocks: Map<number, { index: number; id: string; name: string; arguments: string }>
  usage: TokenUsage | null
  finish: string | null
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
  const usage = frame.usageMetadata as Record<string, unknown> | undefined
  if (usage !== undefined) {
    const cached = numberOf(usage.cachedContentTokenCount) ?? 0
    const prompt = numberOf(usage.promptTokenCount) ?? 0
    const reasoningTokens = numberOf(usage.thoughtsTokenCount)
    state.usage = {
      inputTokens: Math.max(0, prompt - cached),
      outputTokens: numberOf(usage.candidatesTokenCount) ?? 0,
      ...(cached > 0 ? { cacheReadTokens: cached } : {}),
      ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
    }
  }
  const candidate = (frame.candidates as Array<Record<string, unknown>> | undefined)?.[0]
  if (candidate === undefined) return
  const parts = ((candidate.content as { parts?: Array<Record<string, unknown>> } | undefined)?.parts) ?? []
  for (const part of parts) {
    const text = stringOf(part.text)
    const thought = part.thought === true
    if (typeof text === 'string' && text.length > 0) {
      if (thought) {
        if (state.reasoningIndex === null) {
          state.reasoningIndex = 1
          yield { type: 'block-start', index: 1, blockType: 'reasoning' }
        }
        state.reasoning += text
        yield { type: 'reasoning-delta', index: 1, text }
      } else {
        if (state.textIndex === null) {
          state.textIndex = 0
          yield { type: 'block-start', index: 0, blockType: 'text' }
        }
        state.text += text
        yield { type: 'text-delta', index: 0, text }
      }
      continue
    }
    const call = part.functionCall as Record<string, unknown> | undefined
    if (call === undefined) continue
    const name = stringOf(call.name) ?? ''
    const slot = state.toolBlocks.size
    const id = stringOf(call.id) ?? (name === '' ? `tool_${slot}` : `tool_${name}_${slot}`)
    const args = call.args === undefined ? '{}' : JSON.stringify(call.args)
    const entry = { index: state.toolBase + slot, id, name, arguments: args }
    state.toolBlocks.set(slot, entry)
    yield { type: 'block-start', index: entry.index, blockType: 'tool-call' }
    yield {
      type: 'tool-call-delta',
      index: entry.index,
      id: brandString<ToolCallId>(entry.id),
      ...(name !== '' ? { name } : {}),
      argumentsDelta: args,
    }
  }
  const reason = stringOf(candidate.finishReason)
  if (reason !== undefined && reason !== '') state.finish = reason
}

/**
 * Fold one genai finishReason into a harness finish reason.
 * @param reason - the raw finishReason.
 * @returns the finish reason.
 */
function finishOf(reason: string | null): FinishReason {
  switch (reason) {
    case 'MAX_TOKENS': return { kind: 'max-tokens' }
    default: return { kind: 'stop' }
  }
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
    reasoningIndex: null, reasoning: '', textIndex: null, text: '',
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
  yield {
    type: 'finish',
    reason: state.toolBlocks.size > 0 ? { kind: 'tool-calls' } : finishOf(state.finish),
  }
}
