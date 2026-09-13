import { beforeEach, describe, expect, it } from 'vitest'
import { parseEther, parseUnits, toEventSelector, type Address } from 'viem'
import { offerIdFromReceipt, valueToOpen } from './contract'
import {
  countdown,
  estimateEth,
  estimateXmr,
  formatXmr,
  isUrgent,
  rateXmrPerEth,
  trimDecimals,
  tryParseXmr,
} from './format'
import {
  fromMnemonic,
  generateCanonicalKeypair,
  isCanonicalPoint,
  keysForOpen,
  keysForQuit,
  keysForTake,
  pointToUint256,
  proves,
} from './keys'
import { permitTypedData, type PermitData } from './uniswap'
import { config } from './wagmi'
import {
  CHAINS,
  READ_ONLY_CHAINS,
  chainInfo,
  chainLabel,
  deployedButUnindexed,
  indexedChains,
  isTradable,
  realmOf,
  sameRealm,
  visibleChains,
} from './chains'
import { logoCandidates } from './icons'
import { totalOpen } from './subgraph'
import {
  ED25519_L,
  combinePrivateKeys,
  computeEscrowWallet,
  decodeMoneroAddress,
  encodeMoneroAddress,
  moneroPaymentUri,
  moneroViewUri,
  moneroWalletUri,
  toMoneroKeyHex,
} from './monero'
import { XMR, isXmr, nativeOf, type Currency } from './tokens'
import {
  NEAR_BAND,
  bookGoingRate,
  canTake,
  matchOffers,
  medianRate,
  orderStatus,
  receiveAmountFor,
  requiredToTake,
  sideOf,
  type Offer,
  type OfferKind,
  type OfferState,
} from './offers'
import {
  clearDraft,
  draftEth,
  flipDirection,
  draftXmr,
  payAmount,
  payCurrency,
  payInput,
  payLeg,
  receiveLeg,
  postedKind,
  receiveCurrency,
  seedOfferDraft,
  selectCurrency,
  want,
  setDirectionTo,
  setDraftEth,
  setDraftXmr,
  setEvmCurrency,
  setPayInput,
  wantedKind,
} from '../state/swap'
import {
  clearTokenNetworks,
  isAllChains,
  isSelected,
  resolveChains,
  toggleTokenNetwork,
  tokenNetworks,
} from '../state/filters'
import {
  closeAllModals,
  closeModal,
  modal,
  openChainPicker,
  openTokenPicker,
} from '../state/modals'
import {
  MAX_ALLOWED_SLIPPAGE,
  deadlineAt,
  maxSlippage,
  resetSettings,
  setDeadlineMinutes,
  setMaxSlippage,
} from '../state/settings'

/**
 * The parts that decide what a user is shown and what they can press.
 *
 * Four areas, chosen because a silent bug in any of them costs money rather
 * than pixels:
 *
 *   1. the matching bands — which offer the widget names, and whether the
 *      readout is a real figure or an estimate
 *   2. roles and timing — every button is shown only when the contract would
 *      not revert, so this logic duplicates the contract's and has to agree
 *   3. the msg.value inversion and the display rounding rule
 *   4. the ed25519 encoding, pinned against vectors produced by the Solidity
 *      library itself — a mismatch means an unspendable escrow
 */

const ALICE = '0x00000000000000000000000000000000000000a1' as Address
const BOB = '0x00000000000000000000000000000000000000b0' as Address
const CAROL = '0x00000000000000000000000000000000000000c0' as Address

const xmr = (amount: string) => parseUnits(amount, 12)

const SEPOLIA = 11155111

const offer = (over: Partial<Offer> & { kind: OfferKind; state: OfferState }): Offer => ({
  // Defaulted so the single-chain cases stay readable; the multi-chain ones set it.
  chainId: SEPOLIA,
  offerId: 1n,
  owner: ALICE,
  counterparty: null,
  amount: parseEther('0.25'),
  deposit: parseEther('0.0125'),
  xmrAmount: xmr('1.205'),
  t0: null,
  t1: null,
  evmKeysRevealed: false,
  xmrSpendKeyRevealed: false,
  createdAt: 1000n,
  updatedAt: 1000n,
  ...over,
})

describe('matching the book against a typed amount', () => {
  const book = [
    offer({ kind: 'SELL', state: 'OPEN', offerId: 1n, amount: parseEther('0.25'), xmrAmount: xmr('1.205') }),
    offer({ kind: 'SELL', state: 'OPEN', offerId: 2n, amount: parseEther('0.27'), xmrAmount: xmr('1.32') }),
    offer({ kind: 'SELL', state: 'OPEN', offerId: 3n, amount: parseEther('0.23'), xmrAmount: xmr('1.09') }),
    offer({ kind: 'BUY', state: 'OPEN', offerId: 4n, amount: parseEther('0.25'), xmrAmount: xmr('1.3') }),
    offer({ kind: 'SELL', state: 'TAKEN', offerId: 5n, amount: parseEther('0.25'), xmrAmount: xmr('9') }),
  ]

  it('names the offer that is exactly your size, and shows its real figures', () => {
    const result = matchOffers(book, { leg: 'eth', amount: parseEther('0.25') }, 'SELL')
    expect(result.verdict).toBe('exact')
    expect(result.exact).toHaveLength(1)
    expect(result.best?.offer.offerId).toBe(1n)
    expect(result.estimated).toBe(false)
  })

  it('does not recommend the best rate when a worse rate is your exact size', () => {
    // 0.27 ETH prices better (4.888 vs 4.82) but taking it changes your amount.
    // It is one click away under compare; it is not the default.
    const result = matchOffers(book, { leg: 'eth', amount: parseEther('0.25') }, 'SELL')
    expect(result.best?.offer.offerId).toBe(1n)
    expect(result.near[0]?.offer.offerId).toBe(2n)
  })

  it('only considers open offers on the side you need to take', () => {
    const result = matchOffers(book, { leg: 'eth', amount: parseEther('0.25') }, 'SELL')
    const ids = [...result.exact, ...result.near].map((m) => m.offer.offerId)
    expect(ids).not.toContain(4n) // wrong kind
    expect(ids).not.toContain(5n) // already taken
  })

  it('mutes the readout when nothing is your size', () => {
    const result = matchOffers(book, { leg: 'eth', amount: parseEther('0.26') }, 'SELL')
    expect(result.verdict).toBe('near')
    expect(result.exact).toHaveLength(0)
    expect(result.estimated).toBe(true)
    // With nothing exact, the best rate in the band is what the rule quotes.
    expect(result.best?.offer.offerId).toBe(2n)
  })

  it('falls back to the book-wide going rate when nothing is takeable', () => {
    const result = matchOffers(book, { leg: 'eth', amount: parseEther('5') }, 'SELL')
    expect(result.verdict).toBe('none')
    expect(result.best).toBeNull()
    // Not decoration: this is the number you would price a new offer against.
    expect(result.rate).not.toBeNull()
  })

  it('treats the near band as ±10% inclusive', () => {
    const at10 = matchOffers(
      [offer({ kind: 'SELL', state: 'OPEN', amount: parseEther('1.1'), xmrAmount: xmr('5') })],
      { leg: 'eth', amount: parseEther('1') },
      'SELL',
    )
    const at11 = matchOffers(
      [offer({ kind: 'SELL', state: 'OPEN', amount: parseEther('1.11'), xmrAmount: xmr('5') })],
      { leg: 'eth', amount: parseEther('1') },
      'SELL',
    )
    expect(at10.near).toHaveLength(1)
    expect(at11.near).toHaveLength(0)
  })

  it('takes a median so one mispriced offer cannot move the going rate', () => {
    expect(medianRate([5, 1, 3])).toBe(3)
    expect(medianRate([1, 3, 5, 7])).toBe(4)
    expect(medianRate([null, 4, null])).toBe(4)
    expect(medianRate([])).toBeNull()
  })
})

