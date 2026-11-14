/**
 * The anti-degradation switch's two contracts: which models it serves, and what
 * one serialized request body looks like after it ran.
 */
import { describe, expect, it } from 'vitest'
import { FILE_REFERENCE_GUIDANCE, FILE_REFERENCE_GUIDANCE_ZH, translateGuidance } from './anti-degrade.ts'
import { isGemini4 } from '../protocol.ts'

/** One genai body carrying the guidance in the system instruction, a turn, and a tool description. */
function genaiBody(): Record<string, unknown> {
  return {
    systemInstruction: { parts: [{ text: `Follow these rules. ${FILE_REFERENCE_GUIDANCE}` }] },
    contents: [{ role: 'user', parts: [{ text: `@src/index.ts says: ${FILE_REFERENCE_GUIDANCE}` }] }],
    tools: [{ functionDeclarations: [{ name: 'read', description: FILE_REFERENCE_GUIDANCE, parameters: {} }] }],
  }
}

/** The text one system instruction or content part carries. */
function textAt(value: unknown): string {
  return String((value as { text?: unknown }).text ?? '')
}

describe('isGemini4', () => {
  it('serves the fourth generation and later', () => {
    expect(isGemini4('gemini-4.0-pro')).toBe(true)
    expect(isGemini4('gemini-4.5-flash')).toBe(true)
    expect(isGemini4('default::gemini-4.5-flash')).toBe(true)
  })

  it('decodes a catalog id at the separator closest to the model', () => {
    expect(isGemini4('[a::b] Gemini::gemini-4-pro')).toBe(true)
  })

  it('ignores a vendor prefix, case, and surrounding space', () => {
    expect(isGemini4('google/gemini-4.0-pro')).toBe(true)
    expect(isGemini4(' GEMINI-4-Flash ')).toBe(true)
  })

  it('leaves every other family alone', () => {
    expect(isGemini4('gemini-3.8-flash')).toBe(false)
    expect(isGemini4('gemma-4-27b')).toBe(false)
    expect(isGemini4('claude-sonnet-4.5')).toBe(false)
    expect(isGemini4('')).toBe(false)
  })
})

describe('translateGuidance', () => {
  it('rewrites the system instruction, the conversation, and the tool descriptions', () => {
    const body = JSON.parse(translateGuidance(JSON.stringify(genaiBody()))) as {
      systemInstruction: { parts: unknown[] }
      contents: { parts: unknown[] }[]
      tools: { functionDeclarations: { description: string }[] }[]
    }
    expect(textAt(body.systemInstruction.parts[0])).toBe(`Follow these rules. ${FILE_REFERENCE_GUIDANCE_ZH}`)
    expect(textAt(body.contents[0]?.parts[0])).toBe(`@src/index.ts says: ${FILE_REFERENCE_GUIDANCE_ZH}`)
    expect(body.tools[0]?.functionDeclarations[0]?.description).toBe(FILE_REFERENCE_GUIDANCE_ZH)
  })

  it('matches the paragraph through the escaping a JSON body applies to it', () => {
    // The paragraph itself quotes @"...", so inside a body it reads @\\"...\\".
    const once = JSON.stringify({ text: FILE_REFERENCE_GUIDANCE })
    expect(once).toContain('@\\"...\\"')
    expect(translateGuidance(once)).not.toContain('Tokens prefixed with @')
  })

  it('leaves a body without the guidance untouched', () => {
    const json = JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'hello' }] }], temperature: 0.2 })
    expect(translateGuidance(json)).toBe(json)
  })

  it('leaves a guidance-shaped fragment alone when it is not the whole paragraph', () => {
    const json = JSON.stringify({ text: 'Tokens prefixed with @ are paths.' })
    expect(translateGuidance(json)).toBe(json)
  })

  it('keeps the tool name the guidance points at', () => {
    expect(FILE_REFERENCE_GUIDANCE).toContain('read tool')
    expect(FILE_REFERENCE_GUIDANCE_ZH).toContain('read 工具')
  })
})
