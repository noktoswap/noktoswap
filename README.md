# xmrp2p

Atomic ETH ↔ XMR swaps. The contract escrows the ETH side and releases it only
against the reveal of a Monero private spend key, so taking the payout and
handing over the coins are the same action.

| | |
|---|---|
| `contracts/` | Foundry project — the market contract, ed25519 helpers, tests ([README](contracts/README.md), [AUDIT.md](contracts/AUDIT.md)) |
| `PLAN.md` | build plan for the ETHOnline 2026 sprint |

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

<!-- TODO: confirm the hackathon start date and move any commit that predates it
     into the section above. `abf6fbf` (Foundry import) and `abc4523` (audit
     fixes) need checking against the start time. -->

- **Contract review and fixes** — ten findings against the deployed v1.1
  contract, each with a regression test that fails upstream and passes here. See
  [`AUDIT.md`](contracts/AUDIT.md).
- **Observability events** — `Withdrawal`, `Recovered`, `PayoutCredited`. The
  upstream contract emitted only `OfferEvent`, leaving three balance-affecting
  paths invisible to an indexer.
- **Indexing pipeline** — in progress, see [`PLAN.md`](PLAN.md).
- **Frontend data and swap funding** — in progress.

Commit history is the authority on which is which: everything from `abc4523`
onward is event-period work.
