# xmrp2p subgraph

Indexes the offer book, the payout-credit lifecycle, and market parameter
history.

```shell
npm install
npm run abi        # regenerate abis/XMRP2P.json from the Foundry build
npm run codegen
npm run build
npm run deploy     # Subgraph Studio
```

`graph codegen` and `graph build` both pass. Nothing here has been run against a
live chain yet.

## Two decisions baked in

### No Monero key material is indexed

Every key in the `Offer` struct is already public on-chain, so this costs nobody
anything they could not already get. What it prevents is the *cheap* version of
the attack: a subgraph would turn scattered key reveals into a joined, bulk
queryable dataset, and linking Monero key material to EVM addresses across the
protocol's whole history would become a single GraphQL call.

So the subgraph serves what the book needs — browse, filter, track state — and
the app reads key material straight from the contract for the one offer it is
party to. Reveals surface as `evmKeysRevealed` / `xmrSpendKeyRevealed` booleans,
so a client can still tell *when* a key became available.

This is a posture, not a technical constraint. Exposing any of these is one line
per field in `schema.graphql` plus one in `hydrate()`.

### Which deployment to index

`subgraph.yaml` currently points at the upstream v1.1 deployment
(`0xad6871d4…`, mainnet). That contract has real offers but predates the
`Withdrawal`, `Recovered`, `PayoutCredited` and `ParametersUpdated` events — so
those four handlers never fire against it, and `Account` / `PayoutCredit` /
`AccountWithdrawal` / `MarketParameters` stay empty. The offer book itself
indexes correctly.

The alternative is deploying the fixed contract and indexing that: all handlers
live, but a book you have to populate yourself. "Live data from a Graph provider"
is a Studio/Graph Market requirement, not a mainnet one, so a testnet deployment
qualifies.

**Still open.** Pick before the demo — it changes what the video can show.

### `startBlock` is 0

Needs the creation block of whichever address is chosen. At 0 the initial sync
walks all of history for nothing.

## Why `hydrate()` makes an eth_call

`OfferEvent` carries three indexed topics and no data, so everything past
`(id, kind, state)` has to be read back with `offers(id)` — one archive call per
state transition. That is the cost this fallback path pays, and the reason the
Substreams pipeline exists (see `PLAN.md`). Substreams reads the same values
from calldata and storage deltas instead.

One deliberate asymmetry: `state` and `kind` come from the log topics, not from
the hydration call. A contract read returns end-of-block state, which is wrong
when an offer transitions twice in one block; the topic is what actually
happened at that log.

## Log-only by construction

`Account.withdrawable` never needs a contract read. Credits accrue only in
`_payout`'s failure branch and `withdraw()` always drains the full balance, so
`sum(PayoutCredit) - sum(AccountWithdrawal)` is exact. Same for
`MarketParameters`: `ParametersUpdated` fires from `_setParameters`, so
construction is covered and the full parameter history is reconstructible.
