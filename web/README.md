# Noktoswap web client

SolidJS + wagmi front end for the ETH ↔ XMR offer book. Reads the book from the
live subgraphs, reads every figure that gates a payment from the contract, and
funds escrows through the Uniswap Trading API.

```shell
pnpm install
cp .env.example .env      # then fill in the three keys
pnpm dev                  # http://localhost:5173
pnpm test                 # 129 checks, no network
pnpm test:live            # checks the feeds and RPCs still answer
pnpm build                # typecheck + bundle
```

---

## What talks to what

| | |
|---|---|
| **Offer book** | Subgraph on Subgraph Studio — browse, filter, track state |
| **Amounts that gate a payment** | The contract, via `readOffer` — never the indexer |
| **Monero key material** | The contract. Not in the subgraph, on purpose |
| **Wallet balances** | Multicall3 for figures, Graph Token API for discovery |
| **Escrow funding** | Uniswap Trading API, exact-**output** |

Three rules, each of which shows up repeatedly in the code:

**The subgraph serves browsing; the contract serves money.** An indexer lags by
design. `take` does not. So the book, the counts and the "31 done" reputation
figures come from GraphQL, and `offer.amount` / `offer.deposit` are re-read
on-chain at the moment of the action. `lib/contract.ts` is the only path to a
figure that ends up in a `msg.value`.

**Key material never enters the index.** Every key in the `Offer` struct is
already public on-chain, but a subgraph turns scattered reveals into a joined,
bulk-queryable dataset — linking Monero keys to EVM addresses across the whole
protocol would become one GraphQL call. So reveals are indexed as booleans and
the app reads actual key values from the contract, for the single offer it is
party to. Rationale in [`../subgraph/README.md`](../subgraph/README.md).

**Nothing is faked to fill a layout.** Where the wireframe shows a figure this
app has no honest source for, it says so instead. Three cases, all commented at
the call site: fiat amounts next to token balances (the Token API returns no
prices), open-offer counts on chains with no deployment, and native balances on
Sepolia (see below).

## The rate ladder

"You receive" is a readout, not a quote — an offer is indivisible, so the figure
belongs to a *specific offer* rather than to a curve. Four sources, in order of
how much they are worth trusting, and the grey line under the rule always names
which one answered:

### Four verdicts, not three

| Verdict | When | What the screens show |
|---|---|---|
| `any` | no amount typed | the whole book on that side, rate order, no deltas |
| `exact` | an offer is precisely your size | its real numbers, and a take button |
| `near` | none is, but some are within the band | the band, each row labelled by how much it differs |
| `none` | nothing within the band | the invitation to post |

`any` was missing, and it fell through the `near` branch — so with no amount typed
the widget offered "See **0** near offers" while the results page read
`0 ETH → —` beside "0 of 1 near this size" and told the reader to go back and type
something. An unfiltered book is not a failed search; it is the whole book, which
is a perfectly good thing to show. Deltas are `null` rather than `0` there, because
a row cannot be "0.02 more" than nothing.

### One definition of the readout

`receiveAmountFor` in `lib/offers.ts`. It existed only in the widget, so selling
XMR estimated an ETH figure there and showed a dash on the results page for the
same trade — the second time duplicated display logic drifted between two screens
(the rate ladder was the first). Both now read the one function: a matched offer's
own figure where there is one, otherwise the typed amount converted at the quoted
rate, in whichever direction is needed.

| | Source | Readout |
|---|---|---|
| 1 | The offer that is exactly your size | its real numbers, not muted |
| 2 | Best offer within ±10% | an estimate at that rate, muted |
| 3 | Median across every open offer | an estimate, muted |
| 4 | Chainlink XMR/USD ÷ ETH/USD | an estimate, muted, feed named |

Rungs 1–3 are the book's own figures, and the design argued hard for stopping
there: what a maker competes with is the people already offering, not a spot
price. Rung 4 exists for the state the design treated as rare and which is where
the Sepolia deployment actually sits — an empty book, where a dash tells a user
nothing and leaves whoever posts the first offer with no number to price against.

**The ladder lives in `state/app.tsx`, not in a screen.** It was briefly only in
the widget, so the create form recomputed a bare book median and showed
`Market ~—` on an empty book while the widget two clicks away showed a figure.
One definition, read by both; the create form's market line also says when the
number came from Chainlink, and clicking it adopts that rate.

