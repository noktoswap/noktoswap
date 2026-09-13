# Noktoswap contracts

Atomic ETH ↔ XMR swaps. The contract escrows the ETH side and releases it only
against the reveal of a Monero private spend key, so taking the payout and
handing over the coins are the same action.

Forked from [`v3xlabs/xmrp2p`](https://github.com/v3xlabs/xmrp2p) at `4f74bd4`
(the v1.1 mainnet deployment) with ten fixes applied. See [AUDIT.md](AUDIT.md)
for what was wrong and why; every finding has a regression test.

## Layout

| Path | |
|---|---|
| `src/NoktoSwap.sol` | the market: offers, escrow, deadlines, payouts |
| `src/Ed25519.sol` | on-chain ed25519 base-point multiplication and point validation |
| `src/Enums.sol`, `src/Errors.sol` | offer types/states and the error set |
| `test/NoktoSwapBugs.t.sol` | one test per audit finding — each fails against upstream |
| `test/NoktoSwapFlows.t.sol` | payout credits, key validation, both trade directions |

## Usage

```shell
forge build
forge test
forge fmt
```

`via_ir` is on: `NoktoSwap.openOffer` returns a full `Offer` struct and does not fit
in the stack otherwise.

## Deploying

```shell
forge script script/NoktoSwapDeployer.s.sol:NoktoSwapDeployer \
  --rpc-url <rpc> --broadcast --verify
```

Parameters are set in the script. Note that `MAXIMUM_OFFER_BOOK_SIZE` now bounds
the number of **open** offers rather than the number ever created — see H1 in the
audit.

## Deploying to the same address on every chain

`NoktoSwapCreate3.s.sol` deploys through [CreateX](https://github.com/pcaversaccio/createx)'s
CREATE3, which derives the address from `(deployer, salt)` and never from the
initcode. Constructor arguments may therefore differ per chain while the address
stays fixed. CreateX is already deployed at `0xba5Ed0…ba5Ed` on every chain here,
so there is nothing to bootstrap.

```shell
# read-only; needs no key. Run per chain and check the addresses match.
NOKTOSWAP_DEPLOYER=0x… forge script script/NoktoSwapCreate3.s.sol:NoktoSwapCreate3 \
  --sig 'predict()' --rpc-url base

DEPLOYER_KEY=0x… forge script script/NoktoSwapCreate3.s.sol:NoktoSwapCreate3 \
  --rpc-url base --broadcast
```

Owner defaults to the deployer. `NOKTOSWAP_OWNER` overrides it, and ownership is
rotatable afterwards — solady's `transferOwnership` is unmodified — so admin can
move to a cold key without redeploying. The address is the permanent part.

The salt layout is the load-bearing detail: bytes 0–19 are the deployer, byte 20
is `0x00`, bytes 21–31 are `"noktoswapv1"`. Byte 20 is what selects CreateX's
guard — `0x00` keeps `block.chainid` out of the guarded salt so every chain
agrees on the address, while `0x01` folds it in and they all diverge. Putting the
deployer in the first 20 bytes makes the salt *permissioned*, so nobody else can
claim the address on a chain we have not reached. `run()` asserts the deployed
address against the precomputed one, which is where a wrong layout would surface.

**A shared address is not a shared contract.** CREATE3 ignores initcode, so the
script prints the runtime codehash on every deploy; compare those, or the match
is a coincidence being described as a property. All four deployments below report
`0x87856a11…`.

## Deployments

| Network | Address | Notes |
|---|---|---|
| Mainnet | [`0x4862839b…`](https://etherscan.io/address/0x4862839b11a6013FCC2A5f5AD2bA438Cac742d8C) | CREATE3, block `25962326` |
| Base | [`0x4862839b…`](https://basescan.org/address/0x4862839b11a6013FCC2A5f5AD2bA438Cac742d8C) | CREATE3, block `51219297` |
| Base Sepolia | [`0x4862839b…`](https://sepolia.basescan.org/address/0x4862839b11a6013FCC2A5f5AD2bA438Cac742d8C) | CREATE3, block `46729575` |
| Sepolia | [`0x67DB37c3…`](https://sepolia.etherscan.io/address/0x67DB37c3be37B44c0506e5DF441437C83114bCd2) | pre-CREATE3, block `11670176` — **the subgraph target** |
| Mainnet | [`0xad6871d4…`](https://etherscan.io/address/0xad6871d44804288ba4393464c63544d6691d76ba) | upstream v1.1, pre-audit — indexed by nothing here |

Sepolia sits outside the CREATE3 set deliberately: it predates the decision, and
it is the deployment the live subgraph indexes. Repointing it means a resync, so
it keeps its own address until there is a reason to pay that.

Sepolia's runtime code differs from the CREATE3 set in its last 43 bytes only —
the CBOR metadata trailer, which moved when a comment changed. The first 8,818
bytes are identical.

`NoktoSwapDeployer.s.sol` remains for plain CREATE deploys. Note its `OWNER`
constant is v3xlabs's, inherited from upstream, so it needs `NOKTOSWAP_OWNER` set;
`NoktoSwapCreate3.s.sol` defaults to the deployer instead and has no such trap.