describe('which side of the trade you are on', () => {
  it('flips with the offer kind', () => {
    // BUY: the maker escrows the ETH. SELL: the maker holds the XMR.
    const buy = offer({ kind: 'BUY', state: 'TAKEN', owner: ALICE, counterparty: BOB })
    expect(sideOf(buy, ALICE)).toBe('evm')
    expect(sideOf(buy, BOB)).toBe('xmr')

    const sell = offer({ kind: 'SELL', state: 'TAKEN', owner: ALICE, counterparty: BOB })
    expect(sideOf(sell, ALICE)).toBe('xmr')
    expect(sideOf(sell, BOB)).toBe('evm')
  })

  it('puts everyone else outside the trade', () => {
    const sell = offer({ kind: 'SELL', state: 'TAKEN', owner: ALICE, counterparty: BOB })
    expect(sideOf(sell, CAROL)).toBe('none')
    expect(sideOf(sell, undefined)).toBe('none')
  })

  it('asks the taker for the deposit on a BUY and the whole amount on a SELL', () => {
    expect(requiredToTake('BUY', 100n, 5n)).toBe(5n)
    expect(requiredToTake('SELL', 100n, 5n)).toBe(100n)
  })
})

describe('what each side can press, and when', () => {
  const t0 = 2_000n
  const t1 = 3_000n
  const taken = { t0, t1, owner: ALICE, counterparty: BOB } as const
  const takenBuy = () => offer({ kind: 'BUY', state: 'TAKEN', ...taken })
  const readyBuy = () => offer({ kind: 'BUY', state: 'READY', ...taken })

  it('gives the EVM side ready() and an exit before t0', () => {
    const status = orderStatus(takenBuy(), ALICE, 1_500)
    expect(status.stage).toBe('verify')
    expect(status.primary?.kind).toBe('ready')
    expect(status.secondary?.kind).toBe('quit')
    expect(status.deadline).toBe(t0)
    expect(status.waitingOnYou).toBe(true)
  })

  it('offers the EVM side nothing between t0 and t1', () => {
    // The confirm window closed and the exit has not opened. Showing a button
    // here would mean showing one that reverts.
    const status = orderStatus(takenBuy(), ALICE, 2_500)
    expect(status.primary).toBeNull()
    expect(status.waitingOnYou).toBe(false)
  })

  it('lets the EVM side publish and recover after t1', () => {
    expect(orderStatus(takenBuy(), ALICE, 3_500).primary?.kind).toBe('quit')
  })

  it('clocks the XMR side to t1 while it sends the coins', () => {
    const status = orderStatus(takenBuy(), BOB, 1_500)
    expect(status.stage).toBe('send-xmr')
    expect(status.deadline).toBe(t1)
    expect(status.secondary).toBeNull()
  })

  it('lets the XMR side claim past t0 even without a ready()', () => {
    expect(orderStatus(takenBuy(), BOB, 2_500).primary?.kind).toBe('claim')
  })

  it('turns a READY claim into a recovery once t1 passes', () => {
    expect(orderStatus(readyBuy(), BOB, 2_900).primary?.kind).toBe('claim')
    expect(orderStatus(readyBuy(), BOB, 3_100).primary?.kind).toBe('quit')
  })

  it('gives an open offer a cancel for its maker and a take for everyone else', () => {
    const open = offer({ kind: 'BUY', state: 'OPEN', owner: ALICE })
    const maker = orderStatus(open, ALICE, 0)
    expect(maker.secondary?.kind).toBe('cancel')
    // No counterparty means no clock, so this is never "waiting on you".
    expect(maker.deadline).toBeNull()
    expect(maker.waitingOnYou).toBe(false)
    expect(orderStatus(open, CAROL, 0).primary?.kind).toBe('take')
  })

  it('leaves the collectable side something to do in terminal states', () => {
    const claimed = offer({ kind: 'BUY', state: 'CLAIMED', ...taken })
    expect(orderStatus(claimed, ALICE, 4_000).stage).toBe('collect')
    expect(orderStatus(claimed, BOB, 4_000).stage).toBe('settled')

    const refunded = offer({ kind: 'BUY', state: 'REFUNDED', ...taken })
    expect(orderStatus(refunded, BOB, 4_000).stage).toBe('refunded')
    expect(orderStatus(refunded, BOB, 4_000).primary?.kind).toBe('show-keys')

    expect(orderStatus(offer({ kind: 'BUY', state: 'CANCELLED' }), ALICE, 0).stage).toBe('cancelled')
  })
})

describe('the figures that reach the chain', () => {
  it('inverts openOffer’s msg.value derivation per kind', () => {
    // BUY: msg.value *is* the escrowed amount.
    expect(valueToOpen('BUY', parseEther('1'), 500n)).toBe(parseEther('1'))
    // SELL: msg.value is the deposit; the contract derives the amount from it.
    expect(valueToOpen('SELL', parseEther('1'), 500n)).toBe(parseEther('0.05'))
    // Rounded up, so the derived amount never lands under the target.
    expect(valueToOpen('SELL', 1n, 500n)).toBe(1n)
  })

  it('computes a display rate without letting it gate anything', () => {
    expect(rateXmrPerEth(parseEther('0.25'), xmr('1.205'))).toBe(4.82)
    expect(rateXmrPerEth(0n, xmr('1'))).toBeNull()
  })

  it('never rounds a displayed amount up', () => {
    // 0.2499 shown as 0.25 invites someone to think they are taking an offer
    // they are not.
    expect(trimDecimals('0.24999', 4)).toBe('0.2499')
    expect(trimDecimals('1.2000', 4)).toBe('1.2')
    expect(trimDecimals('12', 4)).toBe('12')
  })
})

describe('deadlines in plain words', () => {
  const now = 10_000_000
  const inSeconds = (s: number) => BigInt(Math.floor(now / 1000) + s)

  it('reads as a countdown, never as a timestamp', () => {
    expect(countdown(null, now)).toBe('No deadline')
    expect(countdown(inSeconds(-1), now)).toBe('Expired')
    expect(countdown(inSeconds(2 * 3600 + 14 * 60), now)).toBe('2h 14m left')
    expect(countdown(inSeconds(19 * 3600), now)).toBe('19h left')
    expect(countdown(inSeconds(26 * 3600), now)).toBe('1d 2h left')
  })

  it('shouts only inside six hours', () => {
    expect(isUrgent(inSeconds(2 * 3600), now)).toBe(true)
    expect(isUrgent(inSeconds(19 * 3600), now)).toBe(false)
    expect(isUrgent(null, now)).toBe(false)
  })
})

