# Noktoswap

Atomic ETH ↔ XMR swaps. The contract escrows the ETH side and releases it only
against the reveal of a Monero private spend key, so taking the payout and
handing over the coins are the same action.

| | |
|---|---|
| `contracts/` | Foundry project — the market contract, ed25519 helpers, tests ([README](contracts/README.md), [AUDIT.md](contracts/AUDIT.md)) |
| `subgraph/` | offer book indexer ([README](subgraph/README.md)) |
| `web/` | SolidJS client — offer book, order lifecycle, Uniswap swap funding ([README](web/README.md)) |
| `PLAN.md` | build plan for the ETHOnline 2026 sprint |

## Live

| | |
|---|---|
| Contract | **`0x4862839b11a6013FCC2A5f5AD2bA438Cac742d8C`** on [mainnet](https://etherscan.io/address/0x4862839b11a6013FCC2A5f5AD2bA438Cac742d8C), [Base](https://basescan.org/address/0x4862839b11a6013FCC2A5f5AD2bA438Cac742d8C) and [Base Sepolia](https://sepolia.basescan.org/address/0x4862839b11a6013FCC2A5f5AD2bA438Cac742d8C) — one address, via CREATE3 |
| Contract (Sepolia) | [`0x67DB37c3…`](https://sepolia.etherscan.io/address/0x67DB37c3be37B44c0506e5DF441437C83114bCd2) — block `11670176`, predates CREATE3, **what the subgraph indexes** |
| Subgraph | [`xmrp-2-p`](https://thegraph.com/studio/subgraph/xmrp-2-p) on Subgraph Studio |
| Query | `https://api.studio.thegraph.com/query/5944/xmrp-2-p/version/latest` |

All three CREATE3 deployments report runtime codehash `0x87856a11…` — the same
address *and* the same code. See [`contracts/README.md`](contracts/README.md) for
the salt layout and why the shared address needs that second check to mean
anything.

---

## Prior work

This project builds on [`v3xlabs/xmrp2p`](https://github.com/v3xlabs/xmrp2p),
which predates this event and is **not** part of the hackathon submission. That
repository contains:

- the v1.1 contracts, deployed to mainnet at
  `0xad6871d44804288ba4393464c63544d6691d76ba` (reviewed here at `4f74bd4`)
- the existing web client, which decodes committed ed25519 keys with
  noble-ed25519
- `lib/` — a Monero key library (**LGPL-3.0**): escrow-wallet computation,
  address encoding, block-wise base58, BIP-44 key derivation and wallet URIs

Everything in the upstream repository should be treated as pre-existing when
judging this submission.

## Built during the event

This repository was created during the event. Its entire commit history is
event-period work; the pre-existing material is what it imports from upstream.

- **Contract review and fixes** — ten findings against the deployed v1.1
  contract, each with a regression test that fails upstream and passes here. See
  [`AUDIT.md`](contracts/AUDIT.md).
- **Observability events** — `Withdrawal`, `Recovered`, `PayoutCredited`. The
  upstream contract emitted only `OfferEvent`, leaving three balance-affecting
  paths invisible to an indexer.
- **Offer book subgraph** — live on Subgraph Studio, indexing Sepolia. Schema,
  manifest and mappings in [`subgraph/`](subgraph/README.md). Indexes the book
  plus two things that need no contract reads at all: the payout-credit
  lifecycle, where `withdrawable` is exactly
  `sum(PayoutCredit) - sum(AccountWithdrawal)`, and full market parameter
  history.
- **One address on every chain** — deployed through CreateX's CREATE3 with a
  permissioned, chain-independent salt, so mainnet, Base and Base Sepolia share
  `0x4862839b…` and the same runtime codehash. Script and salt reasoning in
  [`contracts/README.md`](contracts/README.md).
- **Substreams pipeline** — planned, see [`PLAN.md`](PLAN.md).
- **Web client** — SolidJS + wagmi + solid-wagmi, built from the lo-fi designs.
  Composes both Graph products: the subgraph for the book, the Token API for
  wallet balances. Details and the three known gaps in
  [`web/README.md`](web/README.md).
- **Uniswap swap funding** — exact-**output** quotes through the Uniswap Trading
  API, so a taker holding no ETH can still meet the escrow's precise ETH figure.
  Safe only because `take` refunds the excess; see `AUDIT.md` H2.

### One deliberate reuse, and its licence

`web/src/lib/monero.ts` is a **port of upstream's LGPL-3.0 `lib/src/`** — escrow
address derivation, Monero's byte order and base58, BIP-44 key derivation. It is
pre-existing work, it is marked LGPL-3.0 in its own header, and it is the only
file in this repository under that licence; everything else is MIT.

It was ported rather than depended on because upstream ships it as a private
workspace package — the `xmrp2p` name on npm is an unrelated empty placeholder.
Reusing it was the right call on the merits: an escrow address is validated by
nothing on-chain, so a fresh implementation written from the spec would have been
a worse bet than a tested one, and it fixed a real bug in this client — keys were
being displayed in the contract's big-endian order rather than the little-endian
order a Monero wallet reads.

Commit history is the authority on which is which: every commit in this
repository is event-period work, starting with the import of the upstream
contracts at `abf6fbf`.