**Chainlink's mainnet XMR/USD proxy is dead.** `0xFA66458C…` — still what
`xmr-usd.data.eth` resolves to — reverts on every call, consistent with XMR being
delisted from most venues. The Optimism pair is live, on a 1200s heartbeat, and is
what `lib/oracle.ts` reads. Those reads go to Optimism regardless of which chain
the wallet is on, which is fine because nothing there touches a transaction.
`pnpm test:live` checks the feeds are still publishing.

## Balances: two sources, because they answer different questions

Neither API on its own covers this app.

**The Graph Token API does discovery** — *which* tokens does this address hold, out
of all tokens that exist. Only an indexer can answer that, and that is the whole
leverage claim: no balance indexing here, a standardized product already serves
it. But its `network` enum is mainnets only, so on Sepolia it returns nothing.

**Uniswap does not fill that hole.** The Trading API has no balances endpoint —
every "balance" in its spec is either an input you supply (`nativeTokenBalance`,
for wrap maths) or an error code, and `/tokens` returns metadata and TVL rankings
without taking an address at all. What it *does* give, which the Token API cannot,
is the routable token list on Sepolia, and `/swappable_tokens` is used for exactly
that.

**So the figures come from the chain.** Multicall3 sits at the same address on all
five configured chains, Sepolia included, and the token list is deliberately
constrained — so "what do you hold, of these" is one RPC round trip with no key,
no CORS, and no third party to be down. `lib/balances.ts`.

| | Answers | Chains | Freshness |
|---|---|---|---|
| Token API | which tokens at all | mainnets | indexed, lags |
| Multicall3 | how much, exactly | all five | head |

Both run in the picker, across every selected network, and the results merge with
the on-chain figure winning on overlap — it is a direct read at head, so it cannot
be stale. The trade-off is
stated where it bites: on a chain the Token API does not cover, the picker says
only the listed tokens were checked, rather than implying the wallet holds nothing
else. `pnpm test:live` reads the deployer's real Sepolia balances as a check.

## Wallets

`@wagmi/solid` — the official Solid package, not the community `solid-wagmi` this
started on. Worth the swap: it tracks the same `@wagmi/core` already in use, ships
the connector set a real dialog needs, and fixes two papercuts (`useChainId`
returned a whole Chain rather than an id; the connector list hung off
`useDisconnect`).

The connect dialog lists whatever `useConnectors` reports, which is the point of
using it: EIP-6963 means the browser *announces* its wallets, so Rabby or Frame
show up by name without this codebase knowing they exist. Coinbase and Safe are
explicit config entries; both work with no configuration, so nothing in the list
can be present but unusable.

WalletConnect is deliberately **not** there. It needs a project id this deployment
will not have, and an option that can only ever disappoint is worse than an absent
one. Not for bundle reasons — `@wagmi/connectors` lazy-loads the wallet SDKs, so
dropping it saved about 0.3 kB and nothing more.

Two things the dialog is careful about: a dismissed wallet prompt reads as
dismissed rather than as an error, and it never asks for a seed phrase or private
key — the only thing it collects is a click.

## Components: Kobalte, not hand-rolled

