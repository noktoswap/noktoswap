# xmrp2p contracts

Atomic ETH ↔ XMR swaps. The contract escrows the ETH side and releases it only
against the reveal of a Monero private spend key, so taking the payout and
handing over the coins are the same action.

Forked from [`v3xlabs/xmrp2p`](https://github.com/v3xlabs/xmrp2p) at `4f74bd4`
(the v1.1 mainnet deployment) with ten fixes applied. See [AUDIT.md](AUDIT.md)
for what was wrong and why; every finding has a regression test.

## Layout

| Path | |
|---|---|
| `src/XMRP2P.sol` | the market: offers, escrow, deadlines, payouts |
| `src/Ed25519.sol` | on-chain ed25519 base-point multiplication and point validation |
| `src/Enums.sol`, `src/Errors.sol` | offer types/states and the error set |
| `test/XMRP2PBugs.t.sol` | one test per audit finding — each fails against upstream |
| `test/XMRP2PFlows.t.sol` | payout credits, key validation, both trade directions |

## Usage

```shell
forge build
forge test
forge fmt
```

`via_ir` is on: `XMRP2P.openOffer` returns a full `Offer` struct and does not fit
in the stack otherwise.

## Deploying

```shell
forge script script/XMRP2PDeployer.s.sol:XMRP2PDeployer \
  --rpc-url <rpc> --broadcast --verify
```

Parameters are set in the script. Note that `MAXIMUM_OFFER_BOOK_SIZE` now bounds
the number of **open** offers rather than the number ever created — see H1 in the
audit.