describe('ed25519 encoding, against the Solidity library', () => {
  /**
   * Produced by running `Ed25519.scalarMultBaseCompressed` under forge. If these
   * ever disagree, the app is committing points the contract cannot match and
   * the resulting escrow is unspendable — so they are pinned rather than trusted
   * to a comment.
   */
  const vectors: [bigint, bigint][] = [
    [1n, 0x5866666666666666666666666666666666666666666666666666666666666666n],
    [12345n, 0xef4f62f8479733ad879cfaced3c89a9c39dd4fc795ef2efa1c3eafe4d729a081n],
    [0xdeadbeefn, 0xaa8a6aca3fad09b66800f719b672863ecc5c477a6fe745b3978a783081f5b080n],
    [
      7237005577332262213973186563042994240857116359379907606001950938285454250988n,
      0x58666666666666666666666666666666666666666666666666666666666666e6n,
    ],
  ]

  it.each(vectors)('compresses %s the way the contract does', (scalar, expected) => {
    expect(pointToUint256(scalar)).toBe(expected)
  })

  const pair = {
    mnemonic: '',
    privateSpend: 12345n,
    privateView: 999n,
    publicSpend: pointToUint256(12345n),
    publicView: pointToUint256(999n),
  }

  it('checks a reveal the same way claim() and quit() do', () => {
    expect(proves(pair.privateSpend, pair.publicSpend)).toBe(true)
    expect(proves(1n, pair.publicSpend)).toBe(false)
    expect(proves(0n, pointToUint256(1n))).toBe(false)
  })

  it('sends a public view key on a BUY open and a private one on a SELL open', () => {
    expect(keysForOpen('BUY', pair).viewingKey).toBe(pair.publicView)
    expect(keysForOpen('SELL', pair).viewingKey).toBe(pair.privateView)
  })

  it('flips the convention for a take, because the taker has the opposite role', () => {
    expect(keysForTake('BUY', pair).viewingKey).toBe(pair.privateView)
    expect(keysForTake('SELL', pair).viewingKey).toBe(pair.publicView)
  })

  it('gives the XMR side no view key to publish on a quit', () => {
    expect(keysForQuit('xmr', pair).viewingKey).toBe(0n)
    expect(keysForQuit('xmr', pair).spendingKey).toBe(pair.privateSpend)
    expect(keysForQuit('evm', pair).viewingKey).toBe(pair.privateView)
  })

  it('accepts every point the contract can produce', () => {
    // The canonical check has to agree with requireCanonicalPoint, and the way
    // to get this wrong is to reverse the bytes twice — which returns the input
    // unchanged and rejects about half of all valid points, because it ends up
    // testing the compressed value against q instead of y.
    const points = Array.from({ length: 256 }, (_, i) => pointToUint256(BigInt(i + 1) * 7919n))
    expect(points.every(isCanonicalPoint)).toBe(true)
  })

  it('rejects the encodings the contract calls non-canonical', () => {
    const changeEndianness = (value: bigint) => {
      let out = 0n
      for (let i = 0; i < 32; i += 1) out = (out << 8n) | ((value >> BigInt(8 * i)) & 0xffn)
      return out
    }
    // y = 0 is the identity, y = 1 a small-order point, y = q is out of field.
    // Each is unmatchable by any reveal, which is how a party could strand a
    // counterparty's XMR — so the client must refuse them too.
    expect(isCanonicalPoint(changeEndianness(0n))).toBe(false)
    expect(isCanonicalPoint(changeEndianness(1n))).toBe(false)
    expect(isCanonicalPoint(changeEndianness(2n ** 255n - 19n))).toBe(false)
    expect(isCanonicalPoint(changeEndianness(2n))).toBe(true)
  })

  it('draws keypairs the contract will accept', () => {
    for (let i = 0; i < 20; i += 1) {
      const drawn = generateCanonicalKeypair()
      expect(isCanonicalPoint(drawn.publicSpend)).toBe(true)
      expect(isCanonicalPoint(drawn.publicView)).toBe(true)
      expect(proves(drawn.privateSpend, drawn.publicSpend)).toBe(true)
      expect(proves(drawn.privateView, drawn.publicView)).toBe(true)
    }
  })
})

describe('picking a currency, given there is only one picker', () => {
  // Every trade is XMR against something on an EVM. No XMR/XMR pair exists, and
  // no token/token pair either, so any request has exactly one arrangement.
  const usdc: Currency = {
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
    address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
    chainId: 11155111,
  }
  const dai: Currency = { ...usdc, symbol: 'DAI', name: 'Dai Stablecoin', decimals: 18 }

  beforeEach(() => {
    setDirectionTo('eth-to-xmr')
    setEvmCurrency(nativeOf(11155111))
  })

  it('inverts rather than allowing XMR on both sides', () => {
    // Selling XMR for USDC…
    selectCurrency('pay', XMR)
    selectCurrency('receive', usdc)
    expect(payCurrency().symbol).toBe('XMR')
    expect(receiveCurrency().symbol).toBe('USDC')

    // …then picking XMR on the buy side inverts the pair.
    selectCurrency('receive', XMR)
    expect(payCurrency().symbol).toBe('USDC')
    expect(receiveCurrency().symbol).toBe('XMR')
  })

  it('inverts when an EVM token is picked on the XMR side', () => {
    selectCurrency('pay', XMR) // paying XMR, receiving ETH
    expect(receiveCurrency().symbol).toBe('ETH')

    selectCurrency('pay', dai) // DAI cannot sit opposite ETH, so the pair flips
    expect(payCurrency().symbol).toBe('DAI')
    expect(receiveCurrency().symbol).toBe('XMR')
  })

  it('is idempotent when the currency is already on that slot', () => {
    selectCurrency('pay', usdc)
    const before = [payCurrency().symbol, receiveCurrency().symbol]
    selectCurrency('pay', usdc)
    expect([payCurrency().symbol, receiveCurrency().symbol]).toEqual(before)
  })

  it('never leaves the same currency on both slots', () => {
    for (const slot of ['pay', 'receive'] as const) {
      for (const currency of [XMR, usdc, dai, nativeOf(1)]) {
        selectCurrency(slot, currency)
        // One side is always XMR and the other never is.
        expect(isXmr(payCurrency())).not.toBe(isXmr(receiveCurrency()))
        // And the requested currency landed where it was asked for.
        const landed = slot === 'pay' ? payCurrency() : receiveCurrency()
        expect(landed.symbol).toBe(currency.symbol)
      }
    }
  })

  it('keeps the offer kind consistent with the direction', () => {
    // Paying ETH for XMR means taking a SELL — the maker holds the coins — and
    // posting a BUY. Getting this backwards shows the wrong half of the book.
    selectCurrency('pay', usdc)
    expect(wantedKind()).toBe('SELL')
    expect(postedKind()).toBe('BUY')

    selectCurrency('pay', XMR)
    expect(wantedKind()).toBe('BUY')
    expect(postedKind()).toBe('SELL')
  })
})

describe('the near band is a setting, not a constant', () => {
  const book = [
    offer({ kind: 'SELL', state: 'OPEN', offerId: 1n, amount: parseEther('1.15'), xmrAmount: xmr('5') }),
  ]

  it('changes which offers count as close to your size', () => {
    // 1.15 is 15% away from 1.0 — outside the default band, inside a wider one.
    expect(matchOffers(book, { leg: 'eth', amount: parseEther('1') }, 'SELL', 0.1).near).toHaveLength(0)
    expect(matchOffers(book, { leg: 'eth', amount: parseEther('1') }, 'SELL', 0.2).near).toHaveLength(1)
  })

  it('defaults to the band the design specifies', () => {
    expect(NEAR_BAND).toBe(0.1)
    expect(matchOffers(book, { leg: 'eth', amount: parseEther('1') }, 'SELL')).toEqual(
      matchOffers(book, { leg: 'eth', amount: parseEther('1') }, 'SELL', NEAR_BAND),
    )
  })

  it('refuses a slippage that would hand the difference to a bot', () => {
    // Exact-output puts slippage on the token being spent, where it is easier to
    // miss than on the leg you are watching — so the ceiling is enforced.
    setMaxSlippage(50)
    expect(maxSlippage()).toBe(MAX_ALLOWED_SLIPPAGE)
    setMaxSlippage(0)
    expect(maxSlippage()).toBe(0.01)
    setMaxSlippage(null)
    expect(maxSlippage()).toBeNull() // auto — defer to Uniswap's own figure
    resetSettings()
  })

  it('turns a deadline in minutes into the unix seconds /swap wants', () => {
    setDeadlineMinutes(30)
    expect(deadlineAt(1_000_000)).toBe(1_000_000 + 1800)
    resetSettings()
  })
})