Interactive primitives come from [Kobalte](https://kobalte.dev) — the same
headless layer `shadcn-solid` wraps. shadcn/ui itself is React-only, and its Solid
port brings Tailwind and its own token system, which would replace the wireframe
design system this app is built to. Kobalte is unstyled, so `.dialog`, `.cbox` and
the rest still come from `styles/lofi.css`.

**Kobalte does not do layout**, and that distinction cost a bug: a tall order
dialog was unscrollable, which reads as cropped content. Two causes, both mine and
both CSS. The positioner carried `pointer-events: none` — on the theory that the
overlay click had to pass through it, which was wrong twice over, since Kobalte
dismisses on interact-outside-of-Content and an element that ignores pointer
events ignores the wheel too. And the dialog had no height ceiling.

The shape that fixes it is three parts: a positioner that scrolls, a dialog capped
to the viewport, and a `.dialog-body` that takes the overflow so the title and
close button stay pinned. Two details that are easy to get wrong — `min-height: 0`
on the body, because a flex child defaults to `min-height: auto` and refuses to
shrink below its content; and `margin: auto` on the dialog rather than
`align-items: center`, because centring a flex item clips the overflowing start
edge and makes the top unreachable.

A `sticky` slot sits between head and body for controls that must outlive
scrolling. The token picker's search field is the case that matters: scrolling
away the box that filters the list below it is the one thing it must not do.

It earns its place on two further defects, not on principle:

**The dialog** was closing on a scrim click via `event.target === event.currentTarget`
inside a `Portal`. Solid's event rules make that a trap — handlers are delegated
from `document`, `stopPropagation` does not behave as it reads, and portals
propagate through the *component* tree rather than the DOM tree. Kobalte's Dialog
brings the focus trap, focus restore, Escape, scroll lock and aria wiring that the
hand-rolled version approximated or skipped.

**The checkboxes** were buttons wearing a square: no space-to-toggle, no real
`input` for assistive tech, and intent inferred from where a pointer landed.

One labelling subtlety worth keeping: Kobalte points `aria-labelledby` at
`Checkbox.Label`, so anything inside it becomes part of the control's name. The
balance and deployment note sit *outside* the label — otherwise every box was
named "Base 0.42 ETH 23 open".

## Settings, and modals that stack

Three settings, each of which was a hardcoded constant first. That is the bar for
being in the panel at all — a gear opening a list of inert controls is worse than
no gear:

| | Was | Affects |
|---|---|---|
| Max slippage | `autoSlippage: DEFAULT` | how much of your token a swap may spend |
| Swap deadline | unset | how long a signed swap stays valid |
| Close to my size | `NEAR_BAND = 0.1` | which offers count as near yours |

Slippage carries a 5% ceiling. On exact-output it lands on the *token being
spent* rather than on the ETH reaching the escrow, which makes an oversized
setting easier to miss than it would be on a normal swap — so the panel says
which leg it applies to, and the setter clamps rather than trusting the input.

**Modals are a stack, not a slot.** The token picker opens the network view on
top of itself, and with a single slot that *replaced* the token picker — which
then unmounted and took its local filter signal with it, so choosing a network
did nothing and left nothing open. Now opening pushes, closing pops back, and
any filter that has to survive being covered lives in `state/filters.ts` rather
than inside the component.

**A finished flow dismisses the stack; it does not pop one level.** Review opens
*on top of* the create form, so `closeModal()` after a successful post landed back
on a filled-in create form — which reads as the flow restarting rather than
completing. Finishing now clears the draft, dismisses everything, and goes to the
book.

And it goes there with the new offer already open, because the id comes from the
**receipt** rather than the indexer: the book lags by design, so arriving on it
immediately after posting can show nothing at all, which looks exactly like a
failed post. `offerIdFromReceipt` pulls the id out of the `OfferEvent` the
transaction just emitted, and the order dialog reads the contract — so it is
correct the instant it opens, while the list behind it fills in on its next poll.

**Modal payloads name what to edit, never a copy of it.** The chain picker was
handed `selected: tokenNetworks()` — a value read at open time and frozen into the
payload. Toggling updated the signal behind the snapshot but never the snapshot,
so every checkbox stayed inert no matter what was clicked. Solid is explicit about
this: extract a signal's value instead of its accessor and reactivity is gone. The
payload now carries a `target` and the component reads the live signal itself.
A regression test drives a real `input.click()` rather than calling the setter,
because only that catches it.

**Network filters are sets.** The wireframe draws checkboxes, and a token *is* a
(chain, token) pair — someone holding USDC on Base and Arbitrum has two genuinely
different entries and no reason to see one at a time. Empty means *all*, so
unticking the last box widens the view rather than emptying it, and rows grow a
chain tag exactly when more than one network is on screen.

The network control itself was the other half of that confusion: "All networks"
looked exactly like the chain chips beside it but behaved differently — a chip
that navigates among chips that filter. It is now the leading chip, showing the
current selection and carrying a chevron because it opens something; the plain
chips next to it are one-click filter values.

## Icons

EVM tokens come from `assets.smold.app` (`/token/{chainId}/{address}/logo.svg`),
chains from `/chain/{chainId}/logo.svg`. Three quirks the code handles rather than
assumes, all found by watching it fail:

- **Native currency is keyed by `0xEeee…EEeE`**, not the zero address this app and
  Uniswap use. The zero address 404s.
- **No testnet has token artwork** — the host mirrors `SmolDapp/tokenAssets`, which
  has no testnet directories, native currency included. So a non-mainnet token
  resolves straight to its mainnet twin by symbol rather than firing a request
  that is known to fail. Chain logos *do* cover Sepolia.
- **XMR gets no request at all.** It is not an EVM token, so there is no
  (chain, address) to look up — and it is the one currency on every screen, which
  makes a guaranteed 404 the wrong trade. The official Monero mark is inlined
  (`spothq/cryptocurrency-icons`, CC0-1.0, so no attribution needed).

`.dot` is the icon box, and it took two fixes to actually be one:

**It has to be able to take a size.** It defaulted to `display: inline`, where
width and height are ignored outright — so anywhere it was not already a flex
child, the image fell back to the SVG's intrinsic size: 32px for most chain marks,
48px for Optimism. Inside the chips this never showed, because a flex item is
blockified; inside the book's grid cell, wrapped in a plain span, it did. It is
`inline-flex` now, and a DOM test asserts every box carries the explicit px size
its call site asked for.

**It is a placeholder, not a frame.** Every mark this app loads — chain logos,
token logos, the inlined Monero one — is already a self-contained circular badge
with its own ground, so keeping the bordered grey circle behind one drew a ring
around an already-round logo. `:has()` drops the border and background as soon as
artwork is present, and brings them back if every candidate 404s and the element
leaves the DOM. The border goes to `width: 0` rather than merely transparent —
a transparent border still occupies its 2px under `border-box`, which would render
the artwork two pixels short of the size requested.

Every chip that names a currency draws it, and the book's Chain column is the mark
rather than the word — the column is 100px and five logos are distinguishable,
with the name kept on hover and in the accessibility tree, since an unlabelled
glyph in a data table is a riddle.

The bare `.dot` survives only as a genuine fallback: a token whose artwork failed,
a wallet with no icon, a disconnected chain chip.

## One picker, and why it inverts

Every trade is XMR against something on an EVM. There is no XMR/XMR pair and no
token/token pair, so any request for a currency has exactly one valid
arrangement — and when the picker is asked for a currency the *other* slot is
holding, the answer is to invert the pair rather than refuse:

> selling XMR for USDC, then picking XMR on the buy side
> → you are now selling USDC for XMR

### Either direction, symmetrically

The protocol is symmetric — an offer has an ETH leg and an XMR leg, and either
can be the side you are parting with. The UI was not: the typed amount was pinned
to the **ETH** leg regardless of direction, so selling XMR moved the input down
into "You receive" and left "You pay" as a dead readout. The field the design says
is the one you fill could not be filled.

So the amount belongs to a *leg*, not to a field position:

- `payLeg()` follows the direction; `payAmount()` parses in that leg's units —
  12 decimals for XMR, 18 for ETH, and reading one as the other is off by 10⁶
- `matchOffers` takes `{ leg, amount }` and matches on that side, so an offer of
  0.25 ETH for 1.205 XMR answers a 1.205 **XMR** request and not a 0.25 XMR one
- deltas report in the unit that was typed — "0.02 ETH more" on an XMR request
  would be worse than saying nothing
- "You pay" is always the input; "You receive" is always the readout, because an
  offer is indivisible and there is no second amount to fill in

Flipping carries the *readout* up into the input rather than keeping the digits:
paying 0.25 ETH for 1.205 XMR flips to paying 1.205 XMR for ~0.25 ETH — the same
trade from the other side. Keeping "0.25" would silently ask for a different one.

### Posting carries the amount

"Post an offer" is a button under the widget rather than a mode tab for one
reason: unlike a tab, it takes the amount you just typed with it. Both legs are
seeded — the ETH amount *and* the readout, because the readout's rate is what a
maker prices against and on an empty book it is the only rate they have.

The draft is separate from the widget's own input rather than the same signal,
because the two mean different things: on the widget an amount is a *filter*, in
the form it is a *commitment*. Editing the form should not silently re-filter the
book behind it. All three entry points seed — widget, results, book — and an empty
amount bar seeds nothing rather than clearing a draft in progress.

`selectCurrency(slot, currency)` in `state/swap.ts` states this as "put this
currency on this slot" rather than as a flip, which is what keeps it correct:
there is nothing to toggle, and no reachable state where both slots agree. Both
chips open the same picker on both screens.

The one place XMR is *not* a legal answer is a claim payout — that is native ETH
swapped into an EVM token, so `allowXmr: false` drops it from the list entirely
rather than offering something the flow cannot do.

---

## The three API keys, and why none of them reach the browser

`vite.config.ts` proxies all three upstreams and attaches credentials
server-side. Nothing key-bearing is `VITE_`-prefixed, so a leaked `dist/` leaks
nothing.

| Route | Upstream | Header |
|---|---|---|
| `/api/graph` | Subgraph Studio query URL | `Authorization: Bearer $GRAPH_API_KEY` |
| `/api/token` | `api.pinax.network` | `Authorization: Bearer $TOKEN_API_JWT` |
| `/api/uniswap` | `trade-api.gateway.uniswap.org` | `x-api-key: $UNISWAP_API_KEY` |

**Deploying means standing up the same three rewrites at the edge**, which
`worker/` does — `shared.ts` holds the upstreams and their headers, `index.ts`
routes to them. The client code needs no change, since it only ever talks to
`/api/*`. If you change one, change both: a drift means the app works in
development and 404s in production.

See [Deploying to Cloudflare Workers](#deploying-to-cloudflare-workers) for the
settings and the three things `wrangler dev` caught that reasoning did not.

Two upstream facts worth knowing, both discovered the hard way:

- **`token-api.thegraph.com` no longer resolves.** The Graph's Token API is
  served from `api.pinax.network` now, same `/v1/evm/balances` shape.
- **Its `network` enum is mainnets only** — no Sepolia. Since Sepolia is where
  the contract is deployed, "Your tokens" is genuinely unavailable on the home
  chain. `coversChain()` exists so the UI can say that rather than render an
  empty list that reads as a broken fetch.

---

## Deploying to Cloudflare Workers

Cloudflare consolidated Pages into Workers — their own guidance is now "if you
are starting a new project, use Workers instead of Pages. Pages continues to
work, but new features and optimizations are focused on Workers." So this deploys
as a Worker with static assets, configured by `wrangler.jsonc`.

That is not the same contract as Pages, and the difference is the whole reason
this section exists:

| | Pages | Workers (here) |
|---|---|---|
| Server code | `functions/` compiled to file-based routes | one entry script, `worker/index.ts` |
| Route scoping | `_routes.json` | `assets.run_worker_first` |
| SPA fallback | implicit, when no `404.html` | explicit `assets.not_found_handling` |

`functions/` is **not** read by a Workers deployment. Cloudflare's migration guide
offers `wrangler pages functions build` to compile the old layout, but the logic
in `worker/shared.ts` was already plain functions of `(request, env, path)`, so
`worker/index.ts` routes to them directly rather than keeping a Pages-era build
step alive. It is also now inside `tsconfig.json`'s `include`, which `functions/`
never was — those handlers were never typechecked at all.

Build settings, because the client is a subdirectory of this repo:

| Setting | Value |
|---|---|
| Root directory | `web` — no leading slash |
| Build command | `pnpm build` |
| Deploy command | `pnpx wrangler deploy` |

`pnpm build` runs `tsc --noEmit` first, so a type error is a failed deploy rather
than a broken page. The output directory is not a dashboard setting here; it comes
from `assets.directory` in `wrangler.jsonc`.

Then the same keys the dev proxy reads, as **Workers secrets / environment
variables on the service** — `GRAPH_API_KEY`, `GRAPH_STUDIO_BASE`,
`UNISWAP_API_KEY`, and `TOKEN_API_JWT` if one has been issued. None may be
`VITE_`-prefixed; that would inline them into the browser bundle, which is the
whole thing the proxy exists to prevent.

**Connecting the repo has to be done in the dashboard**, because it needs the
Cloudflare GitHub App authorized against the repo owner — an interactive OAuth
grant on github.com that no Cloudflare token, API call, or wrangler command can
perform. Once connected, every push to `main` builds and deploys.

### Run it under workerd before trusting a deploy

```shell
pnpm build
grep -vE '^\s*(#|$)' .env | grep -vE '^VITE_' > .dev.vars   # bindings, gitignored
pnpm exec wrangler dev
```

This reads `wrangler.jsonc`, so it exercises the real routing rather than an
approximation of it — the asset worker, `run_worker_first`, and the SPA fallback
all behave as deployed. Three things it has caught that reading the code did not:

**`run_worker_first` has to be scoped, not `true`.** With `true`, the Worker
answers every request and `not_found_handling` never gets the chance to serve the
shell, so every client-routed deep link 404s.

**Pin a compatibility date the local wrangler supports.** A date newer than the
binary running it refuses to boot — "the newest date supported by this server
binary is …". The deployed edge is current, so an older date that both accept
keeps one config working in both places.

**Pages rejects the usual SPA `_redirects` rule outright.** Worth knowing if
anything here ever moves back: `/*  /index.html  200` produces "Infinite loop
detected in this rule and has been ignored", leaving "0 valid redirect rules" —
fine in dev, 404 on every deep link in production. Workers supports `_redirects`
natively, but `not_found_handling` covers the SPA case, so there is no such file.

## Uniswap: why exact-**output**

The contract escrows native ETH and nothing else. A taker holding USDC has to
arrive with a precise ETH figure — `take` reverts unless `msg.value >= required`,
where required is `offer.deposit` for a BUY and `offer.amount` for a SELL.

So the ETH side is the fixed leg and the token side is the variable one, which is
exactly `EXACT_OUTPUT`. The quote then bounds the token spend instead of the
proceeds: `quote.input.maximumAmount` is the "costs at most N USDC" figure the
review screen shows.

Two properties make this safe, and neither should be "simplified" away:

- On `EXACT_OUTPUT`, slippage lands on the **input** token. The ETH that reaches
  the escrow is not the slippage-bearing side.
- `take` refunds anything above `required` (`AUDIT.md` H2), so a quote that
  overshoots costs the user nothing. Do **not** replace this with an equality
  check against the offer amount — that reverts on every one-wei rounding
  difference.

**The swap and the escrow are separate transactions.** The Trading API sends
proceeds to the swapper, and there is no hook that would let one transaction do
both, so the ETH has to land in the wallet before `openOffer` or `take` can spend
it. The step list in `SwapReview` says so rather than implying atomicity. This is
the real integration friction in the project and belongs in `FEEDBACK.md`.

UniswapX is excluded from `protocols` deliberately: it fills off-chain and
asynchronously, and the escrow needs the ETH in the wallet before the *next*
transaction, not eventually.

---

## The Monero side — ported from upstream

`lib/monero.ts` is a port of `lib/src/` from
[`v3xlabs/xmrp2p`](https://github.com/v3xlabs/xmrp2p): `computeEscrowWallet`,
`encodeMoneroAddress`, Monero's block-wise base58, `combinePrivateKeys`,
`toMoneroKeyHex` and the wallet-URI builders.

**It is pre-existing work and it is LGPL-3.0**, while the rest of this repository
is MIT. The licence travels with the file and the two are kept distinct rather
than blended — see *Prior work* in the root README. Upstream ships it as a private
workspace package, so there is nothing to depend on; the `xmrp2p` name on npm is
an unrelated empty 0.0.1 placeholder with no repository and no exports, and
installing that would have been a supply-chain risk rather than a shortcut. It is
restated against `@noble/curves`, `@noble/hashes` and `viem`, all of which this app
already had, so the port added no dependency.

Porting it closed one gap and fixed one bug:

**The escrow address now exists.** It is the aggregate of both sides' committed
points — spend keys added, view key from the EVM side's public point plus the XMR
side's published private one — so it only resolves from `TAKEN` onward. Nothing
on-chain validates an address, so the encoder is covered by a round-trip test that
decodes its own output and re-derives the checksum, rather than by inspection of a
95-character string.

**Keys are shown in Monero's byte order.** The contract stores big-endian integers
of a compressed point; a wallet reads the same 32 bytes little-endian. The dialog
was showing the contract's integer, which pastes cleanly into a wallet and restores
a *different* one — a failure that looks like success. `toMoneroKeyHex` is the
conversion and a test pins the reversal.

QR codes use `qr` — the same generator upstream picked, zero-dependency,
MIT/Apache-2.0, by the same author as the `@noble` libraries already here. Not
decoration: the alternative to scanning is retyping a 95-character address and two
64-character keys into a phone. Each stage gets the URI it should have, and the
distinction matters — the EVM side is given a **view** URI so it can verify the
deposit without being able to take it, and only a published key half produces a
sweep URI. The codes are sized by `viewBox` and scaled with CSS, so the denser
symbol a ~390-character sweep URI needs stays the same physical size.

Two further changes followed from having their implementation to compare against:

- **Keys are seed-derived, not random.** BIP-39 phrase on upstream's BIP-44 path
  (`m/44'/128'/0'/0/0`), so the same phrase restores the same wallet in either
  client and a trade survives a cleared browser. A bare scalar made "clear site
  data" and "lose the trade" the same action.
- **The Monero network is tied to the EVM chain**, not configured beside it. A
  Sepolia escrow yields a *stagenet* address; only a mainnet deployment yields a
  mainnet one. Pairing them in `chains.ts` is what stops a testnet trade quoting
  an address that would accept real coins.

## Escrow keys

`lib/keys.ts` generates the Monero keypair each side commits to, in the encoding
the contract checks.

The encoding is the one thing here that is silently catastrophic to get wrong, so
it is pinned by test rather than by comment. `Ed25519.compressPointLittleEndian`
works out to the standard 32-byte RFC 8032 compressed encoding **read as a
big-endian integer**, while scalars are passed as plain integers — two different
conventions in the same ABI, and which argument wants which flips with the offer
kind. `domain.test.ts` checks `pointToUint256` against four vectors produced by
running the Solidity library under `forge`, and checks each of
`keysForOpen` / `keysForTake` / `keysForQuit` against the contract's branches.

**The private spend key generated at take time is the only thing that can later
claim the trade.** It goes to `localStorage` — per browser, per origin, surviving
a reload and nothing else — and the write happens *before* the transaction is
sent, because the other order loses the key on a crash mid-send. Every write is
paired with a copy/download the user is offered immediately.

---

## Known gaps

Three, each a deliberate stop rather than an oversight.

**Monero address derivation is not implemented.** The escrow address is the
aggregate of both sides' points. Every scalar and point the app *does* submit is
validated by the contract, so a mistake there surfaces as a revert; an address is
validated by nothing, and one wrong byte sends the coins somewhere unrecoverable.
Aggregating the points and base58-encoding the result is a small amount of code
and a large amount of risk without test vectors, so the key panels hand the
verified halves to a real wallet instead. This is the highest-value next piece of
work, and it wants vectors before it wants code.

**Permit2 signing works.** `/quote` returns `permitData` when a signature is
required — which, for a token-funded escrow, is the common case rather than the
exception: `approve` only appears when Permit2 itself holds no allowance yet.
`permitTypedData` in `lib/uniswap.ts` reshapes that payload for viem (deriving the
primary type, coercing the string integers to `bigint`) and `SwapReview` signs it
with `signTypedData`, adding a step to its own list when one is needed. It costs
no gas.

`permit.live.test.ts` proves the signature is the one Permit2 wants, which the
unit tests cannot: it signs a real quote with a throwaway key, posts it to
`/swap`, and asserts the 65 bytes come back embedded verbatim in the Universal
Router calldata. A wrong primary type, field order, or rounded `amount` all still
produce valid-looking bytes, so the recovered signer is the only real check.

**The book is nearly empty.** One offer on Sepolia; mainnet and Base have none
yet. Seeding is a task, not a client gap — see `PLAN.md`. Note the knock-on: with
fewer than `MIN_BOOK_SAMPLE` offers the widget will not quote a book rate and
falls back to Chainlink, saying so.

**Same-block quit is not gated.** The contract rejects an EVM-side quit on a SELL
offer in the block it was taken (`ErrorSellOfferCannotQuitInTakenBlock`); upstream
checks `blockNumber > blockTaken` before enabling the action and this client does
not. Since every write simulates first, it surfaces as that decoded error rather
than a loss.

---

## Three chains, two realms

The book spans every indexed chain — one subgraph each, merged in
`lib/subgraph.ts`. Three things that merge forces, each of which was a real bug
before it was a rule:

**An offer is `(chainId, offerId)`, never an id.** Ids restart at 1 on every
deployment, so offer #1 exists on all three chains. Dedupe keys, the order dialog,
contract reads and writes all take the pair — resolving a chain globally meant
opening one chain's order and signing against another's.

**Test money and real money are different markets.** The design's "one book, not
four" means Ethereum/Optimism/Arbitrum/Base — mainnets one wallet prompt apart.
Sepolia is here because it is where the contract landed first, and merging it into
a mainnet book put play money beside real money. Worse, the Monero network is
paired to the chain, so a Sepolia offer carries a *stagenet* escrow address. The
book is filtered by realm at the query, and a test asserts
`moneroMainnet === (realm === 'mainnet')` for every chain so the two cannot drift.
Own orders are deliberately exempt: a trade you are party to has a clock running
whichever chain it is on.

**A median of one offer is that offer.** `bookGoingRate` needs
`MIN_BOOK_SAMPLE` (3) open offers before the book gets to set a rate, and
cross-checks the median against Chainlink — more than `IMPLAUSIBLE_FACTOR` adrift
is a mispriced book, not a market that disagrees. Both guards return null so the
caller reaches for the feed. A single test offer priced ~100× off was being shown
as "the book's going rate".

## Checked against upstream

The money paths were compared line by line against
[`v3xlabs/xmrp2p`](https://github.com/v3xlabs/xmrp2p)'s client, which runs against
the same contract. `keysForTake`, `keysForOpen`, `requiredToTake`, the `claim` and
`quit` arguments, the EVM-side quit window and the SELL `msg.value` derivation all
agree.

It found one bug here. Upstream gates Take on
`counterparty === 0x0 || counterparty === me`, mirroring the contract's
`ErrorNonMember`. On an **OPEN** offer `counterparty` is a *restriction* — the one
address allowed to take it — not a party; `take` is what promotes it to a party by
overwriting the field with the taker. Reading it as a party broke both ways: an
offer reserved *for* you showed the maker's Cancel button, and one reserved for
someone else showed Take. Both reverted. `sideOf` and `canTake` now mirror the
contract.

Two differences are deliberate. Upstream floors the SELL deposit derivation; this
rounds up, because flooring can derive an offer fractionally smaller than the maker
asked for. And upstream requires a non-zero view key to enable a quit simulation
where this passes `0n` for the XMR side — the contract's XMR branch never reads it.

## Layout

```
src/
  lib/
    chains.ts      chain registry — which chains have a deployment, and which
                   the Token API covers
    abi.ts         generated from contracts/out via subgraph/abis
    contract.ts    every read and write that touches money
    keys.ts        Monero keypairs in the contract's encoding
    oracle.ts      Chainlink XMR/USD — the last rung of the rate ladder
    icons.ts       token and chain artwork, with the testnet fallback
    balances.ts    Multicall3 reads — exact figures, every chain
    tokenApi.ts    token discovery — mainnets only
    offers.ts      roles, per-side actions and deadlines, matching bands
    subgraph.ts    the offer book
    uniswap.ts     quotes, approvals, swap calldata
    tokens.ts      the constrained token list
    format.ts      units, rates, countdowns
  state/
    app.tsx        book, own orders, the clock, identity
    swap.ts        what the reader typed, and the draft offer
    modals.ts      one modal at a time
  components/      nav, widget, pickers, the order dialog, review
  routes/          Find · Results · Book · Orders
  styles/lofi.css  the wireframe's design system, one-to-one
```

`lib/offers.ts` is worth reading first — the BUY/SELL role flip and the
`orderStatus` timing rules are where the protocol actually lives, and every
button in the UI is decided there.

---

## Design

Implemented from the lo-fi wireframes, deliberately as lo-fi. `PLAN.md` puts
Hi-Fi below the cut line, so the wireframe *is* the spec: every token, class and
measurement in `styles/lofi.css` is the value from the artboard, not an
interpretation of it. When Hi-Fi lands, that file is the only thing that has to
change — nothing downstream hardcodes a colour or a font.

The wireframe's conventions, which the components rely on:

| | |
|---|---|
| solid ink button | primary action |
| outlined | secondary |
| dashed border | an exit, or an empty slot |
| left ink rule | this row is yours, or this is the recommendation |

Two things are redesigned rather than reflowed on a phone, following the design's
own note: the book's eight columns become one card per offer, and the
"waiting on you" band collapses to a single tappable line carrying the count and
the soonest deadline.
