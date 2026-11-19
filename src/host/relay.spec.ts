/**
 * Which origin a model-facing request leaves from: the site root, or the
 * long-lived endpoint the model picker's switch selects.
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_DIRECT_ENDPOINT, relayBaseURL } from './relay.ts'

describe('relayBaseURL', () => {
  it('keeps the site root while the switch is off', () => {
    expect(relayBaseURL('https://neartoken.cc', false)).toBe('https://neartoken.cc')
  })

  it('moves the model-facing endpoints to the direct endpoint while it is on', () => {
    expect(relayBaseURL('https://neartoken.cc', true)).toBe(DEFAULT_DIRECT_ENDPOINT)
  })

  it('uses a configured endpoint and drops its trailing slash', () => {
    expect(relayBaseURL('https://neartoken.cc', true, 'https://direct.example/')).toBe('https://direct.example')
  })

  it('puts the custom address above both origins the switch picks between', () => {
    expect(relayBaseURL('https://neartoken.cc', false, DEFAULT_DIRECT_ENDPOINT, 'https://api.example/'))
      .toBe('https://api.example')
    expect(relayBaseURL('https://neartoken.cc', true, DEFAULT_DIRECT_ENDPOINT, 'https://api.example'))
      .toBe('https://api.example')
  })

  it('falls back to the switch while the custom address is empty', () => {
    expect(relayBaseURL('https://neartoken.cc', false, DEFAULT_DIRECT_ENDPOINT, '   ')).toBe('https://neartoken.cc')
    expect(relayBaseURL('https://neartoken.cc', true, DEFAULT_DIRECT_ENDPOINT, '')).toBe(DEFAULT_DIRECT_ENDPOINT)
  })
})
