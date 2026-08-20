import { describe, expect, it, vi } from 'vitest'
import { fetchBalance, parseBalanceBody } from '../src/balance.ts'

const SAMPLE_BODY = {
  is_available: true,
  balance_infos: [
    { currency: 'CNY', total_balance: '110.00', granted_balance: '10.00', topped_up_balance: '100.00' },
  ],
}

describe('balance: parseBalanceBody', () => {
  it('normalizes a valid DeepSeek balance response', () => {
    const result = parseBalanceBody(SAMPLE_BODY, 'https://api.deepseek.com')
    expect(result.baseURL).toBe('https://api.deepseek.com')
    expect(result.is_available).toBe(true)
    expect(result.balance_infos).toHaveLength(1)
    expect(result.balance_infos[0]).toEqual({
      currency: 'CNY',
      total_balance: '110.00',
      granted_balance: '10.00',
      topped_up_balance: '100.00',
    })
    expect(result.fetchedAt).toBeTruthy()
  })

  it('treats a missing is_available as available', () => {
    const { is_available: _ignored, ...rest } = SAMPLE_BODY
    expect(parseBalanceBody(rest, 'x').is_available).toBe(true)
  })

  it('rejects malformed bodies', () => {
    expect(() => parseBalanceBody(null, 'x')).toThrow(/JSON/)
    expect(() => parseBalanceBody({}, 'x')).toThrow(/balance_infos/)
    expect(() => parseBalanceBody({ balance_infos: [{}] }, 'x')).toThrow(/currency/)
    expect(() => parseBalanceBody({ balance_infos: 'nope' }, 'x')).toThrow(/balance_infos/)
  })
})

describe('balance: fetchBalance', () => {
  it('fetches GET {baseURL}/user/balance with a Bearer header', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe('https://api.deepseek.com/user/balance')
      expect((init?.headers as Record<string, string>)?.authorization).toBe('Bearer sk-test')
      return new Response(JSON.stringify(SAMPLE_BODY), { status: 200 })
    }) as unknown as typeof fetch

    const result = await fetchBalance({
      baseURL: 'https://api.deepseek.com/',
      apiKey: 'sk-test',
      fetchImpl,
    })
    expect(result.balance_infos[0].total_balance).toBe('110.00')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('surfaces provider error messages on non-2xx', async () => {
    const fetchImpl = vi.fn(async () => new Response(
      JSON.stringify({ error: { message: 'Insufficient Balance' } }),
      { status: 402 },
    )) as unknown as typeof fetch

    await expect(fetchBalance({ baseURL: 'https://api.deepseek.com', apiKey: 'k', fetchImpl }))
      .rejects.toThrow(/HTTP 402：Insufficient Balance/)
  })

  it('falls back to a status-only message when the body is not JSON', async () => {
    const fetchImpl = vi.fn(async () => new Response('gateway error', { status: 502 })) as unknown as typeof fetch
    await expect(fetchBalance({ baseURL: 'https://api.deepseek.com', apiKey: 'k', fetchImpl }))
      .rejects.toThrow(/HTTP 502/)
  })

  it('propagates transport failures with a readable message', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('ECONNREFUSED') }) as unknown as typeof fetch
    await expect(fetchBalance({ baseURL: 'https://api.deepseek.com', apiKey: 'k', fetchImpl }))
      .rejects.toThrow(/请求 .* 失败/)
  })
})