describe('the modal stack', () => {
  beforeEach(closeAllModals)

  const openChains = () => openChainPicker('token-networks')

  it('returns to what was underneath rather than closing everything', () => {
    // The bug this replaces: the chain picker *replaced* the token picker, which
    // then unmounted and took its filter state with it, so picking a network did
    // nothing and left no modal open.
    openTokenPicker(XMR, () => {})
    openChains()
    expect(modal()?.kind).toBe('chains')

    closeModal()
    expect(modal()?.kind).toBe('token')

    closeModal()
    expect(modal()).toBeNull()
  })

  it('keeps the network filter alive across the picker being covered', () => {
    clearTokenNetworks()
    openTokenPicker(XMR, () => {})
    openChains()
    // The chain view writes to shared state, not to a signal owned by a
    // component that is no longer mounted.
    toggleTokenNetwork(8453)
    closeModal()
    expect(modal()?.kind).toBe('token')
    expect(tokenNetworks()).toEqual([8453])
    clearTokenNetworks()
  })

  it('dismisses the whole stack when the flow has actually finished', () => {
    openTokenPicker(XMR, () => {})
    openChains()
    closeAllModals()
    expect(modal()).toBeNull()
  })
})

describe('network filtering is a set, not a single choice', () => {
  const ALL = [11155111, 1, 8453, 42161, 10]

  beforeEach(clearTokenNetworks)

  it('accumulates rather than replacing', () => {
    // The wireframe draws checkboxes, and a token *is* a (chain, token) pair —
    // so holding USDC on two chains means two entries worth seeing at once.
    toggleTokenNetwork(8453)
    toggleTokenNetwork(42161)
    expect(tokenNetworks()).toEqual([8453, 42161])
  })

  it('toggles a chain back off', () => {
    toggleTokenNetwork(8453)
    toggleTokenNetwork(8453)
    expect(tokenNetworks()).toEqual([])
  })

  it('treats empty as all, so unticking the last box widens rather than empties', () => {
    expect(isAllChains(tokenNetworks())).toBe(true)
    expect(resolveChains(tokenNetworks(), ALL)).toEqual(ALL)

    toggleTokenNetwork(8453)
    expect(isAllChains(tokenNetworks())).toBe(false)
    expect(resolveChains(tokenNetworks(), ALL)).toEqual([8453])

    toggleTokenNetwork(8453)
    expect(resolveChains(tokenNetworks(), ALL)).toEqual(ALL)
  })

  it('counts every chain as selected when nothing is', () => {
    expect(isSelected(tokenNetworks(), 8453)).toBe(true)
    toggleTokenNetwork(1)
    expect(isSelected(tokenNetworks(), 8453)).toBe(false)
    expect(isSelected(tokenNetworks(), 1)).toBe(true)
  })

  it('ignores a selection for a chain that is not configured', () => {
    toggleTokenNetwork(999999)
    expect(resolveChains(tokenNetworks(), ALL)).toEqual([])
  })
})

describe('posting an offer carries the amount across', () => {
  beforeEach(() => {
    setDraftEth('')
    setDraftXmr('')
  })

  it('seeds both legs, not just the ETH one', () => {
    // The rate is the point: on an empty book it is the only figure a maker has
    // to price against, so carrying the ETH alone would lose the useful half.
    seedOfferDraft({ eth: '0.25', xmr: '1.205' })
    expect(draftEth()).toBe('0.25')
    expect(draftXmr()).toBe('1.205')
  })

  it('seeds nothing when there is no amount', () => {
    // Opening the form from the book with an empty amount bar must not wipe a
    // draft somebody is part way through.
    seedOfferDraft({ eth: '0.5', xmr: '2.4' })
    seedOfferDraft({ eth: '', xmr: '' })
    expect(draftEth()).toBe('0.5')
    expect(draftXmr()).toBe('2.4')
  })

  it('keeps an existing XMR leg when only the ETH leg is known', () => {
    seedOfferDraft({ eth: '0.5', xmr: '2.4' })
    seedOfferDraft({ eth: '0.75', xmr: '' })
    expect(draftEth()).toBe('0.75')
    expect(draftXmr()).toBe('2.4')
  })

  it('does not couple the draft back to the widget filter', () => {
    // On the widget an amount is a filter; in the form it is a commitment.
    // Editing the form must not silently re-filter the book behind it.
    setPayInput('0.25')
    seedOfferDraft({ eth: payInput(), xmr: '1.205' })
    setDraftEth('9.9')
    expect(payInput()).toBe('0.25')
    setPayInput('')
  })

  it('seeds a figure the form can actually parse', () => {
    // The widget formats for display; the form parses. A seeded value that
    // round-trips through neither is how a prefilled form silently refuses to
    // submit, so the seed uses full precision rather than the display string.
    const estimated = estimateXmr(parseEther('0.25'), 4.82)
    seedOfferDraft({ eth: '0.25', xmr: formatXmr(estimated, 12) })
    expect(tryParseXmr(draftXmr())).toBe(estimated)
  })
})

describe('the going rate has one definition', () => {
  it('inlines a mark for XMR because no chain-keyed host has one', () => {
    // XMR is not an EVM token, so there is no (chain, address) to look up. Asking
    // anyway is a guaranteed 404 on the one currency present on every screen.
    expect(logoCandidates(XMR)).toEqual([])
  })

  it('skips the request entirely on a chain with no artwork', () => {
    // Sepolia has no directory on the asset host — not even for native currency.
    // Firing the doomed request first and falling back on error works, but costs
    // a guaranteed round trip per token and fills the console with what looks
    // like a bug. So a testnet token resolves straight to its mainnet twin.
    const sepoliaUsdc = {
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
      address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' as const,
      chainId: 11155111,
    }
    const candidates = logoCandidates(sepoliaUsdc)
    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toContain('/token/1/')
    expect(candidates[0]).not.toContain('11155111')

    // A mainnet token asks about itself, with no fallback needed.
    const mainnetUsdc = { ...sepoliaUsdc, chainId: 1, address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as const }
    expect(logoCandidates(mainnetUsdc)[0]).toContain('/token/1/0xA0b8')
  })

  it('keys native currency by the sentinel the host actually uses', () => {
    // The zero address — which this app and Uniswap both use for native — 404s.
    const candidates = logoCandidates(nativeOf(1))
    expect(candidates[0]).toMatch(/0xEeee/i)
    expect(candidates[0]).not.toContain('0x0000000000000000000000000000000000000000')
  })
})

