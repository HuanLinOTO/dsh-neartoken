import { describe, expect, it } from 'vitest'
import { NearTokenTopupError, computeAmountError, parseTopupInfo, parseTopupOrder } from './topup.ts'

describe('computeAmountError', () => {
  it('rejects a non-integer', () => {
    expect(computeAmountError(1.5, 10)).toBe('充值金额必须是整数')
  })

  it('rejects a non-positive amount', () => {
    expect(computeAmountError(0, 10)).toBe('充值金额必须是整数')
  })

  it('rejects an amount below the site floor', () => {
    expect(computeAmountError(5, 10)).toBe('充值金额不能低于 10')
  })

  it('accepts a valid amount', () => {
    expect(computeAmountError(50, 10)).toBeUndefined()
  })
})

describe('parseTopupInfo', () => {
  it('reads the ladder, the floor and the methods', () => {
    const info = parseTopupInfo({
      success: true,
      data: {
        enable_online_topup: true,
        min_topup: 10,
        amount_options: [10, 50, 'x'],
        pay_methods: [{ type: 'alipay', name: '支付宝' }, { name: 'no type' }],
      },
    })
    expect(info).toEqual({
      enabled: true,
      minTopup: 10,
      amountOptions: [10, 50],
      methods: [{ type: 'alipay', name: '支付宝' }],
    })
  })

  it('answers undefined when the site refused', () => {
    expect(parseTopupInfo({ success: false, code: 'DSH_TOKEN_REQUIRED' })).toBeUndefined()
  })
})

describe('parseTopupOrder', () => {
  it('reads the trade number and the checkout link', () => {
    expect(parseTopupOrder({ success: true, data: { trade_no: 'A1', pay_url: '/dsh/pay?trade_no=A1&sig=s' } }))
      .toEqual({ tradeNo: 'A1', payUrl: '/dsh/pay?trade_no=A1&sig=s' })
  })

  it('answers undefined when a field is missing', () => {
    expect(parseTopupOrder({ success: true, data: { trade_no: 'A1' } })).toBeUndefined()
  })
})

describe('NearTokenTopupError', () => {
  it('keeps the reason and the site wording', () => {
    const error = new NearTokenTopupError('not-dsh', 'not a device key')
    expect(error.reason).toBe('not-dsh')
    expect(error.message).toBe('not a device key')
  })
})
