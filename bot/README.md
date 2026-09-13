# NoktoSwap market-making bot

A CLI that quotes both sides of the ETH/XMR offer book and services the positions
it opens.

```shell
pnpm install
export BOT_PRIVATE_KEY=0x…              # 32 bytes of hex, never a flag
pnpm bot status                         # balances, parameters, live positions
pnpm bot quote --mid 480                # what it would post, and why
pnpm bot make --live --max-offer-eth 0.01 --max-total-eth 0.05
pnpm bot run                            # the same, on a loop
pnpm test                               # 27 checks, offline
```

Everything is a dry run until `--live`, and a dry run still simulates every write
against the real contract — so `make` without `--live` is the intended way to see
what the bot would do to a live book.

---

## Do you need both an ETH and an XMR balance?

Yes, and the split is not symmetric. It falls out of `openOffer`:

| Offer | Maker (owner) | Taker |
|---|---|---|
| **BUY** | EVM side — escrows the **full** ETH amount | XMR side — posts the `deposit` |
| **SELL** | XMR side — escrows only the `deposit` | EVM side — posts the **full** amount |

So:

- **ETH is needed for every role.** Either as the consideration (the EVM side) or
  as collateral against walking away (the XMR side), plus gas. On Sepolia the
  deposit is 5% of the ETH leg, read from `parameters()` rather than assumed.
- **Spendable XMR is needed only when the bot is the XMR side** — opening a SELL or
  taking a BUY. That is the side that actually pays coins into the escrow.
- **A Monero wallet is needed for both sides**, even though only one funds. The EVM
  side needs it to *verify* the deposit before `ready()` and to *sweep* the escrow
  after `claim()`.

A one-sided EVM-only bot therefore needs no XMR at all. A two-sided maker needs
both, and `strategy.ts` sizes each side against whichever balance binds it: ETH for
the BUY quotes, XMR for the SELL quotes.

## Why the servicing matters more than the pricing

An offer that gets taken starts two clocks, and the sequence after that is fixed:

```
  take ──▶ XMR side pays the escrow
            │
            ├─▶ EVM side verifies, calls ready()       must be before t0
            │     │
            │     └─▶ XMR side calls claim()           before t1; reveals its
            │           spend scalar, takes the ETH    spend key by doing so
            │
            └─▶ EVM side sweeps the escrow             now that both halves exist
```

Every arrow has a deadline, and the penalty for missing one is a refund at best.
There is also a gap that is easy to get wrong: having missed `ready()`, the EVM
side **cannot** `quit` until `t1` either — the contract permits `quit` from `TAKEN`
only at `<= t0 || > t1`. A bot that assumes it can always exit will burn gas on a
revert every pass. `engine.ts` transcribes the gates rather than approximating
them, and `bot.test.ts` pins the whole table.

Deadlines are compared against **chain time**, not the bot's clock. The contract
reads `block.timestamp`, so a bot deciding from `Date.now()` acts early or late at
exactly the moment it matters.

## Safety, because this spends money unattended

| Flag | Effect |
|---|---|
| *(default)* | dry run — every write simulated, nothing sent |
| `--live` | actually send transactions |
| `--allow-mainnet` | required on a mainnet; testnets need no flag |
| `--max-offer-eth` | cap per offer, **required** with `--live` |
| `--max-total-eth` | cap on total exposure, **required** with `--live` |

The caps have no defaults in live mode on purpose: the cap is the one number that
should not be inherited from someone else's judgement. The bot also keeps 0.002 ETH
back for gas, because a balance entirely escrowed cannot pay for the `claim` that
collects it.

Keys come from the environment, never from flags — argv is visible in `ps` and
lands in shell history.

## Keys: the sharpest edge

The scalar generated when an offer is opened or taken is the **only** thing that can
later `claim` or `quit` it. Lose it and the ETH sits in escrow until a deadline
refunds it, and any XMR already paid in is gone for good, because spending the
escrow needs both halves.

So `keystore.ts` writes only the mnemonic (everything else derives from it), writes
atomically via a temp file and rename (the process can be killed mid-write), and
chmods `0600`/`0700`. `pnpm bot backup` prints every phrase for writing down.

**A fresh keypair per offer, always.** `_keySanity` in the contract records every
public key it has ever seen and reverts on a repeat, so reusing a pair does not
merely weaken the escrow — the transaction fails.

## The Monero side

`--monero-rpc http://127.0.0.1:18082` attaches a `monero-wallet-rpc`. Without it the
bot runs EVM-side only, and the operations that need a wallet **throw with
instructions rather than return a plausible answer**. That is deliberate: a backend
that reported "nothing received" would let good trades expire, and one that reported
success would call `ready()` on an escrow that was never funded, which hands the
counterparty the ETH.

Two properties of that RPC shape the code. It is **single-wallet**, so watching an
escrow — which needs a different wallet, built from the counterparty's published
view key — means closing the funding wallet, opening a view-only one, and putting
the original back, including on failure. And it defaults to **HTTP digest auth**,
which `walletRpc.ts` implements rather than assuming `--disable-rpc-login`; a wallet
daemon holding spendable funds with authentication off is a convenience that reads
fine until the port is reachable.

The escrow address is the aggregate of both sides' public spend points, and its
spend scalar is the two private halves summed mod ℓ. The bot derives it with the
same `computeEscrowWallet` the web client uses — one definition of a
safety-critical calculation, not two.

**The escrow's Monero network follows the EVM chain.** A Sepolia offer yields a
*stagenet* address. That pairing is the safety property: it is what stops real coins
being sent against a test trade.

## What is reused, and why

`chain.ts`, `keys` and `monero` come from `../web/src/lib`. Reimplementing ed25519
key derivation, escrow aggregation or Monero address encoding would mean two
definitions of things that must agree exactly, and the web client's versions are the
ones checked against Solidity vectors and round-tripped in its own tests.

The persistence half of `keys.ts` is *not* reused — it is `localStorage`, which does
not exist here.

`viem` directly rather than `@wagmi/core`: wagmi manages connectors, a user picking
a wallet, a chain switching underneath. A bot has one key, one chain and no user, so
all of that is answered at startup and the machinery would only add ways for the
answer to change.

## Commands

| | |
|---|---|
| `status` | balances, market parameters, every live position and its next action |
| `book` | the open book as the contract reports it |
| `quote` | what the strategy would post now, and what it already has |
| `make` | post missing quotes, then service positions, once |
| `run` | the same on a loop; a failing pass never ends the loop |
| `service` | service existing positions only, post nothing |
| `take <id>` | take one offer |
| `cancel <id>` | cancel one of your own |
| `escrow <id>` | the escrow address, and the keys to import if it is spendable |
| `keys` / `backup` | list stored pairs; print the mnemonics |

## Pricing

Deliberately plain: a symmetric two-sided quote around a mid, stepped out by
`--spread` per `--depth` level. Cleverness buys little on a thin book of
indivisible offers, and what decides whether a maker survives here is servicing
deadlines and never quoting a size it cannot deliver.

The mid comes from the book's median, and **refuses below three open offers**. The
web client learned this the hard way: a single 482 XMR/ETH test offer became "the
book's going rate", which is a confident claim from one data point. Pass `--mid` to
quote anyway.