describe('both directions are first class', () => {
  // The protocol is symmetric: an offer has an ETH leg and an XMR leg, and either
  // can be the side a reader is parting with. Matching used to assume ETH, which
  // is what left "You pay" uneditable when selling XMR — the input was pinned to
  // the ETH leg and slid down to the receive field.
  const book = [
    offer({ kind: 'BUY', state: 'OPEN', offerId: 1n, amount: parseEther('0.25'), xmrAmount: xmr('1.205') }),
    offer({ kind: 'BUY', state: 'OPEN', offerId: 2n, amount: parseEther('0.5'), xmrAmount: xmr('2.5') }),
  ]

  it('matches on the XMR leg when XMR is what you are paying', () => {
    // Someone with 1.205 XMR to sell wants the offer whose *XMR* side is 1.205.
    const result = matchOffers(book, { leg: 'xmr', amount: xmr('1.205') }, 'BUY')
    expect(result.verdict).toBe('exact')
    expect(result.best?.offer.offerId).toBe(1n)
    expect(result.leg).toBe('xmr')
  })

  it('reports deltas in the unit that was typed', () => {
    // 2.5 XMR against a 1.205 ask is not "1.295 ETH more" — saying so in the
    // wrong unit is worse than not saying it.
    const result = matchOffers(book, { leg: 'xmr', amount: xmr('1.3') }, 'BUY', 2)
    const two = result.near.find((m) => m.offer.offerId === 2n)
    expect(two?.delta).toBe(xmr('2.5') - xmr('1.3'))
  })

  it('does not confuse the legs when the numbers could be either', () => {
    // An offer of 0.25 ETH for 1.205 XMR: asking for 0.25 on the XMR leg must
    // not match it, even though 0.25 is exactly its ETH size.
    const onEth = matchOffers(book, { leg: 'eth', amount: parseEther('0.25') }, 'BUY')
    const onXmr = matchOffers(book, { leg: 'xmr', amount: xmr('0.25') }, 'BUY')
    expect(onEth.verdict).toBe('exact')
    expect(onXmr.verdict).toBe('none')
  })

  it('derives the pay leg from the direction, and the readout from the other', () => {
    setDirectionTo('eth-to-xmr')
    expect(payLeg()).toBe('eth')
    expect(receiveLeg()).toBe('xmr')

    setDirectionTo('xmr-to-eth')
    expect(payLeg()).toBe('xmr')
    expect(receiveLeg()).toBe('eth')
  })

  it('parses the typed amount in its own leg’s units', () => {
    // 12 decimals for XMR, 18 for ETH. Parsing one as the other is off by 10^6.
    setDirectionTo('xmr-to-eth')
    setPayInput('1.205')
    expect(payAmount()).toBe(xmr('1.205'))
    expect(want()).toEqual({ leg: 'xmr', amount: xmr('1.205') })

    setDirectionTo('eth-to-xmr')
    expect(payAmount()).toBe(parseEther('1.205'))
    setPayInput('')
  })

  it('converts in both directions and round-trips', () => {
    const eth = parseEther('0.25')
    const asXmr = estimateXmr(eth, 4.82)
    expect(asXmr).toBe(xmr('1.205'))
    // Back again, within the rounding the scaling allows.
    const back = estimateEth(asXmr, 4.82)
    expect(back).toBe(eth)
  })

  it('carries the readout into the input when the pair is flipped', () => {
    // Keeping the digits would silently change the trade: 0.25 ETH is not
    // 0.25 XMR. Moving the readout up is the same trade from the other side.
    setDirectionTo('eth-to-xmr')
    setPayInput('0.25')
    flipDirection(formatXmr(estimateXmr(parseEther('0.25'), 4.82), 12))
    expect(payLeg()).toBe('xmr')
    expect(payAmount()).toBe(xmr('1.205'))

    // And with nothing to carry, the field clears rather than keeping a number
    // that no longer means anything.
    flipDirection()
    expect(payInput()).toBe('')
    setDirectionTo('eth-to-xmr')
  })
})

describe('the Monero side, ported from upstream', () => {
  // These are the utilities `v3xlabs/xmrp2p` already had, restated here rather
  // than depended on (its library is a private workspace package; the `xmrp2p`
  // name on npm is an unrelated empty placeholder). The tests exist because two
  // of them are the difference between a recoverable trade and lost coins.

  it('writes keys in Monero’s byte order, not the contract’s', () => {
    // The contract stores a big-endian integer of the compressed point; a Monero
    // wallet reads the same 32 bytes little-endian. Handing over the contract's
    // integer produces a string that pastes cleanly and restores a *different*
    // wallet — which is the worst possible failure mode, because it looks fine.
    const key = 0x00112233445566778899aabbccddeeff00112233445566778899aabbccddeeffn
    const contractHex = key.toString(16).padStart(64, '0')
    const moneroHex = toMoneroKeyHex(key)

    expect(moneroHex).not.toBe(contractHex)
    expect(moneroHex).toBe(
      (contractHex.match(/../g) as string[]).reverse().join(''),
    )
    // And it is still a 32-byte key.
    expect(moneroHex).toHaveLength(64)
  })

  it('aggregates the escrow spend key so neither side can spend alone', () => {
    // The escrow's spend point is the sum of both sides' public spend points, so
    // the private key is the sum of the halves — and only exists once one side
    // publishes. That is the whole atomicity guarantee.
    const evm = fromMnemonic(
      'legal winner thank year wave sausage worth useful legal winner thank yellow',
    )
    const xmr = fromMnemonic(
      'letter advice cage absurd amount doctor acoustic avoid letter advice cage above',
    )

    const escrow = computeEscrowWallet({
      evmPublicSpendKey: evm.publicSpend,
      evmPublicViewKey: evm.publicView,
      xmrPublicSpendKey: xmr.publicSpend,
      xmrPrivateViewKey: xmr.privateView,
    })

    // Aggregated point == the point of the aggregated scalar.
    const combined = combinePrivateKeys(evm.privateSpend, xmr.privateSpend)
    expect(escrow.publicSpendKey).toBe(pointToUint256(combined))
    // Neither half alone opens it.
    expect(escrow.publicSpendKey).not.toBe(evm.publicSpend)
    expect(escrow.publicSpendKey).not.toBe(xmr.publicSpend)
  })

  it('encodes an address that decodes back, checksum and all', () => {
    // Nothing on-chain validates an address, so this is checked by round-trip
    // rather than by inspection: one wrong byte sends the XMR nowhere reachable.
    const spend = pointToUint256(0xdeadbeefn)
    const view = pointToUint256(0xfeedfacen)
    const address = encodeMoneroAddress(spend, view, true)

    // Monero standard mainnet addresses: 95 characters, leading '4'.
    expect(address).toHaveLength(95)
    expect(address.startsWith('4')).toBe(true)

    const hex = decodeMoneroAddress(address)
    expect(hex.slice(0, 2)).toBe('12') // mainnet prefix
    expect(BigInt(`0x${hex.slice(2, 66)}`)).toBe(spend)
    expect(BigInt(`0x${hex.slice(66, 130)}`)).toBe(view)

    // Stagenet is a different prefix and a different leading character.
    expect(encodeMoneroAddress(spend, view, false).startsWith('5')).toBe(true)
  })

  it('regenerates the same keys from the same phrase', () => {
    // The reason keys are seed-derived at all: a bare random scalar lives only in
    // the browser that drew it, so clearing site data and losing the trade were
    // the same action.
    const phrase = 'legal winner thank year wave sausage worth useful legal winner thank yellow'
    const a = fromMnemonic(phrase)
    const b = fromMnemonic(`  ${phrase}  `)
    expect(b.privateSpend).toBe(a.privateSpend)
    expect(b.publicSpend).toBe(a.publicSpend)
    // And the view key follows from the spend key, as Monero derives it.
    expect(b.privateView).toBe(a.privateView)
    expect(a.privateSpend).toBeLessThan(ED25519_L)
    expect(a.privateView).toBeLessThan(ED25519_L)
  })

  it('builds wallet URIs with little-endian keys', () => {
    const pair = fromMnemonic(
      'legal winner thank year wave sausage worth useful legal winner thank yellow',
    )
    const address = encodeMoneroAddress(pair.publicSpend, pair.publicView, true)

    const view = moneroViewUri(address, pair.privateView, 'order-37', 3_400_000)
    expect(view).toContain(`view_key=${toMoneroKeyHex(pair.privateView)}`)
    expect(view).toContain('height=3400000')

    const sweep = moneroWalletUri(address, pair.privateSpend, pair.privateView, 'order-37')
    expect(sweep).toContain(`spend_key=${toMoneroKeyHex(pair.privateSpend)}`)
    // A restore height is optional and absent rather than zero when unknown.
    expect(sweep).not.toContain('height=')

    expect(moneroPaymentUri(address, '0.5')).toBe(`monero:${address}?tx_amount=0.5`)
  })
})

