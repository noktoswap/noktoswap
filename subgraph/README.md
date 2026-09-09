# xmrp2p subgraph

Indexes the offer book, the payout-credit lifecycle, and market parameter
history.

```shell
pnpm install
pnpm run abi       # regenerate abis/XMRP2P.json from the Foundry build
pnpm run codegen
pnpm run build
pnpm run deploy    # Subgraph Studio — use `run`, pnpm also has a builtin `deploy`
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

### Which deployment to index — settled: Sepolia

| | |
|---|---|
| Address | `0x67DB37c3be37B44c0506e5DF441437C83114bCd2` |
| Network | Sepolia (11155111) |
| Deployed at block | `11670176` |
| Tx | `0x833b6954c5cd96f01eac69ba57cffce2943566f5605fa4f95daf6282e7a3ff6d` |
| Owner | `0x205d2686da3Bf33f64C17f21462c51B5eaD462CF` |

The upstream mainnet v1.1 deployment (`0xad6871d4…`) has real offers but predates
`Withdrawal`, `Recovered`, `PayoutCredited` and `ParametersUpdated`, so four of
the five handlers would never fire and most of the schema would sit empty. The
Sepolia deployment is the fixed contract, where every event in the ABI is live.

"Live data from a Graph provider" is a Studio / Graph Market requirement, not a
mainnet one, so this qualifies for the bounty. The tradeoff is that the book
starts empty and has to be populated.

`ParametersUpdated` fires from the constructor in block `11670176`, so
`MarketParameters` is populated from the very first block synced — confirmed
on-chain, all six values decode correctly.

## Live

| | |
|---|---|
| Studio | https://thegraph.com/studio/subgraph/xmrp-2-p |
| Query | `https://api.studio.thegraph.com/query/5944/xmrp-2-p/version/latest` |
| Slug | `xmrp-2-p` |

```shell
curl -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $GRAPH_API_KEY" \
  -d '{"query":"{ offers(first:5){ id offerId kind state } }"}' \
  https://api.studio.thegraph.com/query/5944/xmrp-2-p/version/latest
```

Note that `MarketParameters` already ends in `s`, so graph-node exposes the
by-id lookup as `marketParameters(id:)` and the **list** as
`marketParameters_collection(first:)`. Every other entity pluralises normally.

## Redeploying

```shell
pnpm exec graph auth $GRAPH_DEPLOY_KEY   # Studio → xmrp-2-p → Deploy Key
pnpm run codegen && pnpm run build
pnpm exec graph deploy xmrp-2-p --version-label v0.0.2
```

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
