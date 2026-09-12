# Noktoswap — ETHOnline 2026 sprint plan

**Submission deadline: Sunday 13 September 2026, 12:00 EDT.**
Written Wednesday 9 September — roughly three and a half days.

This is a triage plan, not a roadmap. Everything is ordered by what makes a
submission *eligible*; polish is explicitly last and explicitly cuttable.

---

## Where we are

**Done.** v1.1 contracts in a Foundry project, ten review findings fixed
(`AUDIT.md`), 19 tests green. Observability events added: `Withdrawal`,
`Recovered`, `PayoutCredited`.

**Exists upstream.** `v3xlabs/xmrp2p` has a web client. Pre-existing work under
the continuity rules — must be documented, see Day 1.

**Have.** Lo-Fi designs.

**Pending.** Indexing, frontend data, swap funding, branding, Hi-Fi, UI.

---

## Submission targets

Event rule: *"you can select up to 3 Partner Prizes to apply for. If a partner
has multiple tracks, you can be eligible for all of them while only counting as
1 Partner Prize."*

| Partner | Track | Pool | Slots | Prize slot |
|---|---|---|---|---|
| The Graph | Composable / Standardized | $5,000 | 3 | 1 of 3 |
| Uniswap | Stack Contribution (Continuity) | $2,000 | 2 | 2 of 3 |
| — | third slot unused | — | — | 3 of 3 |

The third slot is free and costs nothing to hold. Do **not** spend time chasing a
third sponsor at this hour count unless the integration already exists.

Not entered: the Graph AI tracks. The project isn't AI-shaped.

### ⚠️ Blocking question — resolve first thing Day 1

The event rules define Classic "From Scratch" as *"all work on your project must
begin after the hackathon officially starts"*, and Continuity as *"you may build
on an existing codebase according to that track's rules."*

The Graph's composability track carries **no pool label** — no "Start Fresh", no
"Continuity". Two readings:

1. It is open to everyone, and continuity teams may enter. (What the track text
   itself supports — it applies its requirements uniformly.)
2. Unlabelled means Classic, which would require the project to have begun after
   the start — which this project did not.

Reading 1 is more likely, but $5,000 and the entire Graph entry depend on it.
**Ask ETHGlobal in Discord immediately.** If the answer is (2), the Graph entry
collapses and Day 2's Substreams work should be dropped in favour of finishing
the app.

---

## Day 1 (Wed 9th) — unblock and de-risk

- [ ] **Ask ETHGlobal about the composability track's continuity eligibility.**
      ⬅ still open, and still worth $5,000.
      Everything downstream depends on it. Ask before writing code.
- [ ] `CONTINUITY.md` — what existed before (upstream client, v1.1 contracts,
      Lo-Fi designs) versus what's built during the event. Required by both
      tracks. Write it now; it takes twenty minutes and is worthless written
      Sunday morning.
- [x] **Contract work is done.** `ParametersUpdated` added, emitted from
      `_setParameters` so construction is covered too. It was not strictly
      required — Substreams decodes the `setParameters` call from calldata, and
      the fallback subgraph reads the already-computed `amount` / `deposit` /
      `t0` / `t1` out of the `offers` struct — but the contract is now
      log-complete, which keeps the indexer honest whichever path we take.
- [x] Indexing target chain: **Sepolia**, contract deployed at
      `0x67DB37c3be37B44c0506e5DF441437C83114bCd2`, block `11670176`. The
      upstream mainnet v1.1 deployment predates four of the five events.
- [x] **Subgraph schema frozen.** Privacy decision applied — reveals are
      `evmKeysRevealed` / `xmrSpendKeyRevealed` booleans, no Monero key values
      indexed. Rationale in `subgraph/README.md`.
- [x] **Subgraph live on Studio** at `xmrp-2-p`, synced with no indexing errors.
      Verified end to end: the constructor's `ParametersUpdated` round-trips to
      GraphQL with all six values intact.
      `https://api.studio.thegraph.com/query/5944/xmrp-2-p/version/latest`

**Exit:** ~~a live subgraph~~ ✅, ~~a continuity boundary on paper~~ ✅ (root
`README.md`), an answer on eligibility ⬅ **still the one open blocker.**

---

## Day 2 (Thu 10th) — the Graph entry

Composition requires **2+ Graph products**. Two paths, and the cheap one is the
baseline:

- [x] **Baseline — Subgraph + Token API.** Both live and wired. Stronger than
      planned: the subgraph half is now **three** deployments —
      `xmrp-2-p` (Sepolia), `noktoswap-mainnet`, `noktoswap-base` — each synced
      with no indexing errors, all reporting identical market parameters from the
      constructor's `ParametersUpdated`. A manifest targets exactly one network,
      so three chains means three subgraphs merged client-side; `subgraph/deploy.sh`
      builds all of them from one manifest via `networks.json`.
