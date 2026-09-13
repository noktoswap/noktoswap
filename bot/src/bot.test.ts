import { describe, expect, it } from 'vitest'
import { parseEther } from 'viem'
import { DEPOSIT_DENOMINATOR, valueToOpen, valueToTake, sideOf, type OnChainOffer } from './chain'
import { ConfigError, parseEthToWei, parseXmrToAtomic, parseFlags } from './config'
import { decide, escrowAddressFor } from './engine'
import { generateCanonicalKeypair } from '../../web/src/lib/keys'
import { combinePrivateKeys } from '../../web/src/lib/monero'
import { MIN_BOOK_SAMPLE, midFromBook, plan } from './strategy'
import { ONE_XMR, formatXmr } from './monero/backend'
import { ManualMonero } from './monero/manual'

const ALICE = '0x00000000000000000000000000000000000000A1' as const
const BOB = '0x00000000000000000000000000000000000000B2' as const
const CAROL = '0x00000000000000000000000000000000000000C3' as const

const PARAMETERS = {
  // The live Sepolia values, read from the contract.
  minimumOffer: parseEther('0.00001'),
  maximumOffer: parseEther('10'),
  depositRatio: 500n, // 5%
  maximumBookSize: 0n,
  t0Delay: 86_400n,
  t1Delay: 86_400n,
}

const offer = (over: Partial<OnChainOffer> = {}): OnChainOffer => ({
  id: 1n,
  kind: 'BUY',
  state: 'TAKEN',
  owner: ALICE,
  counterparty: BOB,
  amount: parseEther('0.01'),
  deposit: parseEther('0.0005'),
  xmrAmount: 5n * ONE_XMR,
  t0: 1000n,
  t1: 2000n,
  blockTaken: 10n,
  evmPublicSpendKey: 0n,
  evmPublicViewKey: 0n,
  evmPrivateSpendKey: 0n,
  evmPrivateViewKey: 0n,
  xmrPublicSpendKey: 0n,
  xmrPrivateViewKey: 0n,
  xmrPrivateSpendKey: 0n,
  ...over,
})

describe('who stakes what, and why a maker needs both balances', () => {
  it('mirrors the contract: BUY escrows the full leg, SELL only a deposit', () => {
    const leg = parseEther('1')
    // BUY — the maker is the EVM side and the ETH *is* the consideration.
    expect(valueToOpen('BUY', leg, PARAMETERS.depositRatio)).toBe(leg)
    // SELL — the maker is the XMR side; the ETH is collateral at 5%.
    expect(valueToOpen('SELL', leg, PARAMETERS.depositRatio)).toBe(parseEther('0.05'))
    expect(valueToOpen('SELL', leg, PARAMETERS.depositRatio)).toBe(
      (leg * PARAMETERS.depositRatio) / DEPOSIT_DENOMINATOR,
    )
  })

  it('mirrors the contract on taking, which is the opposite side', () => {
    // Taking a BUY makes you the XMR side: you post the deposit.
    expect(valueToTake(offer({ kind: 'BUY' }))).toBe(parseEther('0.0005'))
    // Taking a SELL makes you the EVM side: you post the whole amount.
    expect(valueToTake(offer({ kind: 'SELL' }))).toBe(parseEther('0.01'))
  })

  it('puts the maker on the side its offer kind implies', () => {
    expect(sideOf(offer({ kind: 'BUY', owner: ALICE, counterparty: BOB }), ALICE)).toBe('evm')
    expect(sideOf(offer({ kind: 'BUY', owner: ALICE, counterparty: BOB }), BOB)).toBe('xmr')
    expect(sideOf(offer({ kind: 'SELL', owner: ALICE, counterparty: BOB }), ALICE)).toBe('xmr')
    expect(sideOf(offer({ kind: 'SELL', owner: ALICE, counterparty: BOB }), BOB)).toBe('evm')
    expect(sideOf(offer(), CAROL)).toBeNull()
  })
})

