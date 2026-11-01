/**
 * The invite code carrier: what a referring page leaves on the window, and how
 * it rides along on the site's confirmation address.
 *
 * The value is untrusted on both ends — a page sets the global, and any caller
 * can post one to the Host — so the cases below cover the shapes that must be
 * dropped, not only the happy path.
 */
import { describe, expect, it } from 'vitest'
import { AFFILIATE_GLOBAL, normalizeAffiliateCode, readAffiliateCode, withAffiliateCode } from './affiliate.ts'

describe('readAffiliateCode', () => {
  it('reads the code a referring page left on the window', () => {
    expect(readAffiliateCode({ [AFFILIATE_GLOBAL]: 'aB3d' })).toBe('aB3d')
  })

  it('trims the value the page set', () => {
    expect(readAffiliateCode({ [AFFILIATE_GLOBAL]: '  aB3d\n' })).toBe('aB3d')
  })

  it('ignores a window that carries nothing', () => {
    expect(readAffiliateCode({})).toBeUndefined()
    expect(readAffiliateCode(undefined)).toBeUndefined()
    expect(readAffiliateCode(null)).toBeUndefined()
  })

  it('ignores a value that is not a string', () => {
    expect(readAffiliateCode({ [AFFILIATE_GLOBAL]: 42 })).toBeUndefined()
    expect(readAffiliateCode({ [AFFILIATE_GLOBAL]: { code: 'aB3d' } })).toBeUndefined()
  })
})

describe('normalizeAffiliateCode', () => {
  it('accepts letters, digits, dashes and underscores', () => {
    expect(normalizeAffiliateCode('aB3d')).toBe('aB3d')
    expect(normalizeAffiliateCode('invite-code_2')).toBe('invite-code_2')
  })

  it('drops an empty or blank value', () => {
    expect(normalizeAffiliateCode('')).toBeUndefined()
    expect(normalizeAffiliateCode('   ')).toBeUndefined()
  })

  it('drops characters a code cannot contain', () => {
    expect(normalizeAffiliateCode('ab cd')).toBeUndefined()
    expect(normalizeAffiliateCode('ab&aff=evil')).toBeUndefined()
    expect(normalizeAffiliateCode('邀请码')).toBeUndefined()
  })

  it('drops a value longer than any code', () => {
    expect(normalizeAffiliateCode('a'.repeat(65))).toBeUndefined()
  })
})

describe('withAffiliateCode', () => {
  it('appends the code beside the user code the site issued', () => {
    expect(withAffiliateCode('https://site.example/dsh/device?user_code=K7QM-3XPD', 'aB3d'))
      .toBe('https://site.example/dsh/device?user_code=K7QM-3XPD&aff=aB3d')
  })

  it('leaves the address alone when there is no code', () => {
    expect(withAffiliateCode('https://site.example/dsh/device?user_code=K7QM-3XPD', undefined))
      .toBe('https://site.example/dsh/device?user_code=K7QM-3XPD')
  })

  it('replaces a code the site already carried instead of repeating it', () => {
    expect(withAffiliateCode('https://site.example/dsh/device?aff=old1', 'aB3d'))
      .toBe('https://site.example/dsh/device?aff=aB3d')
  })

  it('leaves an address it cannot parse untouched', () => {
    expect(withAffiliateCode('/dsh/device?user_code=K7QM-3XPD', 'aB3d')).toBe('/dsh/device?user_code=K7QM-3XPD')
  })
})