describe('the QR codes carry a real payload', () => {
  // The QR is what makes the Monero side usable at all — the alternative is
  // retyping a 95-character address and two 64-character keys into a phone. So
  // what matters is that the *encoded string* is correct, which is testable
  // without rendering anything.
  const pair = fromMnemonic(
    'legal winner thank year wave sausage worth useful legal winner thank yellow',
  )
  const other = fromMnemonic(
    'letter advice cage absurd amount doctor acoustic avoid letter advice cage above',
  )
  const escrow = computeEscrowWallet({
    evmPublicSpendKey: pair.publicSpend,
    evmPublicViewKey: pair.publicView,
    xmrPublicSpendKey: other.publicSpend,
    xmrPrivateViewKey: other.privateView,
  })
  const address = encodeMoneroAddress(escrow.publicSpendKey, escrow.publicViewKey, false)

  it('addresses the escrow, not either party', () => {
    // Paying a party's own address instead of the aggregate would send the coins
    // somewhere only one side controls — no escrow at all.
    const solo = encodeMoneroAddress(pair.publicSpend, pair.publicView, false)
    expect(address).not.toBe(solo)
    expect(decodeMoneroAddress(address).slice(0, 2)).toBe('18') // stagenet
  })

  it('encodes a sweep URI inside QR capacity', () => {
    // Address plus two keys plus a label is ~390 characters. A payment URI is
    // a third of that. Both must actually encode, and the long one is the
    // constraint worth asserting.
    const view = combinePrivateKeys(pair.privateView, other.privateView)
    const spend = combinePrivateKeys(pair.privateSpend, other.privateSpend)
    const uri = moneroWalletUri(address, spend, view, 'Noktoswap Sepolia #37')

    expect(uri.length).toBeGreaterThan(300)
    // Alphanumeric-mode QR tops out around 4296 characters; this is nowhere near,
    // which is the point of checking rather than assuming.
    expect(uri.length).toBeLessThan(1000)
    expect(uri).toContain(`spend_key=${toMoneroKeyHex(spend)}`)
    expect(uri).toContain(`view_key=${toMoneroKeyHex(view)}`)
  })

  it('keeps the view URI unable to spend', () => {
    // The whole reason the EVM side gets a view URI and not a wallet URI: it must
    // be able to verify the deposit without being able to take it.
    const view = combinePrivateKeys(pair.privateView, other.privateView)
    const uri = moneroViewUri(address, view, 'Noktoswap Sepolia #37')
    expect(uri).toContain('view_key=')
    expect(uri).not.toContain('spend_key=')
  })
})

describe('finishing a post lands somewhere useful', () => {
  it('reads the new offer id out of the receipt, not the indexer', () => {
    // The book is indexed and lags by design, so landing on it straight after
    // posting can show nothing — which looks exactly like a failed post. The id
    // is in the log the transaction just emitted.
    const topic = toEventSelector('OfferEvent(uint256,uint8,uint8)')
    const logs = [
      { topics: ['0xdeadbeef' as const] }, // something else entirely
      {
        topics: [
          topic,
          `0x${(37n).toString(16).padStart(64, '0')}` as const, // offer id
          `0x${(1n).toString(16).padStart(64, '0')}` as const, // kind
          `0x${(1n).toString(16).padStart(64, '0')}` as const, // state
        ],
      },
    ]
    expect(offerIdFromReceipt(logs)).toBe(37n)
  })

  it('returns null rather than throwing when the log is absent', () => {
    // A missing id costs a nicer landing, not the trade — the offer exists
    // on-chain either way, so this must not become an error path.
    expect(offerIdFromReceipt([{ topics: ['0xdeadbeef' as const] }])).toBeNull()
    expect(offerIdFromReceipt([])).toBeNull()
  })

  it('clears the draft so a posted offer is not offered again', () => {
    setDraftEth('0.25')
    setDraftXmr('1.205')
    clearDraft()
    expect(draftEth()).toBe('')
    expect(draftXmr()).toBe('')
  })
})

describe('no amount typed is a state, not a failure', () => {
  const book = [
    offer({ kind: 'SELL', state: 'OPEN', offerId: 1n, amount: parseEther('0.25'), xmrAmount: xmr('1.205') }),
    offer({ kind: 'SELL', state: 'OPEN', offerId: 2n, amount: parseEther('0.5'), xmrAmount: xmr('2.6') }),
    offer({ kind: 'BUY', state: 'OPEN', offerId: 3n, amount: parseEther('1'), xmrAmount: xmr('5') }),
  ]

  it('shows the whole book rather than an empty result', () => {
    // This used to fall through the NEAR branch with empty bands, producing a
    // screen that offered "0 near offers" while reporting the book had one, and a
    // summary line reading "0 ETH → —". An unfiltered book is the whole book.
    const result = matchOffers(book, null, 'SELL')
    expect(result.verdict).toBe('any')
    expect(result.all).toHaveLength(2) // both SELL offers, not the BUY
    expect(result.exact).toHaveLength(0)
    expect(result.near).toHaveLength(0)
  })

  it('sorts the unfiltered book by rate, best first', () => {
    const result = matchOffers(book, null, 'SELL')
    // 2.6/0.5 = 5.2 beats 1.205/0.25 = 4.82.
    expect(result.all[0]?.offer.offerId).toBe(2n)
  })

  it('leaves the delta null, because there is nothing to be near to', () => {
    // A row cannot be "0.02 more" than nothing. A zero delta would claim a
    // precision the reader never asked for, and render a misleading pill.
    const result = matchOffers(book, null, 'SELL')
    expect(result.all.every((m) => m.delta === null)).toBe(true)
  })

  it('still says NONE when the book really is empty', () => {
    expect(matchOffers([], null, 'SELL').verdict).toBe('none')
  })

  it('treats a zero amount the same as no amount', () => {
    expect(matchOffers(book, { leg: 'eth', amount: 0n }, 'SELL').verdict).toBe('any')
  })
})

describe('the receive readout has one definition', () => {
  const book = [
    offer({ kind: 'BUY', state: 'OPEN', offerId: 1n, amount: parseEther('0.25'), xmrAmount: xmr('1.205') }),
  ]

  it('estimates the ETH leg when XMR is what is being sold', () => {
    // The bug this replaces: the widget estimated and the results summary did not,
    // so selling XMR autofilled an ETH figure on one screen and showed a dash on
    // the other. Both read `receiveAmountFor` now.
    const want = { leg: 'xmr' as const, amount: xmr('1.0') }
    const matching = matchOffers(book, want, 'BUY')
    expect(matching.verdict).not.toBe('exact')

    const value = receiveAmountFor(matching, want, matching.rate)
    expect(value).not.toBeNull()
    // 1.0 XMR at 4.82 XMR/ETH is about 0.207 ETH.
    expect(value).toBe(estimateEth(xmr('1.0'), matching.rate as number))
  })

  it('prefers a matched offer’s real figure over an estimate', () => {
    const want = { leg: 'xmr' as const, amount: xmr('1.205') }
    const matching = matchOffers(book, want, 'BUY')
    expect(matching.verdict).toBe('exact')
    // The offer's own ETH amount, not a rate-derived approximation of it.
    expect(receiveAmountFor(matching, want, matching.rate)).toBe(parseEther('0.25'))
  })

  it('has nothing to show without an amount or a rate', () => {
    const matching = matchOffers(book, null, 'BUY')
    expect(receiveAmountFor(matching, null, matching.rate)).toBeNull()
    expect(receiveAmountFor(matching, { leg: 'eth', amount: parseEther('1') }, null)).toBeNull()
  })
})

