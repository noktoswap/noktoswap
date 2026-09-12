# Uniswap developer feedback

Written while integrating the **Trading API** into [Noktoswap](README.md), an
atomic ETH ↔ XMR swap protocol, during ETHOnline 2026.

Our integration is unusual in a way that turned out to be useful: we are not
building a swap UI. We use Uniswap to *fund an obligation*. The contract escrows
native ETH and nothing else, and `take` reverts unless `msg.value >= required`,
so a taker holding USDC has to arrive at a specific ETH figure. That makes the
ETH leg fixed and the token leg variable — `EXACT_OUTPUT` — and it exercises
parts of the API that a "swap A for B" screen never touches.

Relevant code: [`web/src/lib/uniswap.ts`](web/src/lib/uniswap.ts) (quotes,
approvals, swap calldata), [`web/src/components/SwapReview.tsx`](web/src/components/SwapReview.tsx)
(the step list), [`web/src/state/swap.ts`](web/src/state/swap.ts).
Endpoints used: `/quote`, `/check_approval`, `/swap`, `/swappable_tokens`.

---

## 1. There is no way to send swap proceeds anywhere but the swapper

**This is the biggest one.** `/swap` returns calldata that pays the `swapper`
address. There is no `recipient` parameter on a classic swap, and no hook that
would let the output land somewhere else.

So funding an escrow is irreducibly **two transactions**: swap to ETH, wait for
it to land in the wallet, then call `take` or `openOffer`. We cannot bundle them,
and the user is exposed in between — if the second transaction fails or they walk
away, they are holding ETH they converted for a purpose they did not complete. On
a protocol with time-locked deadlines that gap is not cosmetic.

Our `SwapReview` step list says so explicitly rather than implying atomicity,
because implying it would be a lie the user pays for.

**What would fix it:** a `recipient` field on classic quotes and swaps. Even
restricted to EOAs it would not help us, so specifically: allow a contract
recipient, or document a supported pattern for composing the Universal Router
call with a follow-on contract call in one transaction. The SDKs can build
Universal Router calldata, but the Trading API — which is the path the docs push
you toward — cannot express it, and the two are not documented as
interchangeable.

## 2. Whether a route needs a Permit2 signature is discoverable only after quoting

`/quote` returns `permitData` when a signature is required, and omits it when a
plain router approval suffices. There is no way to ask in advance.

This is awkward because the *shape of the flow changes*: one route is
approve → swap, another is approve → sign → swap. A UI that wants to show the
user what they are about to do has to quote first, then rewrite its own step
list. Ours currently detects `permitData` and refuses rather than sending a
transaction that would fail at simulation — a known gap, but the honest stop.

**What would fix it:** a deterministic field on `/quote` — or better, a request
parameter like `signatureSupport: 'none'` that makes the API return a route not
requiring one, the way `protocols` already constrains routing. Failing that,
documenting which token/chain/protocol combinations require Permit2 would let a
client plan without a round trip.

## 3. `x-universal-router-version` must stay consistent across three calls, and nothing says so

The router version header has to match across `quote → check_approval → swap`.
Mismatch it and you get failures that do not point at the cause. We set it once
in a server-side proxy for exactly this reason, but we found the requirement by
hitting it, not by reading it.

**What would fix it:** state it in the `/quote` docs, and ideally have `/swap`
reject a `requestId` whose version does not match rather than producing calldata
that fails later.

## 4. Exact-output slippage direction deserves to be stated loudly

On `EXACT_OUTPUT`, slippage lands on the **input** token — the output is exact.
That is correct and it is precisely the property that makes our integration safe:
the ETH reaching the escrow is not the slippage-bearing side.

But we had to reason it out from `quote.input.maximumAmount` rather than read it.
For anyone funding a fixed obligation — escrow, debt repayment, a bill — this is
*the* load-bearing fact about the endpoint.

**What would fix it:** one sentence in the docs. "On EXACT_OUTPUT, slippage
applies to the input amount; the output is guaranteed." It costs nothing and it
is the difference between trusting the endpoint and reverse-engineering it.

A related note in our favour: because slippage cannot push the ETH below target,
and our contract refunds anything above `required`, an overshooting quote costs
the user nothing. That combination is what makes exact-output viable here at all.

## 5. The Trading API is not a wallet API, and people will keep expecting it to be

We needed "which tokens does this address hold". The Trading API has no balances
endpoint — every `balance` in the spec is either an input you supply
(`nativeTokenBalance`, for wrap maths) or an error code, and `/tokens` returns
metadata and TVL rankings without accepting an address at all.

That is a reasonable scope decision. It is just not a *stated* one, and we spent
time confirming it. We ended up reading balances with Multicall3 directly.

**What would fix it:** a line in the overview saying the Trading API is for
routing and execution and does not serve wallet state, with a pointer to whatever
Uniswap considers the right tool.

## 6. `/swappable_tokens` is the only good testnet token discovery and it is buried

On Sepolia, most token-list sources have nothing useful. `/swappable_tokens`
does, and it is the thing that made a testnet flow possible for us. It is
currently presented as a minor endpoint; for anyone developing against a testnet
it is the most useful one in the set.

## 7. `@uniswap/widgets` is archived but still the first thing you find

It is at v2.59.0, roughly three years stale, predates v4 entirely, and has
ESM/CJS resolution problems with current bundlers. It is still what search and
npm surface first, and there is no deprecation notice pointing anywhere.

We lost time on it before concluding it was abandoned and moving to the Trading
API — which was the right destination and should have been the first signpost.

**What would fix it:** a deprecation notice on the npm package and the repo
README pointing at the Trading API. This is the cheapest item on this list and
probably the one that saves the most collective developer hours.

---

## What worked well

- **`/check_approval` returning a ready-to-send transaction** rather than a
  boolean. Being handed the calldata instead of assembling it is the right
  design, and the `cancel` field for tokens needing an approval reset is a
  thoughtful detail we did not have to discover the hard way.
- **`protocols` as an explicit array.** We exclude UniswapX deliberately — it
  fills off-chain and asynchronously, and our escrow needs ETH in the wallet
  before the *next* transaction, not eventually. Being able to state that in the
  request rather than filter responses is exactly right.
- **`autoSlippage: 'DEFAULT'` as a real default.** Sensible behaviour without a
  decision, and an override when you want one.
- **Quote responses carry `routeString` and `priceImpact`**, so a review screen
  can show a user what is actually happening without a second call.
