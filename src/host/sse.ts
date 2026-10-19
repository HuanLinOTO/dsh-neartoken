/**
 * The one SSE line pump the four wires share: decode a streaming body into
 * `data:` payloads, ignoring comments, blank lines and the `[DONE]` sentinel.
 *
 * @module
 */

/**
 * Yield every `data:` payload of one SSE response, in arrival order.
 * @param response - the streaming fetch response.
 * @param signal - cancellation passthrough for the read loop.
 * @returns the payload strings, `[DONE]` excluded.
 */
export async function* sseData(response: Response, signal: AbortSignal | undefined): AsyncGenerator<string> {
  if (response.body === null) return
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      if (signal?.aborted === true) return
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let newline = buffer.indexOf('\n')
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        newline = buffer.indexOf('\n')
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (payload === '' || payload === '[DONE]') continue
        yield payload
      }
    }
  } finally {
    void reader.releaseLock()
  }
}

/**
 * Unwrap one JSON `data:` payload.
 * @param payload - the raw payload text.
 * @returns the parsed object, or undefined when it is not a JSON object.
 */
export function parseJsonObject(payload: string): Record<string, unknown> | undefined {
  let parsed: unknown
  try { parsed = JSON.parse(payload) } catch { return undefined }
  if (typeof parsed !== 'object' || parsed === null) return undefined
  return parsed as Record<string, unknown>
}

/**
 * Read a finite number from an unknown field.
 * @param value - the candidate.
 * @returns the number, or undefined.
 */
export function numberOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/**
 * Read a string from an unknown field.
 * @param value - the candidate.
 * @returns the string, or undefined.
 */
export function stringOf(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}