- [~] **Seed the book.** One offer live on Sepolia (`nextOfferId` is 2); mainnet
      and Base still empty. Note the knock-on: the widget needs 3+ open offers
      before it will quote a book rate rather than Chainlink, so a demo that wants
      to show "the book's going rate" needs three. Needs offers in both
      directions and at least one walked through to `CLAIMED`, which means
      generating canonical ed25519 points (the deployer script has commented-out
      scaffolding using `Ed25519.scalarMultBase`).
- [ ] **Upgrade — Substreams.** Substreams-powered subgraph, built downstream of
      [`pinax-network/substreams-evm`](https://github.com/pinax-network/substreams-evm)
      or [`streamingfast/substreams-chain-modules`](https://github.com/streamingfast/substreams-chain-modules).
      This is the *strong* version of the entry — `OfferEvent` carries three
      indexed topics and no data, so a naive subgraph needs an archive `eth_call`
      per state transition, and Substreams reads it from calldata instead.

      It is also Rust with a real learning curve. **Timebox it to Day 2.** If it
      isn't producing entities by end of day, ship the baseline and move on.
- [ ] README leverage statement — a **qualification requirement**, not a nicety.
      "Show what became easier because a shared schema or composed product was
      used." Two true answers: no `eth_call` per state transition (if Substreams
      lands), and no token-balance indexing at all because a standardized product
      already serves it.

**Exit:** the Graph entry is eligible on its own, whichever path landed.

---

## Day 3 (Fri 11th) — the app and the Uniswap entry

App scaffolded in `web/` — SolidJS + wagmi + solid-wagmi, built from the lo-fi
designs. 38 checks green (31 domain, 7 render), typecheck and build clean.
See [`web/README.md`](web/README.md).

- [x] Offer book renders from the live subgraph. All five query shapes verified
      against the live endpoint. The book itself is still empty — see seeding.
- [x] Token API for wallet balances — populates the swap token selector.
      **Two corrections to the plan:** `token-api.thegraph.com` no longer
      resolves (the service moved to `api.pinax.network`), and its network enum
      is **mainnets only — no Sepolia**. So balances are genuinely unavailable on
      the home chain, and the UI says so rather than rendering an empty list.
- [x] Exact required amounts read **from the contract**, not the subgraph
      (`offer.deposit` for a BUY take, `offer.amount` for a SELL take).
      `lib/contract.ts` is the only path to a figure that reaches a `msg.value`.
- [x] Swap-to-fund, token list constrained per chain. The wider routable set sits
      behind `/swappable_tokens` for search, so the constraint shapes the happy
      path without being the only way in.
- [x] Exact-**output** swaps targeting the required figure. Slippage lands on the
      *input* token, which is what makes this safe; the excess refund is the other
      half. Commented at the call site so nobody "simplifies" it.
- [x] **Escrow keypairs.** Not in the original plan and turned out to be
      load-bearing: `take` and `claim` both need ed25519 material in the exact
      encoding the contract checks. `pointToUint256` is pinned against four
      vectors produced by running `Ed25519.scalarMultBaseCompressed` under forge.
- [x] **Rate ladder with a Chainlink fallback.** Not in the plan; forced by the
      empty book. The book's own figures still come first (exact offer → best
      near → median), with Chainlink XMR/USD ÷ ETH/USD as the fourth rung so the
      landing screen shows a real number instead of a dash. Note for the demo:
      **the mainnet XMR/USD feed is decommissioned** — it reverts, and
      `xmr-usd.data.eth` still points at it. The live pair is on Optimism.
- [x] `FEEDBACK.md`. Written, then **fact-checked against the OpenAPI document**
      rather than the prose docs, which corrected three claims that would not have
      survived a Uniswap engineer reading them: `/quote` *does* take a `recipient`;
      `/swap_5792` *does* offer an atomicity path; and the widgets package *is*
      deprecated on npm. Each item is sharper for it — the composition gap is now
      "the answer exists and is invisible from the documented flow" rather than
      "the API cannot do this".
- [ ] ~~`FEEDBACK.md`~~ superseded above. The material is ready and sharper than expected — the swap
      and the escrow **cannot** be one transaction (the Trading API pays the
      swapper, and there is no hook), so funding an escrow is irreducibly a
      two-transaction sequence. Plus Permit2 being required on some routes and
      not others, with no way to ask in advance.

**Also landed, unplanned:** multi-chain throughout. Offers are keyed by
`(chainId, offerId)` because ids restart at 1 per deployment; testnet and mainnet
books never merge, since a Sepolia offer carries a stagenet Monero escrow; and the
money paths were diffed against upstream's client, which caught a real bug — an
OPEN offer's `counterparty` is a *restriction*, not a party, so reserved offers
were showing a Cancel button to the taker and a Take button to everyone else.

**Exit:** ⚠️ a user holding no ETH can quote, sign and fund; `take` still needs a
seeded book. Permit2 signing landed after this was written — `permitTypedData`
plus `signTypedData`, verified end to end against the live `/swap` by
`permit.live.test.ts`, so paying in a token now works on routes that ask for a
signature as well as those that only need an approval.

