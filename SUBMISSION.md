# Noktoswap — ETHOnline 2026 submission

Paste-ready copy for the submission form. Live app:
**https://app.noktoswap.workers.dev** · Repo: **https://github.com/noktoswap/noktoswap**

---

## Short description (one line)

Atomic ETH↔XMR swaps with no bridge, no wrapped asset and no custodian — and a
client that can fund the escrow from any ERC-20 you already hold.

## What it is

Monero cannot be wrapped or bridged: no smart contracts, no light-client proof an
EVM chain could verify. So every "ETH to XMR" product is a custodian. Noktoswap is
an offer book where the two sides escrow against each other and a shared Monero
address neither can spend alone — the escrow's spend key is the sum of two private
halves, and whoever walks away reveals theirs, which is what makes the refund
automatic rather than arbitrated.

Contracts are live on **Ethereum mainnet**, **Base** and **Sepolia**, at one
address on the two mainnets via CREATE3:

| Chain | Address | Deployed at |
|---|---|---|
| Ethereum | `0x4862839b11a6013FCC2A5f5AD2bA438Cac742d8C` | 25962326 |
| Base | `0x4862839b11a6013FCC2A5f5AD2bA438Cac742d8C` | 51219297 |
| Sepolia | `0x67DB37c3be37B44c0506e5DF441437C83114bCd2` | 11670176 |

Verify the deployed bytecode against the `contracts-as-deployed` git tag, not
`main`: the contract was renamed after deployment, which changes the trailing
metadata hash while leaving the executable code identical.

---

## Track 1 — The Graph: Composable / Standardized

**The claim: this app indexes exactly one thing, and composes the rest.**

Three subgraphs, one per chain, because a manifest targets exactly one network —
so "one book" is a client-side merge, not a multi-chain subgraph:

| Chain | Subgraph |
|---|---|
| Ethereum | `noktoswap-mainnet` |
| Base | `noktoswap-base` |
| Sepolia | `xmrp-2-p` |

**What is indexed, and what deliberately is not.** Every Monero key in the `Offer`
struct is already public on-chain, so indexing them would be no *new* disclosure —
but it would turn scattered reveals into a joined, bulk-queryable dataset, making
"link Monero keys to EVM addresses across the whole protocol" one GraphQL call. So
reveals are indexed as **booleans**, and the client reads actual key values from the
contract, for the single offer it is party to. That is a privacy property that only
exists because of a decision about what *not* to index.

**Where composition did the work.** The token picker needs every ERC-20 an address
holds, per chain, with metadata. Indexing that would be a subgraph per chain
tracking every `Transfer` touching the user, and it would still be wrong for tokens
acquired before the start block. The **Graph Token API** already answers it, so
there is no balance indexing here at all — just a fetch. Its `network` enum covers
mainnets only, so `coversChain()` exists to let the UI say "only the listed tokens
were checked" rather than imply an empty wallet.

**The rule that shapes the whole client:** the subgraph serves browsing; the
contract serves money. An indexer lags by design and `take` does not, so the book,
the counts and the reputation figures come from GraphQL, while any figure that ends
up in a `msg.value` is re-read on-chain at the moment of the action.
`lib/contract.ts` is the only path to such a figure.

**Relevant code:** `subgraph/` · `web/src/lib/subgraph.ts` ·
`web/src/lib/tokenApi.ts` · `web/src/lib/contract.ts`

---

## Track 2 — Uniswap: Stack Contribution (Continuity)

**The claim: escrow funding is an exact-output problem, and that is the whole
integration.**

The contract checks an exact ETH amount. A user holding only USDC therefore needs
*exactly* that much ETH to land in their wallet — which makes this
**EXACT_OUTPUT**, and the consequence is the interesting part: slippage moves onto
the *input* token as a spend ceiling, never onto the amount the contract verifies.
Live on mainnet through the Trading API:

```
0.001 ETH out  <-  2.4784 USDC expected,  2.4923 max
```

That ceiling is what exact-output buys you. `check_approval` is called against the
**ceiling**, not the expected spend, or the swap can fail on slippage it was
explicitly allowed to take.

**Permit2 is implemented, not stubbed.** For a token-funded escrow it is the common
path rather than the exception — `approve` only appears when Permit2 itself holds no
allowance. Two conversions in `permitTypedData` do real work, and both fail
silently if you get them wrong:

- `details.amount` arrives as a 49-digit **string** (uint160 max). viem wants
  `bigint`, and `Number()` would round past 2^53 — producing a signature the wallet
  *displays* as one allowance and *grants* as another.
- `types` carries both `PermitSingle` and its `PermitDetails` dependency with
  nothing marking which is the message, so the primary type is derived as the one
  nothing else references.

Unit tests cannot prove a signature is the one Permit2 wants — a wrong primary
type, field order or rounded amount all still yield 65 valid-looking bytes. So
`permit.live.test.ts` signs a real quote with a throwaway key, posts it to `/swap`,
and asserts those bytes come back **embedded verbatim in the returned Universal
Router calldata**, which the service cannot do without recovering them to the
swapper it quoted.

**Honest limitation, stated in the UI:** the swap and the escrow **cannot** be one
transaction. The Trading API pays the swapper, and there is no hook that would let
one transaction do both — so funding an escrow is irreducibly a two-transaction
sequence, and the step list says so rather than implying atomicity.

**Developer feedback:** [`FEEDBACK.md`](./FEEDBACK.md) — fact-checked against the
OpenAPI document, and the two Permit2 papercuts above are filed there as concrete
doc fixes (return `primaryType`; warn that `amount` is a string wide enough to lose
precision in a float).

**Relevant code:** `web/src/lib/uniswap.ts` · `web/src/components/SwapReview.tsx` ·
`web/src/lib/permit.live.test.ts`

---

## Also built

- **Market-making bot** (`bot/`) — a CLI that quotes both sides and services
  positions. Dry-run by default; `--live` refuses to start without exposure caps.
  The interesting part is not the pricing but the deadline table, transcribed from
  the contract rather than approximated.
- **Realm separation** — testnet and mainnet books never merge. A Sepolia escrow
  yields a *stagenet* Monero address, and that pairing is the safety property: it
  is what stops real coins being sent against a test trade.
- **The rate ladder** — four sources in order of trustworthiness, and the line
  under the rule never invents a number. A median over fewer than three offers is
  refused, after a single test offer was once quoted as "the book's going rate".

## Verification

```
19  Foundry tests
132 web checks (111 domain + 21 DOM), offline
27  bot checks, offline
    plus live checks against Chainlink, the subgraphs and the Uniswap API
```

---

## Still to fill in

- [ ] Demo video link (2–4 min). Subject: **the indexing problem and how
      composition solved it** — not how Monero atomic swaps work.
- [ ] Uniswap Developer Feedback Form submitted, linking `FEEDBACK.md`
- [ ] Team / builder details on the ETHGlobal form
- [ ] Confirm The Graph composability track accepts Continuity entries (the track
      carries no pool label — see `PLAN.md`)
