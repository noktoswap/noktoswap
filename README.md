# Noktoswap

Atomic ETH ↔ XMR swaps. The contract escrows the ETH side and releases it only
against the reveal of a Monero private spend key, so taking the payout and
handing over the coins are the same action.

| | |
|---|---|
| `contracts/` | Foundry project — the market contract, ed25519 helpers, tests ([README](contracts/README.md), [AUDIT.md](contracts/AUDIT.md)) |
| `subgraph/` | offer book indexer ([README](subgraph/README.md)) |
| `PLAN.md` | build plan for the ETHOnline 2026 sprint |

## Live

| | |
|---|---|
| Contract (Sepolia) | [`0x67DB37c3…`](https://sepolia.etherscan.io/address/0x67DB37c3be37B44c0506e5DF441437C83114bCd2) — block `11670176` |
| Subgraph | [`xmrp-2-p`](https://thegraph.com/studio/subgraph/xmrp-2-p) on Subgraph Studio |
| Query | `https://api.studio.thegraph.com/query/5944/xmrp-2-p/version/latest` |

---

## Prior work

This project builds on [`v3xlabs/xmrp2p`](https://github.com/v3xlabs/xmrp2p),
which predates this event and is **not** part of the hackathon submission. That
repository contains:

- the v1.1 contracts, deployed to mainnet at
  `0xad6871d44804288ba4393464c63544d6691d76ba` (reviewed here at `4f74bd4`)
- the existing web client, which decodes committed ed25519 keys with
  noble-ed25519

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
- **Substreams pipeline** — planned, see [`PLAN.md`](PLAN.md).
- **Frontend data and swap funding** — planned.

Commit history is the authority on which is which: every commit in this
repository is event-period work, starting with the import of the upstream
contracts at `abf6fbf`.
