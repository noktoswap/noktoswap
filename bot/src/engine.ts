import { formatEther, type Address } from 'viem'
import { computeEscrowWallet, encodeMoneroAddress, toMoneroKeyHex, combinePrivateKeys } from '../../web/src/lib/monero'
import { keysForOpen, keysForQuit, keysForTake, type Keypair } from '../../web/src/lib/keys'
import type { Chain, OnChainOffer } from './chain'
import { sideOf } from './chain'
import type { Keystore } from './keystore'
import { formatXmr, type MoneroBackend } from './monero/backend'

/**
 * What to do next about an offer this bot is party to.
 *
 * The contract's gates are transcribed here rather than approximated, because
 * every one of them is a deadline and the penalty for reading one wrong is either
 * a refund that did not need to happen or a claim window missed entirely:
 *
 *   ready  — TAKEN, now <= t0, caller is the EVM side
 *   claim  — (TAKEN and t0 < now <= t1) or (READY and now <= t1), XMR side
 *   quit   — XMR side: READY or TAKEN, now > t1
 *            EVM side: (TAKEN and (now <= t0 or now > t1)) or (READY and now > t1),
 *                      and for a SELL never in the block it was taken in
 *
 * Note `ready` and the EVM side's early `quit` share a window. Before `t0` the EVM
 * side may either confirm the deposit or walk away, and which it should do depends
 * on whether the XMR actually arrived — the one question the chain cannot answer
 * and a Monero scan can.
 */

export type Action =
  | { kind: 'wait'; why: string; deadline: bigint | null }
  | { kind: 'send-xmr'; escrow: string; atomic: bigint }
  | { kind: 'ready'; escrow: string; received: bigint; required: bigint }
  | { kind: 'claim'; reveals: bigint }
  | { kind: 'quit'; side: 'evm' | 'xmr'; why: string }
  | { kind: 'sweep'; escrow: string; combined: bigint }
  | { kind: 'attention'; why: string }
  | { kind: 'done'; why: string }

export type Position = {
  offer: OnChainOffer
  side: 'evm' | 'xmr'
  ref: string | null
  pair: Keypair | null
  action: Action
}

const secondsLeft = (deadline: bigint, now: bigint): string => {
  const delta = Number(deadline - now)
  if (delta <= 0) return 'passed'
  if (delta < 120) return `${delta}s`
  if (delta < 7200) return `${Math.round(delta / 60)}m`
  return `${Math.round(delta / 3600)}h`
}

/**
 * The escrow address both sides committed to.
 *
 * Only derivable once both halves are on-chain, which is why it is null before the
 * offer is taken. `moneroMainnet` is tied to the EVM chain rather than configured:
 * a Sepolia escrow must yield a *stagenet* address, or someone sends real coins
 * against a test trade.
 */
export const escrowAddressFor = (offer: OnChainOffer, mainnet: boolean): string | null => {
  if (offer.evmPublicSpendKey === 0n || offer.xmrPublicSpendKey === 0n) return null
  if (offer.evmPublicViewKey === 0n || offer.xmrPrivateViewKey === 0n) return null
  const escrow = computeEscrowWallet({
    evmPublicSpendKey: offer.evmPublicSpendKey,
    evmPublicViewKey: offer.evmPublicViewKey,
    xmrPublicSpendKey: offer.xmrPublicSpendKey,
    xmrPrivateViewKey: offer.xmrPrivateViewKey,
  })
  return encodeMoneroAddress(escrow.publicSpendKey, escrow.publicViewKey, mainnet)
}

/**
 * Decide the next action for one offer.
 *
 * `now` is chain time, not wall time. The contract compares against
 * `block.timestamp`, so a bot deciding from its own clock will act a few seconds
 * early or late at exactly the moment that matters.
 */
