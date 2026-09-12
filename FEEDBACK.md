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

Every claim below was checked against the OpenAPI document at
`https://trade-api.gateway.uniswap.org/v1/api.json` rather than against the prose
docs, because in several cases the two do not say the same thing — which is itself
most of the feedback.

---

## 1. Swap output can be *directed*, but not *used* — and the endpoint that fixes it is invisible from the main flow

**This is the biggest one for us**, and it took reading the OpenAPI document to
state it correctly.

`/quote` does accept a `recipient`, so output need not go to the `swapper`. That is
not what we need. An escrow does not want ETH *sent* to it — it needs the ETH
passed as `msg.value` to a specific function call, `take(offerId, spendingKey,
viewingKey)`. Our contract's `receive()` reverts on a bare transfer precisely so
funds cannot arrive without the call that accounts for them. A `recipient` can
address output; it cannot invoke anything with it.

So the primary documented flow — `/quote → /check_approval → /swap` — makes funding
an obligation irreducibly **two transactions**: swap to ETH, wait for it to land,
then call `take`. The user is exposed in between: if the second transaction fails
or they walk away, they hold ETH they converted for a purpose they did not
complete. On a protocol with time-locked deadlines that gap is not cosmetic. Our
`SwapReview` step list says so explicitly rather than implying atomicity.

**The API does have an answer, and we nearly missed it.** `/swap_5792` returns
EIP-5792 batch calldata, and `/plan` builds multi-step flows whose steps include
batched calls. A wallet that supports 5792 could execute swap-then-escrow as one
atomic bundle. Neither endpoint appears in the getting-started path, the
integration guide, or anything that led us from `/quote` to `/swap`; we found them
by enumerating `paths` in the OpenAPI document after concluding composition was
impossible.

Two things would fix this, and the first is nearly free:

- **Point at `/swap_5792` from the `/swap` docs.** One sentence — "to batch this
  swap with other calls atomically, see `/swap_5792`" — would have saved us the
  wrong conclusion, and it is the difference between "the API cannot compose" and
  "the API composes, here".
- **State that 5792 atomicity is conditional.** `wallet_getCapabilities` reports
  atomic support per wallet, so an integrator cannot *rely* on the bundle being
  atomic and still needs the two-transaction path as a fallback. Saying so in the
  docs stops people shipping a flow that is atomic on their wallet and not on
  their users'.

## 2. Whether a route needs a Permit2 signature *at all* is knowable only after quoting

The request already controls the *form* a permit takes: `generatePermitAsTransaction`
chooses between calldata to broadcast and a message to sign, and its description is
genuinely good — it explains the 30-day validity of a message versus indefinite
allowance for calldata, and the gas consequence of each. `permitAmount` covers
`FULL` versus `EXACT`. Credit where it is due.

What is not controllable is whether a permit is needed *in the first place*.
`/quote` returns `permitData` when a signature is required and omits it otherwise,
and there is no way to ask beforehand.

This matters because the **shape of the flow changes**: one route is
approve → swap, another is approve → sign → swap. A review screen that tells the
user what they are about to do has to quote first, then rewrite its own step list.
Ours does exactly that — the signing step appears in the list only once a quote
has come back carrying `permitData`, so the screen cannot name its own steps until
after the network call it is describing.

Two smaller things surfaced while implementing the signing, both cheap to fix in
the docs:

`permitData.types` carries every struct in the payload — `PermitSingle` *and* its
`PermitDetails` dependency — with nothing marking which one is the message.
EIP-712 signing needs a `primaryType`, so a client has to derive it (the type
nothing else references) or hardcode `'PermitSingle'` and hope the payload never
becomes a `PermitBatch`. Returning `primaryType` alongside `domain`/`types`/
`values` would remove the guesswork; it is one field.

And because JSON has no integer type, `details.amount` arrives as a 49-digit
*string* — uint160 max. viem and ethers both want `bigint` for `uint*` in typed
data, so every client must walk the struct and coerce. Passing it through
`Number()` yields a rounded value that still signs successfully and grants a
different allowance than the one displayed. Worth an explicit warning in the
`permitData` description, since the failure is silent and the artifact is a
signature.

**What would fix it:** since the form is already a request parameter, make the
requirement one too — a `signatureSupport: 'none'` that returns a route not needing
a permit, the way `protocols` already constrains routing. Failing that, document
which token/chain/protocol combinations require Permit2, so a client can plan its
own UI without a round trip.

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

## 7. The `@uniswap/widgets` deprecation notice does not point anywhere

Correcting our own first impression here: the package **is** deprecated on npm —
*"Package no longer supported. Contact Support…"* — at v2.59.0, last published
about a year ago. We had assumed it was quietly abandoned with no notice, and that
was wrong.

The remaining problem is smaller and still real: the notice sends you to npm
support rather than to a replacement. For a package whose users are all trying to
do the same thing, "use the Trading API" would be a strictly more useful sentence
than "contact support", and it is the cheapest item on this list.

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
