import { describe, expect, it } from 'vitest'
import { formatEth, formatToken } from './format'
import { fetchNativeAcrossChains, fetchOnchainBalances } from './balances'
import { popularFor } from './tokens'
import { CHAINS } from './chains'

/** The deployer — has Sepolia funds, so it is a real read rather than an empty one. */
const WHO = '0x205d2686da3Bf33f64C17f21462c51B5eaD462CF'

describe('live on-chain balance reads', () => {
  it('reads the constrained list on Sepolia — the chain the Token API cannot serve', async () => {
    const list = popularFor(11155111)
    const balances = await fetchOnchainBalances(WHO, 11155111, list)
    console.log('  Sepolia list:', list.map((c) => c.symbol).join(', '))
    for (const b of balances) {
      console.log(`  held: ${b.currency.symbol} = ${formatToken(b.raw, b.currency.decimals)}`)
    }
    expect(Array.isArray(balances)).toBe(true)
  }, 30_000)

  it('reads native balances across every configured chain', async () => {
    const native = await fetchNativeAcrossChains(WHO)
    for (const info of CHAINS) {
      const value = native.get(info.chain.id)
      console.log(
        `  ${info.label.padEnd(10)} ${value === undefined ? 'no answer' : formatEth(value, 6) + ' ' + info.chain.nativeCurrency.symbol}`,
      )
    }
    // Sepolia is the point of the exercise: it must answer.
    expect(native.has(11155111)).toBe(true)
  }, 60_000)
})