export const decide = async (args: {
  offer: OnChainOffer
  me: Address
  now: bigint
  mainnet: boolean
  pair: Keypair | null
  alreadySentXmr: boolean
  alreadySwept: boolean
  monero: MoneroBackend
}): Promise<Action> => {
  const { offer, me, now, mainnet, pair, alreadySentXmr, alreadySwept, monero } = args
  const side = sideOf(offer, me)
  if (!side) return { kind: 'done', why: 'not a party to this offer' }

  if (offer.state === 'CANCELLED') return { kind: 'done', why: 'cancelled' }
  if (offer.state === 'REFUNDED') {
    return { kind: 'done', why: 'refunded — both escrows returned' }
  }

  if (offer.state === 'OPEN') {
    return side === 'evm' || side === 'xmr'
      ? { kind: 'wait', why: 'open, waiting for a taker', deadline: null }
      : { kind: 'wait', why: 'open', deadline: null }
  }

  if (offer.state === 'CLAIMED') {
    // The XMR side revealed its spend scalar to collect the ETH, which is exactly
    // what lets the EVM side spend the escrow.
    if (side === 'xmr') return { kind: 'done', why: 'claimed — ETH collected' }
    if (alreadySwept) return { kind: 'done', why: 'claimed and escrow swept' }
    if (!pair) return { kind: 'attention', why: 'claimed, but the keys for this offer are missing — cannot sweep' }
    if (offer.xmrPrivateSpendKey === 0n) {
      return { kind: 'attention', why: 'claimed without a revealed spend key — should be impossible' }
    }
    const address = escrowAddressFor(offer, mainnet)
    if (!address) return { kind: 'attention', why: 'claimed but the escrow address cannot be derived' }
    return {
      kind: 'sweep',
      escrow: address,
      combined: combinePrivateKeys(pair.privateSpend, offer.xmrPrivateSpendKey),
    }
  }

  // ── TAKEN and READY: the live windows ────────────────────────────────────
  const escrow = escrowAddressFor(offer, mainnet)

  if (side === 'xmr') {
    if (now > offer.t1) {
      return {
        kind: 'quit',
        side: 'xmr',
        why: `t1 passed ${secondsLeft(offer.t1, now)} ago — refund both escrows`,
      }
    }
    // Claim window: TAKEN only after t0, READY at any point up to t1.
    const claimable =
      (offer.state === 'TAKEN' && now > offer.t0) || offer.state === 'READY'
    if (claimable) {
      if (!pair) return { kind: 'attention', why: 'claimable, but the keys for this offer are missing' }
      return { kind: 'claim', reveals: pair.privateSpend }
    }
    // Still TAKEN and before t0: the counterparty is waiting on the deposit.
    if (!alreadySentXmr) {
      if (!escrow) return { kind: 'attention', why: 'taken but the escrow address cannot be derived yet' }
      return { kind: 'send-xmr', escrow, atomic: offer.xmrAmount }
    }
    return {
      kind: 'wait',
      why: `XMR sent, waiting for the EVM side to confirm (t0 in ${secondsLeft(offer.t0, now)})`,
      deadline: offer.t0,
    }
  }

  // ── the EVM side ─────────────────────────────────────────────────────────
  if (offer.state === 'READY') {
    if (now > offer.t1) {
      return { kind: 'quit', side: 'evm', why: 'ready but unclaimed past t1 — refund' }
    }
    return {
      kind: 'wait',
      why: `confirmed, waiting for the XMR side to claim (t1 in ${secondsLeft(offer.t1, now)})`,
      deadline: offer.t1,
    }
  }

  // TAKEN, EVM side. Before t0 it confirms or walks; after t1 it walks.
  if (now > offer.t1) {
    return { kind: 'quit', side: 'evm', why: 'never confirmed and t1 has passed — refund' }
  }
  if (now > offer.t0) {
    // Between t0 and t1 the EVM side cannot act at all: it missed `ready`, and
    // `quit` is closed until t1. The XMR side may still claim.
    return {
      kind: 'wait',
      why: `t0 missed — no action available to the EVM side until t1 (${secondsLeft(offer.t1, now)})`,
      deadline: offer.t1,
    }
  }

  if (!escrow) return { kind: 'attention', why: 'taken but the escrow address cannot be derived yet' }

  const view = toMoneroKeyHex(offer.xmrPrivateViewKey)
  const { received } = await monero.watch({ address: escrow, privateViewKey: view })
  if (received >= offer.xmrAmount) {
    return { kind: 'ready', escrow, received, required: offer.xmrAmount }
  }
  return {
    kind: 'wait',
    why: `escrow holds ${formatXmr(received)} of ${formatXmr(offer.xmrAmount)} XMR (t0 in ${secondsLeft(offer.t0, now)})`,
    deadline: offer.t0,
  }
}

