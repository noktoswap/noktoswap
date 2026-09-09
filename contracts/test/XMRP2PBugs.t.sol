// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import {Test, console, Vm} from "forge-std/Test.sol";
import {XMRP2P} from "../src/XMRP2P.sol";
import {Ed25519} from "../src/Ed25519.sol";
import {OfferType, OfferState} from "../src/Enums.sol";
import "../src/Errors.sol";

/// Rejects every incoming ETH transfer.
contract RejectsEth {
    XMRP2P public immutable market;

    constructor(XMRP2P _market) {
        market = _market;
    }

    function take(uint256 offerId, uint256 spendKey, uint256 viewKey) external payable {
        market.take{value: msg.value}(offerId, spendKey, viewKey);
    }

    receive() external payable {
        revert("no");
    }
}

contract XMRP2PBugsTest is Test {
    uint256 constant L = 2 ** 252 + 27742317777372353535851937790883648493;

    XMRP2P market;

    address alice = address(0xA11CE); // EVM side
    address bob = address(0xB0B); // XMR side
    address owner = address(0x0FF1CE);

    uint256 keyNonce;

    function setUp() public {
        market = new XMRP2P(defaultParams(), owner);
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
    }

    function defaultParams() internal pure returns (XMRP2P.Parameters memory) {
        return XMRP2P.Parameters({
            MINIMUM_OFFER: 0.00001 ether,
            MAXIMUM_OFFER: 10 ether,
            DEPOSIT_RATIO: 500, // 5%
            MAXIMUM_OFFER_BOOK_SIZE: 100,
            T0_DELAY: 24 hours,
            T1_DELAY: 24 hours
        });
    }

    /// A fresh, valid ed25519 scalar plus its compressed public key.
    function newKey() internal returns (uint256 priv, uint256 pub) {
        keyNonce++;
        priv = uint256(keccak256(abi.encode("xmrp2p-test-key", keyNonce))) % L;
        if (priv == 0) priv = 1;
        pub = Ed25519.scalarMultBaseCompressed(priv);
    }

    /// Alice opens a BUY offer (she is the EVM side, paying `amount` ETH for XMR).
    function openBuy(uint256 amount) internal returns (uint256 offerId, uint256 evmSpendPriv, uint256 evmViewPriv) {
        uint256 spendPub;
        uint256 viewPub;
        (evmSpendPriv, spendPub) = newKey();
        (evmViewPriv, viewPub) = newKey();
        vm.prank(alice);
        XMRP2P.Offer memory o = market.openOffer{value: amount}(OfferType.BUY, 1e12, address(0), spendPub, viewPub);
        offerId = o.id;
    }

    // ---------------------------------------------------------------
    // H1 — the offer book cap counts every offer ever created, so the
    //      contract permanently stops accepting offers.
    // ---------------------------------------------------------------
    function test_H1_bookCapIsLiveNotCumulative() public {
        XMRP2P.Parameters memory p = defaultParams();
        p.MAXIMUM_OFFER_BOOK_SIZE = 2;
        XMRP2P m = new XMRP2P(p, owner);
        vm.deal(alice, 10 ether);

        uint256[] memory ids = new uint256[](2);
        for (uint256 i = 0; i < 2; i++) {
            (, uint256 spPub) = newKey();
            (, uint256 vpPub) = newKey();
            vm.prank(alice);
            ids[i] = m.openOffer{value: 1 ether}(OfferType.BUY, 1e12, address(0), spPub, vpPub).id;
        }

        // Free both slots.
        vm.prank(alice);
        m.cancel(ids[0]);
        vm.prank(alice);
        m.cancel(ids[1]);

        // The book is now empty, so a new offer must be accepted.
        (, uint256 sp2Pub) = newKey();
        (, uint256 vp2Pub) = newKey();
        vm.prank(alice);
        m.openOffer{value: 1 ether}(OfferType.BUY, 1e12, address(0), sp2Pub, vp2Pub);
    }

    // ---------------------------------------------------------------
    // H2 — overpaying `take` must not silently donate the excess.
    // ---------------------------------------------------------------
    function test_H2_takeRefundsOverpayment() public {
        (uint256 offerId,,) = openBuy(1 ether);
        uint256 deposit = 0.05 ether; // 5% of 1 ether

        (, uint256 spPub) = newKey();
        (uint256 vp,) = newKey();

        uint256 before = bob.balance;
        vm.prank(bob);
        market.take{value: deposit + 0.5 ether}(offerId, spPub, vp);

        assertEq(before - bob.balance, deposit, "taker overpayment was not returned");
        assertEq(address(market).balance, market.liability(), "contract holds unaccounted ETH");
    }

    // ---------------------------------------------------------------
    // H3 — a counterparty that rejects ETH must not be able to freeze
    //      both sides' funds forever.
    // ---------------------------------------------------------------
    function test_H3_quitSurvivesRejectingCounterparty() public {
        (uint256 offerId, uint256 evmSpendPriv, uint256 evmViewPriv) = openBuy(1 ether);

        RejectsEth hostile = new RejectsEth(market);
        vm.deal(address(hostile), 1 ether);

        (, uint256 spPub) = newKey();
        (uint256 vp,) = newKey();
        hostile.take{value: 0.05 ether}(offerId, spPub, vp);

        // Alice backs out before t0. This must succeed even though the
        // counterparty cannot receive ETH.
        uint256 before = alice.balance;
        vm.prank(alice);
        market.quit(offerId, evmSpendPriv, evmViewPriv);

        assertEq(alice.balance - before, 1 ether, "honest party did not get refunded");
    }

    // ---------------------------------------------------------------
    // M4 — listOffers(reverse) must return the same window as forward.
    // ---------------------------------------------------------------
    function test_M4_listOffersReverseWindow() public {
        uint256 first;
        for (uint256 i = 0; i < 3; i++) {
            (, uint256 spPub) = newKey();
            (, uint256 vpPub) = newKey();
            vm.prank(alice);
            uint256 id = market.openOffer{value: 1 ether}(OfferType.BUY, 1e12, address(0), spPub, vpPub).id;
            if (i == 0) first = id;
        }

        XMRP2P.Offer[] memory fwd = market.listOffers(first, 3, false);
        XMRP2P.Offer[] memory rev = market.listOffers(first, 3, true);

        for (uint256 i = 0; i < 3; i++) {
            assertEq(rev[i].id, fwd[2 - i].id, "reverse listing is not the mirror of forward");
        }
    }

    // ---------------------------------------------------------------
    // M5 — a SELL maker's private view key must be validated the same
    //      way a BUY taker's is.
    // ---------------------------------------------------------------
    function test_M5_sellOfferValidatesPrivateViewKey() public {
        (, uint256 spPub) = newKey();
        // Not a valid ed25519 scalar: >= L.
        uint256 bogusPrivViewKey = L + 1;

        vm.prank(bob);
        vm.expectRevert();
        market.openOffer{value: 0.05 ether}(OfferType.SELL, 1e12, address(0), spPub, bogusPrivViewKey);
    }

    // ---------------------------------------------------------------
    // M6 — an offer must not be takeable by its own maker.
    // ---------------------------------------------------------------
    function test_M6_cannotTakeOwnOffer() public {
        (uint256 offerId,,) = openBuy(1 ether);
        (, uint256 spPub) = newKey();
        (uint256 vp,) = newKey();

        vm.prank(alice);
        vm.expectRevert();
        market.take{value: 0.05 ether}(offerId, spPub, vp);
    }

    // ---------------------------------------------------------------
    // M7 — an offer promising zero XMR is meaningless.
    // ---------------------------------------------------------------
    function test_M7_rejectsZeroXmrAmount() public {
        (, uint256 spPub) = newKey();
        (, uint256 vpPub) = newKey();
        vm.prank(alice);
        vm.expectRevert();
        market.openOffer{value: 1 ether}(OfferType.BUY, 0, address(0), spPub, vpPub);
    }

    // ---------------------------------------------------------------
    // L8 — parameter validation.
    // ---------------------------------------------------------------
    function test_L8_rejectsInvertedOfferBounds() public {
        XMRP2P.Parameters memory p = defaultParams();
        p.MINIMUM_OFFER = 5 ether;
        p.MAXIMUM_OFFER = 1 ether;
        vm.expectRevert();
        new XMRP2P(p, owner);
    }

    function test_L8_rejectsZeroMinimumOffer() public {
        XMRP2P.Parameters memory p = defaultParams();
        p.MINIMUM_OFFER = 0;
        vm.expectRevert();
        new XMRP2P(p, owner);
    }

    // ---------------------------------------------------------------
    // L9 — offer id must be filterable in logs.
    // ---------------------------------------------------------------
    function test_L9_offerIdIsIndexed() public {
        // Burn a few ids so the offer id cannot coincide with an enum value.
        for (uint256 i = 0; i < 8; i++) {
            (, uint256 a) = newKey();
            (, uint256 b) = newKey();
            vm.prank(alice);
            market.openOffer{value: 1 ether}(OfferType.BUY, 1e12, address(0), a, b);
        }

        (, uint256 spPub) = newKey();
        (, uint256 vpPub) = newKey();

        vm.recordLogs();
        vm.prank(alice);
        uint256 id = market.openOffer{value: 1 ether}(OfferType.BUY, 1e12, address(0), spPub, vpPub).id;

        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(logs.length, 1, "expected one OfferEvent");
        // topics[0] is the signature; the offer id must be an indexed topic.
        bool found;
        for (uint256 i = 1; i < logs[0].topics.length; i++) {
            if (uint256(logs[0].topics[i]) == id) found = true;
        }
        assertTrue(found, "offer id is not indexed in OfferEvent");
    }

    // ---------------------------------------------------------------
    // Happy path must keep working.
    // ---------------------------------------------------------------
    function test_happyPathBuyOffer() public {
        (uint256 offerId,,) = openBuy(1 ether);

        (uint256 xmrSpendPriv, uint256 xmrSpendPub) = newKey();
        (uint256 xmrViewPriv,) = newKey();

        vm.prank(bob);
        market.take{value: 0.05 ether}(offerId, xmrSpendPub, xmrViewPriv);

        vm.prank(alice);
        market.ready(offerId);

        uint256 before = bob.balance;
        vm.prank(bob);
        market.claim(offerId, xmrSpendPriv);

        assertEq(bob.balance - before, 1.05 ether, "claimer payout wrong");
        assertEq(market.liability(), 0, "liability not settled");
        assertEq(address(market).balance, 0, "contract retained funds");
    }
}