describe('the strategy sizes to the binding constraint, per side', () => {
  const base = {
    mid: 400,
    spread: 0.02,
    depth: 1,
    maxOfferWei: parseEther('0.01'),
    maxTotalWei: parseEther('1'),
    parameters: PARAMETERS,
  }

  it('quotes both sides when both balances allow it', () => {
    const quotes = plan({
      ...base,
      inventory: { ethWei: parseEther('1'), xmrAtomic: 100n * ONE_XMR, committedWei: 0n },
    })
    expect(quotes.map((q) => q.kind).sort()).toEqual(['BUY', 'SELL'])
    // Below mid to buy, above to sell — that is where the spread comes from.
    const buy = quotes.find((q) => q.kind === 'BUY')
    const sell = quotes.find((q) => q.kind === 'SELL')
    expect(buy?.rate).toBeLessThan(400)
    expect(sell?.rate).toBeGreaterThan(400)
  })

  it('will not quote XMR it cannot deliver', () => {
    // ETH is plentiful, XMR is not. The SELL side must disappear rather than
    // promise coins the wallet does not hold.
    const quotes = plan({
      ...base,
      inventory: { ethWei: parseEther('1'), xmrAtomic: 0n, committedWei: 0n },
    })
    expect(quotes.map((q) => q.kind)).toEqual(['BUY'])
  })

  it('stakes less ETH for a SELL than a BUY of the same size', () => {
    const quotes = plan({
      ...base,
      inventory: { ethWei: parseEther('1'), xmrAtomic: 1000n * ONE_XMR, committedWei: 0n },
    })
    const buy = quotes.find((q) => q.kind === 'BUY')
    const sell = quotes.find((q) => q.kind === 'SELL')
    // Same ETH leg cap, but the SELL only escrows 5% of it.
    expect(buy?.value).toBe(buy?.ethAmount)
    expect(sell?.value).toBeLessThan(sell?.ethAmount as bigint)
  })

  it('respects the exposure cap, counting what is already committed', () => {
    const quotes = plan({
      ...base,
      maxTotalWei: parseEther('0.02'),
      inventory: {
        ethWei: parseEther('1'),
        xmrAtomic: 100n * ONE_XMR,
        committedWei: parseEther('0.02'),
      },
    })
    expect(quotes).toEqual([])
  })

  it('leaves gas behind rather than staking the whole balance', () => {
    // A balance that is entirely escrowed cannot pay for the claim that collects it.
    const quotes = plan({
      ...base,
      maxOfferWei: parseEther('1'),
      inventory: { ethWei: parseEther('0.001'), xmrAtomic: 0n, committedWei: 0n },
    })
    expect(quotes).toEqual([])
  })

  it('refuses a size under the contract minimum instead of reverting on chain', () => {
    const quotes = plan({
      ...base,
      maxOfferWei: 1n, // one wei, far below MINIMUM_OFFER
      inventory: { ethWei: parseEther('1'), xmrAtomic: 100n * ONE_XMR, committedWei: 0n },
    })
    expect(quotes).toEqual([])
  })

  it('steps each depth level further from mid', () => {
    const quotes = plan({
      ...base,
      depth: 3,
      inventory: { ethWei: parseEther('10'), xmrAtomic: 1000n * ONE_XMR, committedWei: 0n },
    })
    const buys = quotes.filter((q) => q.kind === 'BUY').map((q) => q.rate)
    expect(buys.length).toBe(3)
    // Each successive buy bids lower.
    expect(buys[0]).toBeGreaterThan(buys[1] as number)
    expect(buys[1]).toBeGreaterThan(buys[2] as number)
  })
})

describe('a thin book does not get to set the mid', () => {
  const at = (rate: number, id: bigint): OnChainOffer =>
    offer({
      id,
      state: 'OPEN',
      amount: parseEther('1'),
      xmrAmount: BigInt(Math.round(rate * Number(ONE_XMR))),
    })

  it('refuses below the sample floor', () => {
    expect(midFromBook([])).toBeNull()
    expect(midFromBook([at(480, 1n)])).toBeNull()
    expect(midFromBook([at(480, 1n), at(500, 2n)])).toBeNull()
    expect(MIN_BOOK_SAMPLE).toBe(3)
  })

  it('takes the median once there is a sample', () => {
    const mid = midFromBook([at(400, 1n), at(500, 2n), at(450, 3n)])
    expect(mid).toBeCloseTo(450, 6)
  })

  it('ignores offers that are not open', () => {
    const book = [at(400, 1n), at(500, 2n), at(450, 3n), offer({ id: 4n, state: 'CLAIMED' })]
    expect(midFromBook(book)).toBeCloseTo(450, 6)
  })
})