### Carried forward — the one gap worth stating plainly

**Monero address derivation is not implemented**, deliberately. Everything the app
submits is validated by the contract, so a mistake surfaces as a revert; an
address is validated by nothing, and one wrong byte loses the coins. The key
panels hand the verified halves to a real wallet instead. This is the highest
value next piece of work and it wants test vectors before it wants code.

---

## Day 4 (Sat 12th) — submit, then polish

Submission artifacts first. Everything below the line is cuttable.

- [ ] Public repo, open source.
- [ ] README identifying relevant code per track. Uniswap's wording assumes
      contracts; ours is frontend + API — say so and point at the swap module.
- [ ] **Demo video, 2–4 minutes.** Subject is the indexing problem and how
      composition solved it — not how Monero atomic swaps work.
- [ ] Uniswap Developer Feedback Form, linking `FEEDBACK.md`.
- [ ] `CONTINUITY.md` final pass.
- [ ] **Submit.** Do not wait for Sunday morning; the deadline is 12:00 EDT and
      the platform will be under load.

— cut line —

- [ ] Branding and logotype.
- [ ] Hi-Fi from Lo-Fi.
- [ ] Deadline-state design (`TAKEN` / `READY` / approaching `t0` / `t1`) — the
      highest-value design work, since those states are where users lose money.
      If any Hi-Fi happens, make it this.

**On the cuts:** branding and Hi-Fi are not bounty requirements for either track.
Neither judging criteria mentions visual design. If a designer is working in
parallel and unblocked, run it — otherwise these are the first things to go, and
losing them costs nothing at the prize table.

---

## Eligibility checklist

Every published requirement mapped to where it's satisfied. A row with no day
means not eligible.

**The Graph — Composable / Standardized**

| Requirement | Where |
|---|---|
| Compose 2+ Graph products, or build on standardized schemas | D2/D3 — Subgraph + Token API, **both now wired in the client**; Substreams as upgrade |
| Consume live data from a Graph provider (Studio or Graph Market) | D1 — real API key, fixtures disqualify. D3 — client queries it live, no offline fallback |
| Not just querying one Subgraph without composition | D2 — explicit disqualifier |
| *(optional)* contribute reusable Substreams modules | D2, only if Substreams lands |
| Make the standards leverage clear — "what became easier" | D2 — README statement |
| Public repository | D4 |
| Demo video, 2–4 minutes | D4 |

**Uniswap — Stack Contribution (Continuity)**

| Requirement | Where |
|---|---|
| Build on or integrate any part of the Uniswap stack | D3 — Trading API: `/quote` (EXACT_OUTPUT), `/check_approval`, `/swap`, `/swappable_tokens`. Code in `web/src/lib/uniswap.ts` |
| Public GitHub repository, open-source | D4 |
| `FEEDBACK.md` in the repo | D3 written, D4 final |
| Uniswap Developer Feedback Form, linking `FEEDBACK.md` | D4 |
| README identifying the relevant code | D4 |
| Submit to the **Continuity** pool, not the open one | D4 |

**Both**

| Requirement | Where |
|---|---|
| Document pre-existing work; only event-period work is judged | D1 (`CONTINUITY.md`), D4 final pass |

---

## Open decisions

| Decision | Blocks | Recommendation |
|---|---|---|
| Composability track open to continuity teams? | Everything Graph | **Ask Day 1.** Unresolved, worth $5,000 |
| Revealed Monero keys in the public schema | D1 schema freeze | Index a `revealed` boolean, not the values. `CLAIMED`/`REFUNDED` publish key halves; a subgraph makes XMR↔EVM linkage a single query |
| Substreams or baseline composition | D2 | Timebox Substreams to Day 2, ship baseline if it slips |
| Token list for swap funding | D3 | ✅ Constrained per chain, with `/swappable_tokens` behind search |

---

## Out of scope

- The Graph AI tracks — deliberate.
- A third partner prize — the slot is free but the hours aren't.
- ~~Multi-chain deployment.~~ Partly done, and the split is deliberate. The
  **contracts** are on mainnet, Base and Base Sepolia at one CREATE3 address
  (`0x4862839b…`, identical runtime codehash on all three). The **book** is not:
  indexing and the client stay on Sepolia, because fragmenting a book with no
  takers across chains is the actual cost, and repointing the subgraph this close
  to the deadline risks the $5,000 entry for no gain.

  Two things carried forward. The CREATE3 deployer key has been pasted into a
  terminal session, and a permissioned salt means whoever holds it can put
  arbitrary code at `0x4862839b…` on any chain **not yet deployed to** — mainnet
  and Base are locked, Arbitrum and Optimism are not. Rotate the deployer before
  the protocol holds real value. The same key is also the owner of all three
  deployments, holding `setParameters` and `recover`; `transferOwnership` is
  available, so that half is fixable without redeploying.
- SELL-offer griefing and the stalled-EVM-side case (`AUDIT.md`, "Noted, not
  changed"). Both need economic design, not a patch.