describe('an offer is identified by chain and id, never id alone', () => {
  const MAINNET = 1
  const BASE = 8453

  it('keeps same-numbered offers on different chains distinct', () => {
    // Ids restart at 1 on every deployment, so #1 exists on all three chains.
    // Anything keyed by id alone silently collapses them.
    const book = [
      offer({ chainId: SEPOLIA, offerId: 1n, kind: 'SELL', state: 'OPEN', amount: parseEther('0.25'), xmrAmount: xmr('1.2') }),
      offer({ chainId: MAINNET, offerId: 1n, kind: 'SELL', state: 'OPEN', amount: parseEther('0.25'), xmrAmount: xmr('1.3') }),
      offer({ chainId: BASE, offerId: 1n, kind: 'SELL', state: 'OPEN', amount: parseEther('0.25'), xmrAmount: xmr('1.1') }),
    ]
    const result = matchOffers(book, { leg: 'eth', amount: parseEther('0.25') }, 'SELL')
    expect(result.exact).toHaveLength(3)
    // And they are genuinely different trades — best rate wins, not first seen.
    expect(result.best?.offer.chainId).toBe(MAINNET)
  })

  it('matches across chains, because the book is one market', () => {
    // A reader does not care which chain has their size; switching to take one is
    // a single wallet prompt. What limits them is where their money already is,
    // which is what the chain picker's balances are for.
    const book = [
      offer({ chainId: MAINNET, offerId: 7n, kind: 'SELL', state: 'OPEN', amount: parseEther('1'), xmrAmount: xmr('5') }),
    ]
    const result = matchOffers(book, { leg: 'eth', amount: parseEther('1') }, 'SELL')
    expect(result.verdict).toBe('exact')
    expect(result.best?.offer.chainId).toBe(MAINNET)
  })

  it('reports open counts per chain and totals them', () => {
    const page = {
      offers: [],
      openByChain: new Map([
        [SEPOLIA, 1],
        [MAINNET, 0],
        [BASE, 4],
      ]),
      unreachable: [],
    }
    expect(totalOpen(page)).toBe(5)
    // A chain that answered with zero is not the same fact as one that did not
    // answer — the first is in the map, the second is in `unreachable`.
    expect(page.openByChain.has(MAINNET)).toBe(true)
  })

  it('counts only the chains that answered', () => {
    // One unreachable subgraph must not be reported as an empty market.
    const page = {
      offers: [],
      openByChain: new Map([[SEPOLIA, 2]]),
      unreachable: [{ chainId: BASE, reason: 'noktoswap-base responded 502' }],
    }
    expect(totalOpen(page)).toBe(2)
    expect(page.openByChain.has(BASE)).toBe(false)
  })

  it('knows which chains can be traded on and which are indexed', () => {
    // Deployed and indexed are different facts: Base Sepolia has a contract and
    // no subgraph, so it can be traded by id but not browsed.
    expect(isTradable(SEPOLIA)).toBe(true)
    expect(isTradable(MAINNET)).toBe(true)
    // Arbitrum is no longer in the registry at all, so this now tests the
    // unknown-chain path rather than the known-but-undeployed one. Both must
    // answer false, and a wallet sitting on an unoffered chain is the likelier
    // case of the two.
    expect(isTradable(42161)).toBe(false)
    expect(isTradable(undefined)).toBe(false)
    // The modelled state itself, without needing an undeployed chain to exist:
    // `deployment: null` is what makes a chain untradable, and ChainPicker's
    // "not deployed" row still reads from exactly this.
    expect(CHAINS.every((c) => c.deployment !== null)).toBe(true)
    expect(CHAINS.filter((c) => c.deployment === null)).toEqual([])

    const indexed = indexedChains().map((c) => c.chain.id)
    expect(indexed).toContain(SEPOLIA)
    expect(indexed).toContain(MAINNET)
    expect(indexed).toContain(BASE)
    expect(indexed).not.toContain(84532) // Base Sepolia: deployed, no subgraph

    const gap = deployedButUnindexed().map((c) => c.chain.id)
    expect(gap).toEqual([84532])
  })
})

describe('a thin book does not get to set the rate', () => {
  const at = (rate: number, id: bigint) =>
    offer({
      offerId: id,
      kind: 'SELL',
      state: 'OPEN',
      amount: parseEther('1'),
      xmrAmount: xmr(String(rate)),
    })

  it('refuses to call one offer a going rate', () => {
    // The bug: a fresh deployment's single test offer was priced at ~482 XMR/ETH
    // against a real rate near 4.8, and the widget presented it as "the book's
    // going rate". A median of one is that one offer.
    expect(bookGoingRate([at(482, 1n)], 4.8)).toBeNull()
    expect(bookGoingRate([at(4.8, 1n), at(4.9, 2n)], 4.8)).toBeNull()
  })

  it('uses the book once there is a book', () => {
    const rate = bookGoingRate([at(4.7, 1n), at(4.8, 2n), at(4.9, 3n)], 4.8)
    expect(rate).toBe(4.8)
  })

  it('rejects a book that has drifted implausibly from the feed', () => {
    // Three offers is a sample, but three offers priced a hundred times off is a
    // mispriced book, not a market that happens to disagree with the feed.
    expect(bookGoingRate([at(480, 1n), at(482, 2n), at(484, 3n)], 4.8)).toBeNull()
    // A normal disagreement is still the book's to make — it is the thing a maker
    // actually competes with.
    expect(bookGoingRate([at(5.4, 1n), at(5.5, 2n), at(5.6, 3n)], 4.8)).toBe(5.5)
  })

  it('trusts the book when there is no feed to check against', () => {
    // No reference means no sanity check available — but the sample rule still
    // applies, so this is a real book either way.
    expect(bookGoingRate([at(480, 1n), at(482, 2n), at(484, 3n)], null)).toBe(482)
  })

  it('ignores offers that are not open', () => {
    const book = [at(4.8, 1n), at(4.9, 2n), { ...at(5.0, 3n), state: 'CANCELLED' as const }]
    expect(bookGoingRate(book, 4.8)).toBeNull()
  })
})

describe('test money and real money are different markets', () => {
  it('never lets a testnet chain see a mainnet one, or the reverse', () => {
    // The bug: a wallet on Ethereum was shown the single Sepolia offer and its
    // price. The design's "one book, not four" means Ethereum/Optimism/Arbitrum/
    // Base — mainnets one wallet prompt apart. Sepolia is only here because it is
    // where the contract landed first.
    expect(realmOf(1)).toBe('mainnet')
    expect(realmOf(8453)).toBe('mainnet')
    expect(realmOf(11155111)).toBe('testnet')
    expect(realmOf(84532)).toBe('testnet')

    expect(sameRealm(1, 8453)).toBe(true)
    expect(sameRealm(1, 11155111)).toBe(false)
    expect(sameRealm(11155111, 84532)).toBe(true)
  })

  it('shows a mainnet reader only indexed mainnets', () => {
    const ids = visibleChains(1).map((c) => c.chain.id)
    expect(ids).toContain(1)
    expect(ids).toContain(8453)
    expect(ids).not.toContain(11155111)
  })

  it('shows a testnet reader only indexed testnets', () => {
    const ids = visibleChains(11155111).map((c) => c.chain.id)
    expect(ids).toEqual([11155111])
    // Base Sepolia is deployed but unindexed, so it has no book to show.
    expect(ids).not.toContain(84532)
  })

  it('pairs the Monero network to the realm, which is why this matters', () => {
    // A testnet chain yields a stagenet escrow address. If the realms shared a
    // book, a mainnet reader could act on an offer whose escrow is stagenet.
    expect(chainInfo(1)?.moneroMainnet).toBe(true)
    expect(chainInfo(8453)?.moneroMainnet).toBe(true)
    expect(chainInfo(11155111)?.moneroMainnet).toBe(false)
    expect(chainInfo(84532)?.moneroMainnet).toBe(false)

    for (const info of CHAINS) {
      // The pairing must hold for every chain, not just the ones checked above.
      expect(info.moneroMainnet).toBe(realmOf(info.chain.id) === 'mainnet')
    }
  })
})