/** A one-line description, for the log. */
export const describe = (position: Position): string => {
  const o = position.offer
  const pair = `${formatEther(o.amount)} ETH / ${formatXmr(o.xmrAmount)} XMR`
  return `#${o.id} ${o.kind} ${o.state} ${position.side} side · ${pair} · ${position.action.kind}`
}

/**
 * Carry out an action. Returns what happened, in words, for the caller to log.
 *
 * Writes go through `Chain.write`, which simulates first and is a no-op in dry-run
 * mode — so this function is safe to call on a live book with `--dry-run`, and that
 * is the intended way to inspect what the bot would do.
 */
export const perform = async (args: {
  position: Position
  chain: Chain
  keystore: Keystore
  monero: MoneroBackend
  payoutAddress: string | null
}): Promise<string> => {
  const { position, chain, keystore, monero, payoutAddress } = args
  const { offer, action, pair, ref } = position

  switch (action.kind) {
    case 'wait':
    case 'done':
      return action.why
    case 'attention':
      return `needs attention: ${action.why}`

    case 'send-xmr': {
      try {
        const txid = await monero.send(action.escrow, action.atomic)
        if (ref) keystore.patch(ref, { xmrSentTxid: txid })
        return `sent ${formatXmr(action.atomic)} XMR to the escrow (${txid})`
      } catch (cause) {
        return `could not fund the escrow: ${cause instanceof Error ? cause.message : String(cause)}`
      }
    }

    case 'ready': {
      const result = await chain.write('ready', [offer.id])
      return result.hash
        ? `confirmed the deposit of ${formatXmr(action.received)} XMR — ready() ${result.hash}`
        : `ready() not sent: ${result.reason}`
    }

    case 'claim': {
      const result = await chain.write('claim', [offer.id, action.reveals])
      return result.hash
        ? `claimed ${formatEther(offer.amount + offer.deposit)} ETH — ${result.hash}`
        : `claim() not sent: ${result.reason}`
    }

    case 'quit': {
      if (!pair) return 'cannot quit: the keys for this offer are missing'
      const keys = keysForQuit(action.side, pair)
      const result = await chain.write('quit', [offer.id, keys.spendingKey, keys.viewingKey])
      return result.hash ? `quit (${action.why}) — ${result.hash}` : `quit() not sent: ${result.reason}`
    }

    case 'sweep': {
      if (!payoutAddress) {
        return 'escrow is spendable but no --payout address was given to sweep it to'
      }
      try {
        const txid = await monero.sweep({
          address: action.escrow,
          privateSpendKey: toMoneroKeyHex(action.combined),
          privateViewKey: toMoneroKeyHex(
            combinePrivateKeys(pair?.privateView ?? 0n, offer.xmrPrivateViewKey),
          ),
          to: payoutAddress,
        })
        if (ref) keystore.patch(ref, { sweptTxid: txid })
        return `swept the escrow to ${payoutAddress} (${txid})`
      } catch (cause) {
        return `could not sweep: ${cause instanceof Error ? cause.message : String(cause)}`
      }
    }
  }
}

export { keysForOpen, keysForTake }
