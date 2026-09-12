// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {console} from "forge-std/Test.sol";
import {Script} from "forge-std/Script.sol";
import {XMRP2P} from "../src/XMRP2P.sol";

/// Minimal CreateX surface. CreateX sits at this same address on every chain we
/// target, deployed by a pre-signed transaction, so there is nothing per-chain
/// to configure. https://github.com/pcaversaccio/createx
interface ICreateX {
    function deployCreate3(bytes32 salt, bytes memory initCode) external payable returns (address);
    function computeCreate3Address(bytes32 guardedSalt) external view returns (address);
}

/// Deploys XMRP2P to an identical address on every chain, via CreateX's CREATE3.
///
/// CREATE3 derives the address from `(deployer, salt)` alone — never from the
/// initcode — so constructor arguments may differ per chain and the address
/// still matches. The flip side is that a shared address says nothing about the
/// code behind it, so this script prints the runtime codehash after every
/// deploy. Compare those across chains, or "same address everywhere" is a
/// coincidence you are describing as a property.
///
///   forge script script/XMRP2PCreate3.s.sol:XMRP2PCreate3 --sig 'predict()' --rpc-url sepolia
///   forge script script/XMRP2PCreate3.s.sol:XMRP2PCreate3 --rpc-url sepolia --broadcast
///
/// `predict()` needs no key — set `XMRP2P_DEPLOYER` to the address alone.
contract XMRP2PCreate3 is Script {
    ICreateX constant CREATEX = ICreateX(0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed);

    /// Low 11 bytes of the salt — ascii "noktoswapv1".
    uint88 constant ENTROPY = 0x6e6f6b746f737761707631;

    function parameters() internal pure returns (XMRP2P.Parameters memory) {
        return XMRP2P.Parameters({
            MINIMUM_OFFER: 0.00001 ether,
            MAXIMUM_OFFER: 10 ether,
            DEPOSIT_RATIO: 500, // 10000 = 100%, 500 = 5%
            MAXIMUM_OFFER_BOOK_SIZE: 100,
            T0_DELAY: 24 hours,
            T1_DELAY: 24 hours
        });
    }

    /// CreateX guards every salt it is handed. Of the layouts it accepts,
    /// exactly one is both permissioned and free of `block.chainid`:
    ///
    ///   bytes 0..19  == msg.sender  -> only this deployer may use the salt
    ///   byte  20     == 0x00        -> no cross-chain redeploy protection
    ///   bytes 21..31 == entropy
    ///
    /// Set byte 20 to 0x01 instead and CreateX folds the chain id into the
    /// guarded salt, so every chain lands on a different address. That is the
    /// single mistake this layout exists to avoid, and the reason `run()`
    /// asserts the deployed address against the precomputed one.
    ///
    /// Permissioned matters as much as chain-independence: it means nobody can
    /// squat this address on a chain we have not reached yet.
    function _salt(address deployer) internal pure returns (bytes32) {
        return bytes32((uint256(uint160(deployer)) << 96) | uint256(ENTROPY));
    }

    /// Mirrors CreateX `_guard` for the layout above.
    function _guardedSalt(address deployer) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(bytes32(uint256(uint160(deployer))), _salt(deployer)));
    }

    /// Owner is a constructor argument, so it lands in the initcode but not in
    /// the runtime code — `_initializeOwner` writes it to storage. A per-chain
    /// owner therefore changes this hash while leaving the runtime codehash
    /// identical, which is why both get printed.
    function _initCode(address owner) internal pure returns (bytes memory) {
        return abi.encodePacked(type(XMRP2P).creationCode, abi.encode(parameters(), owner));
    }

    function _deployer() internal view returns (address) {
        address given = vm.envOr("XMRP2P_DEPLOYER", address(0));
        if (given != address(0)) return given;
        return vm.addr(vm.envUint("DEPLOYER_KEY"));
    }

    /// Defaults to the deployer, deliberately. XMRP2PDeployer defaults instead
    /// to a hard-coded `OWNER` inherited from upstream — and that address is the
    /// owner of v3xlabs's v1.1 mainnet deployment, not ours. Running this script
    /// without thinking should not hand `setParameters` and `recover` to another
    /// project, so there is no constant here to forget to override.
    ///
    /// Ownership is rotatable: solady's `transferOwnership` comes through
    /// unmodified, so moving admin to a cold key later needs no redeploy. The
    /// CREATE3 address is the part that is permanent.
    function _owner(address deployer) internal view returns (address) {
        return vm.envOr("XMRP2P_OWNER", deployer);
    }

    /// Read-only. Run it on each target chain and check the addresses match
    /// before broadcasting anything.
    function predict() public view {
        address deployer = _deployer();
        address owner = _owner(deployer);
        address predicted = CREATEX.computeCreate3Address(_guardedSalt(deployer));

        console.log("chain id:      ", block.chainid);
        console.log("deployer:      ", deployer);
        console.log("owner:         ", owner);
        console.log("predicted:     ", predicted);
        console.log("deployed here: ", predicted.code.length != 0);
        console.log("salt:");
        console.logBytes32(_salt(deployer));
        console.log("initcode hash:");
        console.logBytes32(keccak256(_initCode(owner)));
    }

    function run() public {
        uint256 pk = vm.envUint("DEPLOYER_KEY");
        address deployer = vm.addr(pk);
        address owner = _owner(deployer);

        bytes memory initCode = _initCode(owner);
        address predicted = CREATEX.computeCreate3Address(_guardedSalt(deployer));

        console.log("chain id:      ", block.chainid);
        console.log("deployer:      ", deployer);
        console.log("owner:         ", owner);
        console.log("predicted:     ", predicted);
        console.log("initcode hash:");
        console.logBytes32(keccak256(initCode));

        // Idempotent across chains: re-running the whole set after funding one
        // more chain should not revert on the ones already done.
        if (predicted.code.length != 0) {
            console.log("already deployed on this chain, nothing to do");
            console.log("runtime codehash:");
            console.logBytes32(predicted.codehash);
            return;
        }

        vm.startBroadcast(pk);
        address deployed = CREATEX.deployCreate3(_salt(deployer), initCode);
        vm.stopBroadcast();

        // If the salt layout were wrong, this is where it surfaces — before the
        // address gets written into a README as a cross-chain constant.
        require(deployed == predicted, "CREATE3 address mismatch");

        console.log("deployed:      ", deployed);
        console.log("runtime codehash (compare across chains):");
        console.logBytes32(deployed.codehash);
    }
}
