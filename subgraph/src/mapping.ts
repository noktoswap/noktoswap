import { Address, BigInt, log } from "@graphprotocol/graph-ts"
import {
  OfferEvent as OfferEventLog,
  PayoutCredited as PayoutCreditedLog,
  Withdrawal as WithdrawalLog,
  Recovered as RecoveredLog,
  ParametersUpdated as ParametersUpdatedLog,
  XMRP2P,
} from "../generated/XMRP2P/XMRP2P"
import {
  Offer,
  OfferTransition,
  Account,
  PayoutCredit,
  AccountWithdrawal,
  OwnerRecovery,
  MarketParameters,
} from "../generated/schema"

const ZERO = BigInt.fromI32(0)

// Contract ordering, not flow ordering. See Enums.sol.
function offerStateName(raw: i32): string {
  if (raw == 1) return "OPEN"
  if (raw == 2) return "TAKEN"
  if (raw == 3) return "CANCELLED"
  if (raw == 4) return "REFUNDED"
  if (raw == 5) return "READY"
  if (raw == 6) return "CLAIMED"
  log.error("unexpected OfferState {}", [raw.toString()])
  return "OPEN"
}

function offerKindName(raw: i32): string {
  if (raw == 1) return "BUY"
  if (raw == 2) return "SELL"
  log.error("unexpected OfferType {}", [raw.toString()])
  return "BUY"
}

/**
 * OfferEvent carries three indexed topics and no data, so every field beyond
 * (id, kind, state) has to be read back from the contract. This is one archive
 * eth_call per state transition and is the reason the Substreams pipeline
 * exists — see PLAN.md. This mapping is the fallback path.
 */
function hydrate(offer: Offer, contract: Address, offerId: BigInt): void {
  const res = XMRP2P.bind(contract).try_offers(offerId)
  if (res.reverted) {
    log.warning("offers({}) reverted, entity left with defaults", [offerId.toString()])
    return
  }
  const o = res.value

  offer.owner = o.getOwner()

  // address(0) means the offer was posted open to anyone, not that a taker
  // exists with the zero address.
  const counterparty = o.getCounterparty()
  if (counterparty.equals(Address.zero())) {
    offer.counterparty = null
  } else {
    offer.counterparty = counterparty
  }

  offer.amount = o.getAmount()
  offer.deposit = o.getDeposit()
  offer.xmrAmount = o.getXmrAmount()

  // Deadlines are only stamped at take time; zero means "not taken yet".
  const t0 = o.getT0()
  const t1 = o.getT1()
  const blockTaken = o.getBlockTaken()
  offer.t0 = t0.equals(ZERO) ? null : t0
  offer.t1 = t1.equals(ZERO) ? null : t1
  offer.blockTaken = blockTaken.equals(ZERO) ? null : blockTaken

  // Deliberately flags, not values — see the privacy note in schema.graphql.
  offer.evmKeysRevealed = o.getEvmPrivateSpendKey().notEqual(ZERO)
  offer.xmrSpendKeyRevealed = o.getXmrPrivateSpendKey().notEqual(ZERO)
}

export function handleOfferEvent(event: OfferEventLog): void {
  const offerId = event.params.offer_id
  const id = offerId.toString()

  let offer = Offer.load(id)
  if (offer == null) {
    offer = new Offer(id)
    offer.offerId = offerId
    offer.createdAt = event.block.timestamp
    offer.createdBlock = event.block.number
    offer.createdTx = event.transaction.hash
    // Defaults so the entity is still saveable if hydration reverts.
    offer.owner = Address.zero()
    offer.amount = ZERO
    offer.deposit = ZERO
    offer.xmrAmount = ZERO
    offer.evmKeysRevealed = false
    offer.xmrSpendKeyRevealed = false
  }

  // State comes from the log rather than from storage: a hydration call reads
  // end-of-block state, which is wrong if an offer transitions twice in one
  // block. The topic is what actually happened at this log.
  const state = offerStateName(event.params.state)
  offer.kind = offerKindName(event.params.kind)
  offer.state = state
  offer.updatedAt = event.block.timestamp

  hydrate(offer, event.address, offerId)
  offer.save()

  const transition = new OfferTransition(
    id + "-" + event.transaction.hash.toHex() + "-" + event.logIndex.toString()
  )
  transition.offer = id
  transition.state = state
  transition.timestamp = event.block.timestamp
  transition.block = event.block.number
  transition.tx = event.transaction.hash
  transition.save()
}

function loadAccount(addr: Address): Account {
  const id = addr.toHex()
  let account = Account.load(id)
  if (account == null) {
    account = new Account(id)
    account.withdrawable = ZERO
    account.totalCredited = ZERO
    account.totalWithdrawn = ZERO
  }
  return account
}

/**
 * withdrawable is maintained from logs alone: credits accrue only in _payout's
 * failure branch and withdraw() always drains the full balance, so
 * sum(PayoutCredit) - sum(AccountWithdrawal) is exact with no eth_call.
 */
export function handlePayoutCredited(event: PayoutCreditedLog): void {
  const account = loadAccount(event.params.to)
  account.withdrawable = account.withdrawable.plus(event.params.amount)
  account.totalCredited = account.totalCredited.plus(event.params.amount)
  account.save()

  const credit = new PayoutCredit(
    event.transaction.hash.toHex() + "-" + event.logIndex.toString()
  )
  credit.account = account.id
  credit.amount = event.params.amount
  credit.timestamp = event.block.timestamp
  credit.block = event.block.number
  credit.tx = event.transaction.hash
  credit.save()
}

export function handleWithdrawal(event: WithdrawalLog): void {
  const account = loadAccount(event.params.to)
  account.withdrawable = account.withdrawable.minus(event.params.amount)
  account.totalWithdrawn = account.totalWithdrawn.plus(event.params.amount)
  account.save()

  const withdrawal = new AccountWithdrawal(
    event.transaction.hash.toHex() + "-" + event.logIndex.toString()
  )
  withdrawal.account = account.id
  withdrawal.amount = event.params.amount
  withdrawal.timestamp = event.block.timestamp
  withdrawal.block = event.block.number
  withdrawal.tx = event.transaction.hash
  withdrawal.save()
}

export function handleRecovered(event: RecoveredLog): void {
  const recovery = new OwnerRecovery(
    event.transaction.hash.toHex() + "-" + event.logIndex.toString()
  )
  recovery.to = event.params.to
  recovery.amount = event.params.amount
  recovery.timestamp = event.block.timestamp
  recovery.block = event.block.number
  recovery.tx = event.transaction.hash
  recovery.save()
}

export function handleParametersUpdated(event: ParametersUpdatedLog): void {
  const params = new MarketParameters(
    event.block.number.toString() + "-" + event.logIndex.toString()
  )

  // Positional access: the tuple order is fixed by the ABI and this is robust
  // to however codegen chooses to name SCREAMING_SNAKE components.
  const p = event.params.parameters
  params.minimumOffer = p[0].toBigInt()
  params.maximumOffer = p[1].toBigInt()
  params.depositRatio = p[2].toBigInt()
  params.maximumOfferBookSize = p[3].toBigInt()
  params.t0Delay = p[4].toBigInt()
  params.t1Delay = p[5].toBigInt()

  params.timestamp = event.block.timestamp
  params.block = event.block.number
  params.tx = event.transaction.hash
  params.save()
}
