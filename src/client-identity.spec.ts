/**
 * The identity headers every request to the site carries: the plugin name and
 * version always, the session only when it is a value undici will accept.
 */
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { clientHeaders } from './client-identity.ts'

// The manifest, read the way the module under test reads it: the header must
// carry whatever the package publishes, never a copy written here.
const { version } = createRequire(import.meta.url)('../package.json') as { version: string }

describe('clientHeaders', () => {
  it('names the plugin and its published version', () => {
    expect(clientHeaders()['x-dsh-client']).toBe('dsh-neartoken/' + version)
    expect(version).toMatch(/^[0-9]+[.][0-9]+[.][0-9]+/)
  })

  it('sends no session header unless one is given', () => {
    expect(clientHeaders()).not.toHaveProperty('x-dsh-session-id')
    expect(clientHeaders(undefined)).not.toHaveProperty('x-dsh-session-id')
  })

  it('carries a legal session id unchanged', () => {
    expect(clientHeaders('01J8ZQ4V6M3S')).toEqual({
      'x-dsh-client': 'dsh-neartoken/' + version,
      'x-dsh-session-id': '01J8ZQ4V6M3S',
    })
  })

  it('drops a session id no header value may carry', () => {
    // Non-ASCII, a newline, a control character, an empty value, and one past
    // the length bound: each would make undici throw and take the whole
    // request with it, so the header is simply left out.
    for (const sessionId of ['\u4f1a\u8bdd-\u4e2d\u6587', 'a\nb', 'a\u0000b', 'x'.repeat(201), '']) {
      const headers = clientHeaders(sessionId)
      expect(headers).not.toHaveProperty('x-dsh-session-id')
      expect(headers['x-dsh-client']).toBe('dsh-neartoken/' + version)
    }
  })

  it('keeps the longest session id a header may carry', () => {
    const sessionId = 'y'.repeat(200)
    expect(clientHeaders(sessionId)['x-dsh-session-id']).toBe(sessionId)
  })
})