describe('on an OPEN offer, counterparty is a restriction not a party', () => {
  // Caught by comparing against v3xlabs/xmrp2p, which gates Take on
  // `counterparty === 0x0 || counterparty === me`. `take` is what promotes the
  // field to a party, by overwriting it with the taker.
  const reserved = (to: Address) =>
    offer({ kind: 'BUY', state: 'OPEN', owner: ALICE, counterparty: to })

  it('does not make the reserved taker a party before they take', () => {
    // This showed BOB the maker's Cancel button, which reverts — he is not the
    // owner. Until an offer is taken, the maker is the only party.
    expect(sideOf(reserved(BOB), BOB)).toBe('none')
    const status = orderStatus(reserved(BOB), BOB, 0)
    expect(status.secondary?.kind).not.toBe('cancel')
    expect(status.primary?.kind).toBe('take')
  })

  it('offers no button to someone the offer is not for', () => {
    // This showed CAROL "Take this offer", which reverts with ErrorNonMember.
    const status = orderStatus(reserved(BOB), CAROL, 0)
    expect(status.primary).toBeNull()
    expect(status.headline).toMatch(/reserved/i)
    expect(canTake(reserved(BOB), CAROL)).toBe(false)
  })

  it('still lets the maker cancel their own reserved offer', () => {
    const status = orderStatus(reserved(BOB), ALICE, 0)
    expect(status.secondary?.kind).toBe('cancel')
    expect(canTake(reserved(BOB), ALICE)).toBe(false)
  })

  it('mirrors the contract on an unrestricted offer', () => {
    const open = offer({ kind: 'BUY', state: 'OPEN', owner: ALICE, counterparty: null })
    expect(canTake(open, CAROL)).toBe(true)
    // …but never the maker: `require(msg.sender != offer.owner)`.
    expect(canTake(open, ALICE)).toBe(false)
    expect(canTake(open, undefined)).toBe(false)
  })

  it('treats counterparty as a party once the offer is taken', () => {
    // After `take`, the field holds the actual taker and the roles apply.
    const taken = offer({ kind: 'BUY', state: 'TAKEN', owner: ALICE, counterparty: BOB })
    expect(sideOf(taken, BOB)).toBe('xmr')
    expect(sideOf(taken, ALICE)).toBe('evm')
    expect(canTake(taken, CAROL)).toBe(false)
  })
})

describe('the Permit2 payload is reshaped, not passed through', () => {
  /**
   * Captured verbatim from a live EXACT_OUTPUT quote (USDC → ETH, mainnet). The
   * integers are strings because JSON has no integer type, and `amount` is the
   * uint160 max — 49 digits, far past Number.MAX_SAFE_INTEGER.
   */
  const LIVE: PermitData = {
    domain: {
      name: 'Permit2',
      chainId: 1,
      verifyingContract: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
    },
    types: {
      PermitSingle: [
        { name: 'details', type: 'PermitDetails' },
        { name: 'spender', type: 'address' },
        { name: 'sigDeadline', type: 'uint256' },
      ],
      PermitDetails: [
        { name: 'token', type: 'address' },
        { name: 'amount', type: 'uint160' },
        { name: 'expiration', type: 'uint48' },
        { name: 'nonce', type: 'uint48' },
      ],
    },
    values: {
      details: {
        token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        amount: '1461501637330902918203684832716283019655932542975',
        expiration: '1791839145',
        nonce: '0',
      },
      spender: '0x66a9893cc07d91d95644aedd05d03f95e1dba8af',
      sigDeadline: '1789248945',
    },
  }

  it('signs the type nothing else references', () => {
    // PermitSingle mentions PermitDetails, so PermitDetails is a dependency.
    // Taking the first key would pass here and break on any reordering.
    expect(permitTypedData(LIVE).primaryType).toBe('PermitSingle')

    const reordered: PermitData = {
      ...LIVE,
      types: { PermitDetails: LIVE.types.PermitDetails!, PermitSingle: LIVE.types.PermitSingle! },
    }
    expect(permitTypedData(reordered).primaryType).toBe('PermitSingle')
  })

  it('coerces integers to bigint without losing precision', () => {
    const message = permitTypedData(LIVE).message as {
      details: { amount: bigint; expiration: bigint; nonce: bigint; token: string }
      sigDeadline: bigint
    }

    // The whole reason this is not Number(): 2^160 - 1 exactly, not rounded.
    expect(message.details.amount).toBe(2n ** 160n - 1n)
    expect(message.details.amount).toBe(1461501637330902918203684832716283019655932542975n)
    expect(message.details.expiration).toBe(1791839145n)
    // Zero must survive as 0n, not become undefined or ''.
    expect(message.details.nonce).toBe(0n)
    expect(message.sigDeadline).toBe(1789248945n)

    // Addresses are not integers and must pass through untouched — checksum and all.
    expect(message.details.token).toBe('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')
  })

  it('what Number() would have done to that amount', () => {
    // Documents the bug this function exists to avoid: the wallet would have
    // displayed and signed a different allowance than the one granted.
    const lossy = BigInt(Number('1461501637330902918203684832716283019655932542975'))
    expect(lossy).not.toBe(2n ** 160n - 1n)
  })

  it('recurses into nested structs and arrays', () => {
    const batch: PermitData = {
      domain: { chainId: 1 },
      types: {
        PermitBatch: [
          { name: 'details', type: 'PermitDetails[]' },
          { name: 'sigDeadline', type: 'uint256' },
        ],
        PermitDetails: [{ name: 'amount', type: 'uint160' }],
      },
      values: {
        details: [{ amount: '1' }, { amount: '2' }],
        sigDeadline: '99',
      },
    }
    const message = permitTypedData(batch).message as {
      details: { amount: bigint }[]
      sigDeadline: bigint
    }
    expect(message.details.map((d) => d.amount)).toEqual([1n, 2n])
    expect(message.sigDeadline).toBe(99n)
  })

  it('refuses a payload whose message type is ambiguous', () => {
    // Better to fail loudly than sign the wrong struct.
    const twoRoots: PermitData = {
      domain: {},
      types: { A: [{ name: 'x', type: 'uint256' }], B: [{ name: 'y', type: 'uint256' }] },
      values: {},
    }
    expect(() => permitTypedData(twoRoots)).toThrow(/cannot tell which type to sign/)
  })
})

describe('a chain can be readable without being offerable', () => {
  it('keeps Optimism reachable but unlisted', () => {
    // The registry offers it to nobody...
    expect(CHAINS.map((c) => c.chain.id)).not.toContain(10)
    expect(chainInfo(10)).toBeUndefined()
    // ...and says so honestly rather than inventing a label.
    expect(chainLabel(10)).toBe('Chain 10')
    expect(isTradable(10)).toBe(false)

    /*
     * ...but wagmi must still hold a transport for it, because Chainlink's
     * mainnet XMR/USD proxy is decommissioned and `lib/oracle.ts` reads the
     * Optimism pair instead. Removing it from the config typechecks and builds
     * fine and then throws at runtime on the rate ladder's last rung, which is
     * the failure this guards.
     */
    expect(READ_ONLY_CHAINS.map((c) => c.id)).toContain(10)
    expect(config.chains.map((c) => c.id)).toContain(10)
  })

  it('offers every chain it can trade on', () => {
    // The converse: nothing offerable may be missing a transport.
    for (const info of CHAINS) {
      expect(config.chains.map((c) => c.id)).toContain(info.chain.id)
    }
  })
})