describe('the deadline table, transcribed from the contract', () => {
  const monero = new ManualMonero()
  const common = { mainnet: false, alreadySentXmr: false, alreadySwept: false, monero }
  /*
   * Real keypairs, not placeholder integers: `computeEscrowWallet` decompresses
   * these as curve points and throws on anything that is not one, which mirrors the
   * contract's own `requireCanonicalPoint`.
   */
  const mine = generateCanonicalKeypair()
  const theirs = generateCanonicalKeypair()
  const pair = mine
  const committed = {
    evmPublicSpendKey: mine.publicSpend,
    evmPublicViewKey: mine.publicView,
    xmrPublicSpendKey: theirs.publicSpend,
    xmrPrivateViewKey: theirs.privateView,
  }

  it('sends XMR while the offer is fresh, then waits', async () => {
    // Taking a BUY makes BOB the XMR side. Keys are on-chain, so the escrow derives.
    const taken = offer({ kind: 'BUY', state: 'TAKEN', ...committed })
    const first = await decide({ ...common, offer: taken, me: BOB, now: 500n, pair })
    expect(first.kind).toBe('send-xmr')

    const after = await decide({ ...common, offer: taken, me: BOB, now: 500n, pair, alreadySentXmr: true })
    expect(after.kind).toBe('wait')
  })

  it('lets the XMR side claim only inside its window', async () => {
    const taken = offer({ kind: 'BUY', state: 'TAKEN' })
    // Before t0 a TAKEN offer is not claimable — the EVM side may still confirm.
    expect((await decide({ ...common, offer: taken, me: BOB, now: 999n, pair, alreadySentXmr: true })).kind).toBe('wait')
    // After t0 it is.
    expect((await decide({ ...common, offer: taken, me: BOB, now: 1001n, pair })).kind).toBe('claim')
    // READY is claimable throughout, without waiting for t0.
    const ready = offer({ kind: 'BUY', state: 'READY' })
    expect((await decide({ ...common, offer: ready, me: BOB, now: 500n, pair })).kind).toBe('claim')
    // Past t1 the window is shut and the only move is a refund.
    expect((await decide({ ...common, offer: ready, me: BOB, now: 2001n, pair })).kind).toBe('quit')
  })

  it('gives the EVM side no move between t0 and t1', async () => {
    /*
     * The gap that is easy to get wrong: having missed `ready`, the EVM side cannot
     * quit until t1 either — the contract allows `quit` when TAKEN only at
     * `<= t0 || > t1`. A bot that thinks it can act here will burn gas on a revert
     * every pass.
     */
    const taken = offer({ kind: 'BUY', state: 'TAKEN' })
    const action = await decide({ ...common, offer: taken, me: ALICE, now: 1500n, pair })
    expect(action.kind).toBe('wait')
    expect('why' in action && action.why).toContain('t0 missed')

    // And past t1 it refunds.
    expect((await decide({ ...common, offer: taken, me: ALICE, now: 2001n, pair })).kind).toBe('quit')
  })

  it('refuses to confirm a deposit it cannot verify', async () => {
    /*
     * `ready()` asserts the XMR arrived. With no wallet to scan, the manual backend
     * throws rather than return zero — because a false negative expires a good
     * trade and a false positive hands away the escrow.
     */
    const taken = offer({ kind: 'BUY', state: 'TAKEN', ...committed })
    await expect(decide({ ...common, offer: taken, me: ALICE, now: 500n, pair })).rejects.toThrow(
      /cannot verify an escrow deposit/,
    )
  })

  it('sweeps once the counterparty has revealed, and only then', async () => {
    const claimed = offer({
      kind: 'BUY',
      state: 'CLAIMED',
      ...committed,
      xmrPrivateSpendKey: theirs.privateSpend,
    })
    const action = await decide({ ...common, offer: claimed, me: ALICE, now: 3000n, pair })
    expect(action.kind).toBe('sweep')
    /*
     * The escrow's spend scalar is the two halves summed mod L — which is exactly
     * why neither party can spend before the other reveals, and why the EVM side
     * can the moment `claim` puts the other half on chain.
     */
    expect(action.kind === 'sweep' && action.combined).toBe(
      combinePrivateKeys(mine.privateSpend, theirs.privateSpend),
    )

    // Already done is done — no double sweep on a restart.
    expect(
      (await decide({ ...common, offer: claimed, me: ALICE, now: 3000n, pair, alreadySwept: true })).kind,
    ).toBe('done')
    // The XMR side has nothing left to do; it already has the ETH.
    expect((await decide({ ...common, offer: claimed, me: BOB, now: 3000n, pair })).kind).toBe('done')
  })

  it('asks for attention rather than guessing when the keys are gone', async () => {
    const ready = offer({ kind: 'BUY', state: 'READY' })
    const action = await decide({ ...common, offer: ready, me: BOB, now: 500n, pair: null })
    expect(action.kind).toBe('attention')
  })

  it('treats a terminal state as terminal', async () => {
    for (const state of ['CANCELLED', 'REFUNDED'] as const) {
      const action = await decide({ ...common, offer: offer({ state }), me: ALICE, now: 9999n, pair })
      expect(action.kind).toBe('done')
    }
  })
})

