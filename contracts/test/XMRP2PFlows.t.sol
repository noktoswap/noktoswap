// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import {Test} from "forge-std/Test.sol";
import {XMRP2P} from "../src/XMRP2P.sol";
import {Ed25519} from "../src/Ed25519.sol";
import {OfferType, OfferState} from "../src/Enums.sol";
import "../src/Errors.sol";

/// Refuses ETH until `open` is flipped, modelling a counterparty that is
/// unreachable at payout time but can collect later.
contract PickyReceiver {
    XMRP2P public immutable market;
    bool public open;

    constructor(XMRP2P _market) {
        market = _market;
    }

    function setOpen(bool v) external {
        open = v;
    }

    function take(uint256 offerId, uint256 spendKey, uint256 viewKey) external payable {
        market.take{value: msg.value}(offerId, spendKey, viewKey);
    }

    function withdraw() external {
        market.withdraw();
    }

    receive() external payable {
        require(open, "closed");
    }
}

contract XMRP2PFlowsTest is Test {
    uint256 constant L = 2 ** 252 + 27742317777372353535851937790883648493;
    uint256 constant Q = 2 ** 255 - 19;

    XMRP2P market;
    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address owner = address(0x0FF1CE);
    uint256 keyNonce;

    function setUp() public {
        market = new XMRP2P(
            XMRP2P.Parameters({
                MINIMUM_OFFER: 0.00001 ether,
                MAXIMUM_OFFER: 10 ether,
                DEPOSIT_RATIO: 500,
                MAXIMUM_OFFER_BOOK_SIZE: 100,
                T0_DELAY: 24 hours,
                T1_DELAY: 24 hours
            }),
            owner
        );
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
    }

    function newKey() internal returns (uint256 priv, uint256 pub) {
        keyNonce++;
        priv = uint256(keccak256(abi.encode("flow-key", keyNonce))) % L;
        if (priv == 0) priv = 1;
        pub = Ed25519.scalarMultBaseCompressed(priv);
    }

    /// The contract must never hold ETH it does not owe to someone.
    function assertSolvent() internal view {
        assertEq(address(market).balance, market.liability(), "balance/liability drift");
    }

    // ---------------------------------------------------------------
    // An undeliverable payout becomes a credit the payee collects later,
    // and never blocks the other side.
    // ---------------------------------------------------------------
    function test_undeliverablePayoutBecomesCredit() public {
        (, uint256 evmSpendPub) = newKey();
        (, uint256 evmViewPub) = newKey();
        uint256 evmSpendPriv = uint256(keccak256(abi.encode("flow-key", keyNonce - 1))) % L;
        uint256 evmViewPriv = uint256(keccak256(abi.encode("flow-key", keyNonce))) % L;

        vm.prank(alice);
        uint256 offerId = market.openOffer{value: 1 ether}(OfferType.BUY, 1e12, address(0), evmSpendPub, evmViewPub).id;

        PickyReceiver picky = new PickyReceiver(market);
        vm.deal(address(picky), 1 ether);

        (, uint256 xmrSpendPub) = newKey();
        (uint256 xmrViewPriv,) = newKey();
        picky.take{value: 0.05 ether}(offerId, xmrSpendPub, xmrViewPriv);

        // Alice exits before t0; the hostile counterparty cannot stop her.
        vm.expectEmit(true, false, false, true, address(market));
        emit XMRP2P.PayoutCredited(address(picky), 0.05 ether);
        vm.prank(alice);
        market.quit(offerId, evmSpendPriv, evmViewPriv);

        assertEq(market.withdrawable(address(picky)), 0.05 ether, "credit not recorded");
        assertSolvent();

        // Once it can accept ETH again, it collects.
        picky.setOpen(true);
        uint256 before = address(picky).balance;
        vm.expectEmit(true, false, false, true, address(market));
        emit XMRP2P.Withdrawal(address(picky), 0.05 ether);
        picky.withdraw();
        assertEq(address(picky).balance - before, 0.05 ether, "credit not collectable");
        assertEq(market.withdrawable(address(picky)), 0, "credit not cleared");
        assertSolvent();
    }

    // ---------------------------------------------------------------
    // Commitments the contract could never match are rejected up front.
    // ---------------------------------------------------------------
    function test_rejectsNonCanonicalCommitment() public {
        (, uint256 viewPub) = newKey();
        // y = q is a non-canonical y-coordinate: no scalar maps to it.
        uint256 nonCanonical = Ed25519.changeEndianness(Q);

        vm.prank(alice);
        vm.expectRevert(Ed25519.NonCanonicalPoint.selector);
        market.openOffer{value: 1 ether}(OfferType.BUY, 1e12, address(0), nonCanonical, viewPub);
    }

    function test_rejectsIdentityCommitment() public {
        (, uint256 viewPub) = newKey();
        // y = 1 with a cleared sign bit is the identity point.
        uint256 identity = Ed25519.changeEndianness(1);

        vm.prank(alice);
        vm.expectRevert(Ed25519.NonCanonicalPoint.selector);
        market.openOffer{value: 1 ether}(OfferType.BUY, 1e12, address(0), identity, viewPub);
    }

    /// Every key the library can actually produce must pass the new gate.
    function testFuzz_realKeysAreCanonical(uint256 seed) public view {
        uint256 priv = seed % L;
        if (priv == 0) priv = 1;
        Ed25519.requireCanonicalPoint(Ed25519.scalarMultBaseCompressed(priv));
    }

    // ---------------------------------------------------------------
    // SELL side: maker posts the deposit, taker posts the full amount.
    // ---------------------------------------------------------------
    function test_sellOfferHappyPath() public {
        (uint256 xmrSpendPriv, uint256 xmrSpendPub) = newKey();
        (uint256 xmrViewPriv,) = newKey();

        vm.prank(bob); // bob is the XMR side and the maker
        uint256 offerId =
            market.openOffer{value: 0.05 ether}(OfferType.SELL, 1e12, address(0), xmrSpendPub, xmrViewPriv).id;

        XMRP2P.Offer[] memory listed = market.listOffers(offerId, 1, false);
        assertEq(listed[0].amount, 1 ether, "sell amount derived from deposit ratio");

        (, uint256 evmSpendPub) = newKey();
        (, uint256 evmViewPub) = newKey();
        vm.prank(alice); // alice is the EVM side and the taker
        market.take{value: 1 ether}(offerId, evmSpendPub, evmViewPub);

        vm.prank(alice);
        market.ready(offerId);

        uint256 before = bob.balance;
        vm.prank(bob);
        market.claim(offerId, xmrSpendPriv);

        assertEq(bob.balance - before, 1.05 ether, "seller payout wrong");
        assertSolvent();
        assertEq(market.liability(), 0);
    }

    // ---------------------------------------------------------------
    // The XMR side's exit after t1 refunds both parties.
    // ---------------------------------------------------------------
    function test_xmrSideQuitsAfterT1() public {
        (, uint256 evmSpendPub) = newKey();
        (, uint256 evmViewPub) = newKey();
        vm.prank(alice);
        uint256 offerId = market.openOffer{value: 1 ether}(OfferType.BUY, 1e12, address(0), evmSpendPub, evmViewPub).id;

        (uint256 xmrSpendPriv, uint256 xmrSpendPub) = newKey();
        (uint256 xmrViewPriv,) = newKey();
        vm.prank(bob);
        market.take{value: 0.05 ether}(offerId, xmrSpendPub, xmrViewPriv);

        vm.warp(block.timestamp + 49 hours); // past t1

        uint256 aliceBefore = alice.balance;
        uint256 bobBefore = bob.balance;
        vm.prank(bob);
        market.quit(offerId, xmrSpendPriv, 0);

        assertEq(alice.balance - aliceBefore, 1 ether, "evm side not refunded");
        assertEq(bob.balance - bobBefore, 0.05 ether, "xmr side deposit not refunded");
        assertSolvent();
        assertEq(market.liability(), 0);
    }

    // ---------------------------------------------------------------
    // Book accounting tracks OPEN offers, not lifetime creations.
    // ---------------------------------------------------------------
    function test_openOfferCountTracksBook() public {
        assertEq(market.openOfferCount(), 0);

        (, uint256 a) = newKey();
        (, uint256 b) = newKey();
        vm.prank(alice);
        uint256 id1 = market.openOffer{value: 1 ether}(OfferType.BUY, 1e12, address(0), a, b).id;
        assertEq(market.openOfferCount(), 1);

        (, uint256 c) = newKey();
        (, uint256 d) = newKey();
        vm.prank(alice);
        uint256 id2 = market.openOffer{value: 1 ether}(OfferType.BUY, 1e12, address(0), c, d).id;
        assertEq(market.openOfferCount(), 2);

        vm.prank(alice);
        market.cancel(id1);
        assertEq(market.openOfferCount(), 1, "cancel must free a slot");

        (, uint256 e) = newKey();
        (uint256 f,) = newKey();
        vm.prank(bob);
        market.take{value: 0.05 ether}(id2, e, f);
        assertEq(market.openOfferCount(), 0, "take must free a slot");
        assertSolvent();
    }

    // ---------------------------------------------------------------
    // recover() must not be able to touch escrowed funds.
    // ---------------------------------------------------------------
    function test_recoverCannotTouchEscrow() public {
        (, uint256 a) = newKey();
        (, uint256 b) = newKey();
        vm.prank(alice);
        market.openOffer{value: 1 ether}(OfferType.BUY, 1e12, address(0), a, b);

        vm.prank(owner);
        vm.expectRevert(ErrorInvalidAmount.selector);
        market.recover();

        assertEq(address(market).balance, 1 ether, "escrow was drained");
    }
}
