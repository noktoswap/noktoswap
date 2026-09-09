# xmrp2p — ETHOnline 2026 sprint plan

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
   the start — which xmrp2p did not.

Reading 1 is more likely, but $5,000 and the entire Graph entry depend on it.
**Ask ETHGlobal in Discord immediately.** If the answer is (2), the Graph entry
collapses and Day 2's Substreams work should be dropped in favour of finishing
the app.

---

## Day 1 (Wed 9th) — unblock and de-risk

- [ ] **Ask ETHGlobal about the composability track's continuity eligibility.**
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
- [ ] Confirm indexing target chain. Existing deployment, no new ones.
- [ ] **Freeze the subgraph schema.** Include the privacy decision: index a
      `revealed` boolean, not the Monero key values (see Open decisions).
- [ ] Subgraph deployed to Subgraph Studio, answering a real query with a real
      API key.

**Exit:** a live subgraph, a continuity boundary on paper, and an answer on
eligibility.

---

## Day 2 (Thu 10th) — the Graph entry

Composition requires **2+ Graph products**. Two paths, and the cheap one is the
baseline:

- [ ] **Baseline — Subgraph + Token API.** Two Graph products, and the second is
      one REST call. Cheap insurance that the entry qualifies at all.
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

- [ ] Offer book renders from the live subgraph.
- [ ] [Token API](https://thegraph.com/docs/en/token-api/quick-start/) for wallet
      balances — populates the swap token selector.
- [ ] Exact required amounts read **from the contract**, not the subgraph
      (`offer.deposit` for a BUY take, `offer.amount` for a SELL take). These gate
      a payment and must not come from an indexer that can lag.
- [ ] Swap-to-fund. **Constrain the token list** (USDC/USDT/DAI/WETH) — at this
      hour count there is no time for open-ended route discovery, and a fixed list
      means known routes.
- [ ] Exact-**output** swaps targeting the required figure. Safe only because
      `take` refunds excess (`AUDIT.md` H2) — do not let anyone "simplify" that to
      an equality check.
- [ ] `FEEDBACK.md`, written while the friction is fresh. Exact-output swaps into
      native ETH to fund a time-locked escrow is genuinely unusual integration
      friction and better material than most submissions will have.

**Exit:** a user holding no ETH can fund and take an offer.

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
| Compose 2+ Graph products, or build on standardized schemas | D2 — Subgraph + Token API baseline; Substreams as upgrade |
| Consume live data from a Graph provider (Studio or Graph Market) | D1 — real API key, fixtures disqualify |
| Not just querying one Subgraph without composition | D2 — explicit disqualifier |
| *(optional)* contribute reusable Substreams modules | D2, only if Substreams lands |
| Make the standards leverage clear — "what became easier" | D2 — README statement |
| Public repository | D4 |
| Demo video, 2–4 minutes | D4 |

**Uniswap — Stack Contribution (Continuity)**

| Requirement | Where |
|---|---|
| Build on or integrate any part of the Uniswap stack | D3 |
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
| Token list for swap funding | D3 | Constrained. No time for route discovery |

---

## Out of scope

- The Graph AI tracks — deliberate.
- A third partner prize — the slot is free but the hours aren't.
- Multi-chain deployment. Fragmenting a live offer book across chains with no
  takers is a real cost against a $5,000 upside.
- SELL-offer griefing and the stalled-EVM-side case (`AUDIT.md`, "Noted, not
  changed"). Both need economic design, not a patch.