describe('the escrow address is tied to the realm', () => {
  const a = generateCanonicalKeypair()
  const b = generateCanonicalKeypair()
  const both = {
    evmPublicSpendKey: a.publicSpend,
    evmPublicViewKey: a.publicView,
    xmrPublicSpendKey: b.publicSpend,
    xmrPrivateViewKey: b.privateView,
  }

  it('is null until both sides have committed', () => {
    expect(escrowAddressFor(offer(), false)).toBeNull()
    expect(escrowAddressFor(offer({ evmPublicSpendKey: 1n }), false)).toBeNull()
  })

  it('yields stagenet for a testnet chain and mainnet for a mainnet one', () => {
    const stagenet = escrowAddressFor(offer(both), false)
    const mainnet = escrowAddressFor(offer(both), true)
    expect(stagenet).toBeTruthy()
    expect(mainnet).toBeTruthy()
    // 95 characters, and the leading character encodes the network prefix.
    expect(stagenet).toHaveLength(95)
    expect(mainnet).toHaveLength(95)
    expect(mainnet?.startsWith('4')).toBe(true)
    expect(stagenet?.startsWith('5')).toBe(true)
    // A Sepolia escrow must never read as a mainnet address.
    expect(stagenet).not.toBe(mainnet)
  })
})

describe('amounts are parsed as decimals, never as floats', () => {
  it('handles ETH at full precision', () => {
    expect(parseEthToWei('1')).toBe(10n ** 18n)
    expect(parseEthToWei('0.000000000000000001')).toBe(1n)
    expect(parseEthToWei('0.1')).toBe(10n ** 17n)
    expect(() => parseEthToWei('1e18')).toThrow(ConfigError)
    expect(() => parseEthToWei('-1')).toThrow(ConfigError)
  })

  it('knows XMR has twelve decimals, not eighteen', () => {
    // A decimals mixup here is a factor of a million in the amount sent.
    expect(parseXmrToAtomic('1')).toBe(ONE_XMR)
    expect(parseXmrToAtomic('0.000000000001')).toBe(1n)
    expect(ONE_XMR).toBe(10n ** 12n)
    expect(() => parseXmrToAtomic('0.0000000000001')).toThrow(ConfigError)
  })

  it('round-trips through the formatter', () => {
    expect(formatXmr(ONE_XMR)).toBe('1')
    expect(formatXmr(ONE_XMR / 2n)).toBe('0.5')
    expect(formatXmr(0n)).toBe('0')
  })
})

describe('flag parsing', () => {
  it('takes both --flag value and --flag=value, and bare booleans', () => {
    const flags = parseFlags(['make', '--chain', '1', '--spread=0.05', '--live', '--depth', '3'])
    expect(flags.get('chain')).toBe('1')
    expect(flags.get('spread')).toBe('0.05')
    expect(flags.get('live')).toBe('true')
    expect(flags.get('depth')).toBe('3')
  })

  it('does not swallow the next flag as a value', () => {
    const flags = parseFlags(['--live', '--chain', '8453'])
    expect(flags.get('live')).toBe('true')
    expect(flags.get('chain')).toBe('8453')
  })
})
