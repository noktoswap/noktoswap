// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {console} from "forge-std/Test.sol";
import {Script} from "forge-std/Script.sol";
import {Ed25519} from "../src/Ed25519.sol";
import {OfferType} from "../src/Enums.sol";
import {NoktoSwap} from "../src/NoktoSwap.sol";

contract NoktoSwapDeployer is Script {
    address constant OWNER = 0x225f137127d9067788314bc7fcc1f36746a3c3B5;
    bytes32 constant SALT = bytes32(0);
    uint256 constant VALUE = 0;
    uint256 constant SAMPLE_BUY_ORDER_AMOUNT = 0.01 ether;
    uint256 constant SAMPLE_PRICE = 6566502730000;
    uint256 constant SAMPLE_EVM_PRIVATE_SPEND_KEY = 0xebb84529f27fe2b7dde8bfadafcb3e07e0b43510ef2b20746effe5962ff33d02;
    uint256 constant SAMPLE_EVM_PRIVATE_VIEW_KEY = 0x3c27472aaaf62fcea2ef1e0f1ff031d5fcec66c60275c793453f93f5387fa207;

    function run() public {
        // Defaults to OWNER so mainnet behaviour is unchanged; testnet deploys
        // set NOKTOSWAP_OWNER so owner-only functions are reachable.
        address owner = vm.envOr("NOKTOSWAP_OWNER", OWNER);

        vm.startBroadcast();

        NoktoSwap xmrp2p = new NoktoSwap{value: VALUE}(
            NoktoSwap.Parameters({
                MINIMUM_OFFER: 0.00001 ether,
                MAXIMUM_OFFER: 10 ether,
                DEPOSIT_RATIO: 500, // 1000 = 10%, 500 = 5%
                MAXIMUM_OFFER_BOOK_SIZE: 100,
                T0_DELAY: 24 hours,
                T1_DELAY: 24 hours
            }),
            owner
        );
        console.log("Contract address: ", address(xmrp2p));
        console.log("Owner: ", owner);

        // (uint256 spendX, uint256 spendY) =
        //     Ed25519.scalarMultBase(Ed25519.changeEndianness(SAMPLE_EVM_PRIVATE_SPEND_KEY));
        // uint256 samplePublicSpendKey = Ed25519.changeEndianness(Ed25519.compressPoint(spendX, spendY));

        // (uint256 viewX, uint256 viewY) = Ed25519.scalarMultBase(Ed25519.changeEndianness(SAMPLE_EVM_PRIVATE_VIEW_KEY));
        // uint256 samplePublicViewKey = Ed25519.changeEndianness(Ed25519.compressPoint(viewX, viewY));

        // NoktoSwap.Offer memory sampleOffer = xmrp2p.offer{value: SAMPLE_BUY_ORDER_AMOUNT}(
        //     OfferType.BUY, SAMPLE_PRICE, address(0), samplePublicSpendKey, samplePublicViewKey
        // );
        // console.log("Sample offer id: ", sampleOffer.id);

        vm.stopBroadcast();
    }
}
