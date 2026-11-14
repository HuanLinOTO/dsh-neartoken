/**
 * The anti-degradation switch: one paragraph of the harness system prompt,
 * retold in Chinese for a Gemini model.
 *
 * The harness explains how to read `@`-prefixed paths in one English paragraph
 * composed by `@deepseek-ai/dsh-file-reference`. Gemini models from the fourth
 * generation onward follow that paragraph closely enough to lose quality on the
 * rest of the system prompt, while the same guidance in Chinese costs nothing.
 *
 * With the switch on, every occurrence of that paragraph in a Gemini-4 request
 * body — the system instruction, the conversation itself, and the tool
 * descriptions — is replaced with its Chinese translation. The replacement is a
 * plain substring on the SERIALIZED body: the request graph holds objects the
 * harness handed over frozen (a tool's `parameters` schema among them), and
 * writing a member back — even with the value it already had — throws
 * "Cannot assign to read only property". A harness that rewords the paragraph
 * simply stops being rewritten, which is the safe failure (a request the model
 * already handles) rather than a half-translated one.
 *
 * @module
 */

/**
 * The file-reference guidance exactly as the harness composes it.
 *
 * One literal on purpose: the whole swap is a substring match against it, so a
 * wording change upstream surfaces as "nothing was replaced" instead of as a
 * partially rewritten request.
 */
export const FILE_REFERENCE_GUIDANCE = 'Tokens prefixed with @ are paths the user explicitly referenced. Relative paths resolve from the workspace root; absolute paths identify files or directories on the host. A trailing slash marks a directory: list it when its contents matter. Anything else is a file: use the read tool when its contents are needed, and do not claim to have inspected it before reading. @"..." quotes a path containing spaces.'

/** The same guidance in Chinese, every rule and the tool name preserved. */
export const FILE_REFERENCE_GUIDANCE_ZH = '以 @ 为前缀的 token 是用户显式引用的路径。相对路径从工作区根目录解析；绝对路径标识主机上的文件或目录。末尾斜杠表示目录：当其内容重要时，列出该目录。其他均为文件：需要其内容时使用 read 工具，并且在读取之前不要声称已检查过它。@“…” 用于引用包含空格的路径。'

/**
 * A string as it appears inside one serialized JSON body.
 * @param text - the raw text.
 * @returns the escaped form, without the surrounding quotes.
 */
function insideJson(text: string): string {
  return JSON.stringify(text).slice(1, -1)
}

/** The English paragraph as a serialized body spells it. */
const ESCAPED_GUIDANCE = insideJson(FILE_REFERENCE_GUIDANCE)

/** The Chinese paragraph, escaped the same way, so the result stays valid JSON. */
const ESCAPED_GUIDANCE_ZH = insideJson(FILE_REFERENCE_GUIDANCE_ZH)

/**
 * Rewrite one serialized request body so its file-reference guidance is Chinese.
 *
 * Done on the body text rather than on the request messages because the guidance
 * travels in whichever member each wire chose — `systemInstruction` here, a
 * `system` role message there — and because a JSON document is the one shape no
 * caller can hand over frozen.
 * @param json - the body `JSON.stringify` produced; read, never mutated.
 * @returns the body carrying the Chinese guidance, or the same string when the
 * paragraph is absent.
 */
export function translateGuidance(json: string): string {
  return json.replaceAll(ESCAPED_GUIDANCE, ESCAPED_GUIDANCE_ZH)
}
