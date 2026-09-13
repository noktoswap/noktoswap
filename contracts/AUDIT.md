# NoktoSwap contract review

Source reviewed: [`v3xlabs/xmrp2p`](https://github.com/v3xlabs/xmrp2p) at `4f74bd4`
("Deploy v1.1 to mainnet"), the version live at
`0xad6871d44804288ba4393464c63544d6691d76ba`.

Every finding below has a test in `test/NoktoSwapBugs.t.sol` that fails against the
original contract and passes against the fixed one. `test/NoktoSwapFlows.t.sol`
covers the reworked payout path, the new key validation, and both trade
directions end to end.

---

## H1 — the offer book cap is cumulative, so the contract bricks itself

```solidity
require(0 == MAXIMUM_OFFER_BOOK_SIZE || nextOfferId <= MAXIMUM_OFFER_BOOK_SIZE, ...)
```

`nextOfferId` only ever increases. The check is meant to bound the *book*, but it
bounds the number of offers ever created. Cancelling or completing an offer frees
nothing.

The mainnet deployment sets `MAXIMUM_OFFER_BOOK_SIZE = 100`, so `openOffer`
reverts permanently once 100 offers have been created — for everyone, forever,
with no owner function to reset it. `setParameters` can raise the cap, but that
only defers the same wall.

**Fix.** Track `openOfferCount`, incremented in `openOffer` and decremented in
`cancel` and `take`, and bound that instead.

## H2 — `take` silently confiscates overpayment

`take` required `msg.value >= deposit` (or `>= amount`) but only ever credited the
required figure to `liability`. The difference stayed in the contract, unowed to
anyone, and `recover()` let the owner withdraw it.

`Errors.sol` still declares `ErrorBuyOfferUnableToSendAmountDelta` and
`ErrorSellOfferUnableToSendAmountDelta`, which are referenced nowhere — the
upstream design refunded the delta and this contract dropped that step.

**Fix.** Refund the excess to the taker after the state transition.

**Why refund rather than reject.** `require(msg.value == required)` is the cheaper
check, but the required figure is not something a client can always reproduce
exactly: `offer.deposit` is set with ceiling division at `openOffer`, and a SELL
offer's `amount` with a floor division, so a client replicating that arithmetic
off-chain lands a wei out without much effort. Under equality that is a hard
revert and a retry the user cannot debug; under `>=` plus a refund, a client that
pads succeeds and gets the padding back.

The gas argument cuts the same way. `_payout` runs only inside `if (excess > 0)`,
so the exact-payment path pays a subtraction and a branch — under a hundred gas.
The ~9k for a value-bearing call is charged only to whoever overpaid, which is the
right party to charge.

**On the severity.** No attacker can force an overpayment; this needs user or
client error to fire. Graded strictly on attacker-reachability it is a medium. It
is kept at H because the loss is unrecoverable for the user and accrues to the
owner through `recover()` — the contract turns a mistake into revenue for a party
that is meant to be non-custodial.

## H3 — a counterparty that rejects ETH freezes both sides permanently

`quit` paid the owner and the counterparty with `require(res)` on each. A taker
contract whose `receive()` reverts makes `quit` revert for *both* parties:

- the EVM side can never exit before `t0` or after `t1`;
- the XMR side can never exit after `t1`;
- `claim` is gated on the counterparty's own address, so it is no escape either.

Both parties' ETH is locked forever, and any XMR already in escrow with it. The
attack costs an attacker only the deposit they themselves lose, and any offer on
the book can be targeted.

**Fix.** A failed transfer is recorded as a credit in `withdrawable[to]` and
collected later via `withdraw()`. `liability` only drops when ETH actually
leaves, so the balance/liability invariant holds either way.

## M4 — `listOffers(reverse: true)` returns the wrong window

```solidity
uint256 index = reverse ? count - i : i;
_offers[i] = offers[index + offset];
```

Reverse walks `count … 1`, never `0`. It skips the first entry of the window and
reads one past the end. **Fix:** `offset + count - 1 - i`.

## M5 — the SELL maker's private view key is never validated

The XMR side publishes its *private* view key in the clear. In `take`'s BUY
branch the contract derives the public key and registers that. In `openOffer`'s
SELL branch it registers the raw scalar instead, and never calls
`scalarMultBaseCompressed` on it.

Two consequences: the same Monero view key can be used in both paths without the
reuse check firing, and a SELL maker can publish a value that is not a valid
scalar at all, leaving the EVM taker unable to derive the shared view key and so
unable to verify the deposit.

**Fix.** Register `scalarMultBaseCompressed(viewingKey)` in the SELL branch too,
which validates the scalar as a side effect.

## M6 — an offer can be taken by its own maker

Nothing rejected `msg.sender == offer.owner`. Self-dealing burns keys, occupies a
book slot, and fakes volume. **Fix:** require them to differ.

## M7 — offers promising zero XMR

`xmrAmount` was unvalidated. **Fix:** require it to be non-zero.

## L8 — under-validated parameters

`_setParameters` checked the delays and the deposit ratio but never that
`MINIMUM_OFFER > 0` or that `MINIMUM_OFFER <= MAXIMUM_OFFER`. **Fix:** both.

## L9 — `offer_id` was not indexed

`OfferEvent` indexed `kind` and `state` — two low-cardinality enums — while the
one field worth filtering on was left in the data. A client could not fetch the
history of a single offer. **Fix:** index `offer_id` (three indexed fields is the
limit, and `kind`/`state` remain indexed because the id took the data slot's
place, not theirs).

## Key-commitment validation (defence in depth)

`scalarMultBaseCompressed` always yields a y-coordinate below the field prime, so
a commitment with `y >= q` can never be matched by any reveal. A party could
commit a non-canonical encoding of a key it genuinely controls, let the
counterparty escrow real XMR against the derived address, and then be unable to
reveal on-chain — the counterparty's only route to their deposit is to quit and
publish their own half, at which point the attacker holds both halves.

This is not exploitable through the current web client, which decodes committed
keys with noble-ed25519 and rejects `y >= p` before showing an escrow address.
The contract should not depend on that.

**Fix.** `Ed25519.requireCanonicalPoint` rejects `y >= q`, plus `y = 0` and
`y = 1` (a small-order point and the identity — neither is the image of a valid
scalar). Applied to every public key committed on-chain, and fuzz-tested to
confirm real keys always pass.

---

## Noted, not changed

**SELL offers can be griefed off the book.** For a SELL offer the taker is the
EVM side, and the EVM side may quit any time before `t0`. The `blockTaken` guard
only blocks take-and-quit inside the same block, so an attacker can take and quit
one block later, repeatedly, for the cost of gas. The offer ends up `REFUNDED`
and the maker must repost with fresh keys. BUY offers are not exposed, because
there the taker is the XMR side and cannot quit until after `t1`.

Closing this needs an economic penalty rather than a check, which is a design
decision rather than a bug fix — flagging it instead of picking one.

**A stalled EVM side can strand XMR.** If the EVM side simply never reveals, the
XMR side's only way to recover its deposit after `t1` is to quit, which publishes
its own key half. If XMR is already in escrow, the rational move is to leave the
deposit locked instead. The deposit is not slashed on any path, so nothing prices
this in.
