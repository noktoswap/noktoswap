import { describe, expect, it } from 'vitest'
import { estimateXmr, formatRate, formatXmr } from './format'
import { fetchXmrPerEth, isStale } from './oracle'
import { parseEther } from 'viem'

describe('live Chainlink read', () => {
  it('produces a usable XMR/ETH rate', async () => {
    const quote = await fetchXmrPerEth()
    console.log('  ETH/USD  ', quote.ethUsd)
    console.log('  XMR/USD  ', quote.xmrUsd)
    console.log('  XMR/ETH  ', formatRate(quote.rate))
    const now = Math.floor(Date.now() / 1000)
    console.log('  stale?   ', isStale(quote, now), '| age', now - quote.updatedAt, 's')
    console.log('  0.25 ETH ->', formatXmr(estimateXmr(parseEther('0.25'), quote.rate)), 'XMR')
    expect(quote.rate).toBeGreaterThan(0)
    expect(isStale(quote, Math.floor(Date.now() / 1000))).toBe(false)
  }, 30_000)
})
