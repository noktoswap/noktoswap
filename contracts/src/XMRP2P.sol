// SPDX-License-Identifier: MIT
//
// ==============================
// xmrp2p.eth - v1.1 ed25519 compressed
//
// Published by v3xlabs
// ==============================

pragma solidity ^0.8.34;

import {Ed25519} from "./Ed25519.sol";
import "./Errors.sol";
import "./Enums.sol";
import {Ownable} from "solady/auth/Ownable.sol";

contract XMRP2P is Ownable {
    struct Offer {
        uint256 id;
        OfferType kind;
        OfferState state;
        address owner;
        address counterparty;
        uint256 amount;
        uint256 deposit;
        uint256 xmrAmount;
        uint256 lastupdate;
        uint256 blockTaken;
        /// Monero public spend key of the EVM side of the trade
        uint256 evmPublicSpendKey;
        /// Monero private spend key of the EVM side of the trade. Set during a call to refund.
        uint256 evmPrivateSpendKey;
        /// Public view key provided by the EVM side of the trade. This is needed to compute the Monero address
        /// and to verify the private view key during a refund as the private view key may have been generated in a non standard way
        uint256 evmPublicViewKey;
        /// Monero private view key of the EVM side of the trade. Set during a call to refund.
        uint256 evmPrivateViewKey;
        /// Monero public spend key of the XMR side of the trade
        uint256 xmrPublicSpendKey;
        /// Monero private spend key of the XMR side of the trade. Set during a call to claim
        uint256 xmrPrivateSpendKey;
        /// Monero private view key of the XMR side of the trade. The EVM side of the trade doesn't need to share its private view key.
        uint256 xmrPrivateViewKey;
        /// Timestamp until which 'ready' can be called, after, taken offer is considered in the READY state
        uint256 t0;
        /// Timestamp until which 'claim' can be called. After, the EVM side can quit or the XMR side can resolve.
        uint256 t1;
    }

    struct Parameters {
        uint256 MINIMUM_OFFER;
        uint256 MAXIMUM_OFFER;
        uint256 DEPOSIT_RATIO;
        uint256 MAXIMUM_OFFER_BOOK_SIZE;
        uint256 T0_DELAY;
        uint256 T1_DELAY;
    }

    Parameters public parameters;

    /// Minimum T0 and T1 delays in seconds.
    uint256 constant MINIMUM_DELAY = 24 * 3_600;
    uint256 constant DEPOSIT_DENOMINATOR = 10000; // 10000 = 100%

    uint256 public liability;
    uint256 public nextOfferId = 1;
    /// Number of offers currently in the OPEN state, i.e. actually on the book.
    uint256 public openOfferCount;
    mapping(uint256 => Offer) public offers;
    mapping(uint256 => bool) public usedPublicKeys;
    /// Funds owed to an address whose payout could not be delivered.
    mapping(address => uint256) public withdrawable;

    /// Mutex for non re-entrancy
    bool internal _mutex = false;
    modifier nonReentrant() {
        _nonReentrantBefore();
        _;
        _nonReentrantAfter();
    }

    function _nonReentrantBefore() internal {
        require(!_mutex, ErrorReentrancy());
        _mutex = true;
    }

    function _nonReentrantAfter() internal {
        _mutex = false;
    }

    event OfferEvent(uint256 indexed offer_id, OfferType indexed kind, OfferState indexed state);

    constructor(Parameters memory _parameters, address _owner) payable {
        _initializeOwner(_owner);
        _setParameters(_parameters);
    }

    /// Receive function safeguard
    receive() external payable {
        require(0 == msg.value, ErrorUnableToAcceptPayment());
    }

    /// Fallback function safeguard
    fallback() external payable {
        require(0 == msg.value, ErrorUnableToAcceptPayment());
    }

    /// Deliver `amount` to `to`, which is currently counted in `liability`.
    ///
    /// A counterparty that reverts on receive must never be able to block the
    /// other side's exit, so a failed send is recorded as a credit instead of
    /// reverting. `liability` only drops once the ETH has actually left.
    function _payout(address to, uint256 amount) internal {
        if (0 == amount) return;
        (bool res,) = payable(to).call{value: amount}("");
        if (res) {
            liability -= amount;
        } else {
            withdrawable[to] += amount;
        }
    }

    /// Collect funds from a payout that could not be delivered.
    function withdraw() public nonReentrant {
        uint256 amount = withdrawable[msg.sender];
        require(amount > 0, ErrorInvalidOfferAmount());
        withdrawable[msg.sender] = 0;
        liability -= amount;
        (bool res,) = payable(msg.sender).call{value: amount}("");
        require(res, ErrorUnableToRefund());
    }

    function _keySanity(uint256 pubKey) internal {
        require(!usedPublicKeys[pubKey], ErrorKeyAlreadyUsed());
        usedPublicKeys[pubKey] = true;
    }

    function openOffer(
        OfferType offerType,
        uint256 xmrAmount,
        address counterparty,
        uint256 spendingKey,
        uint256 viewingKey
    ) public payable nonReentrant returns (Offer memory offer) {
        require(
            0 == parameters.MAXIMUM_OFFER_BOOK_SIZE || openOfferCount < parameters.MAXIMUM_OFFER_BOOK_SIZE,
            ErrorMaximumOfferBookSizeReached(parameters.MAXIMUM_OFFER_BOOK_SIZE)
        );
        require(xmrAmount > 0, ErrorInvalidAmount());

        Ed25519.requireCanonicalPoint(spendingKey);
        _keySanity(spendingKey);

        if (offerType == OfferType.BUY) {
            // The EVM side commits to two public keys.
            Ed25519.requireCanonicalPoint(viewingKey);
            _keySanity(viewingKey);
            offer.evmPublicSpendKey = spendingKey;
            offer.evmPublicViewKey = viewingKey;
        } else if (offerType == OfferType.SELL) {
            // The XMR side publishes its *private* view key in the clear.
            // Register the derived public key, both so the scalar is validated
            // and so the same key cannot be reused across the two offer types.
            _keySanity(Ed25519.scalarMultBaseCompressed(viewingKey));
            offer.xmrPublicSpendKey = spendingKey;
            offer.xmrPrivateViewKey = viewingKey;
        } else {
            revert ErrorInvalidOfferType();
        }

        uint256 evmAmount =
            offerType == OfferType.BUY ? msg.value : (msg.value * DEPOSIT_DENOMINATOR) / parameters.DEPOSIT_RATIO;
        uint256 deposit = offerType == OfferType.BUY
            ? ((msg.value * parameters.DEPOSIT_RATIO + DEPOSIT_DENOMINATOR - 1) / DEPOSIT_DENOMINATOR)
            : msg.value;

        require(evmAmount >= parameters.MINIMUM_OFFER && evmAmount <= parameters.MAXIMUM_OFFER, ErrorInvalidAmount());

        offer.kind = offerType;
        offer.id = nextOfferId++;
        offer.state = OfferState.OPEN;
        offer.lastupdate = block.timestamp;
        offer.owner = msg.sender;
        offer.counterparty = counterparty;
        offer.amount = evmAmount;
        offer.deposit = deposit;
        offer.xmrAmount = xmrAmount;

        liability += offer.kind == OfferType.BUY ? offer.amount : offer.deposit;
        openOfferCount++;

        offers[offer.id] = offer;

        emit OfferEvent(offer.id, offer.kind, offer.state);
    }

    /// Take an offer
    /// @param offerId Offer ID
    /// @param spendingKey (public)
    /// @param viewingKey (private (buy), public (sell))
    function take(uint256 offerId, uint256 spendingKey, uint256 viewingKey) public payable nonReentrant {
        Offer storage offer = offers[offerId];
        require(offer.state == OfferState.OPEN, ErrorOfferNotOpen());
        require(address(0) == offer.counterparty || offer.counterparty == msg.sender, ErrorNonMember());
        require(msg.sender != offer.owner, ErrorNonMember());

        Ed25519.requireCanonicalPoint(spendingKey);
        _keySanity(spendingKey);

        uint256 required;
        if (offer.kind == OfferType.BUY) {
            // The taker is the XMR side and publishes its *private* view key.
            _keySanity(Ed25519.scalarMultBaseCompressed(viewingKey));
            offer.xmrPublicSpendKey = spendingKey;
            offer.xmrPrivateViewKey = viewingKey;
            required = offer.deposit;
        } else {
            // The taker is the EVM side and commits to a public view key.
            Ed25519.requireCanonicalPoint(viewingKey);
            _keySanity(viewingKey);
            offer.evmPublicSpendKey = spendingKey;
            offer.evmPublicViewKey = viewingKey;
            required = offer.amount;
        }

        require(msg.value >= required, ErrorInvalidOfferAmount());
        liability += required;

        offer.state = OfferState.TAKEN;
        offer.counterparty = msg.sender;
        offer.blockTaken = block.number;
        offer.t0 = block.timestamp + parameters.T0_DELAY;
        offer.t1 = offer.t0 + parameters.T1_DELAY;
        offer.lastupdate = block.timestamp;
        openOfferCount--;

        emit OfferEvent(offer.id, offer.kind, offer.state);

        // Anything above the required stake belongs to the taker, not the contract.
        uint256 excess = msg.value - required;
        if (excess > 0) {
            liability += excess;
            _payout(msg.sender, excess);
        }
    }

    /// Cancel an offer
    /// @param offerId Offer ID
    /// The deposit or amount will be returned to the caller
    function cancel(uint256 offerId) public nonReentrant {
        Offer storage offer = offers[offerId];
        require(offer.state == OfferState.OPEN, ErrorOfferNotOpen());
        require(offer.owner == msg.sender, ErrorNonMember());

        uint256 amount = offer.kind == OfferType.BUY ? offer.amount : offer.kind == OfferType.SELL ? offer.deposit : 0;
        require(amount > 0, ErrorInvalidOfferAmount());

        offer.state = OfferState.CANCELLED;
        offer.lastupdate = block.timestamp;
        openOfferCount--;

        _payout(msg.sender, amount);

        emit OfferEvent(offer.id, offer.kind, offer.state);
    }

    /// Quit an offer
    /// Reveals private spending key and refunds both escrows
    /// @param offerId Offer ID
    /// @param spendingKey private spending key
    /// @param viewingKey private viewing key (0 for xmr-side)
    function quit(uint256 offerId, uint256 spendingKey, uint256 viewingKey) public nonReentrant {
        Offer storage offer = offers[offerId];

        if (
            (offer.kind == OfferType.BUY && msg.sender == offer.counterparty)
                || (offer.kind == OfferType.SELL && msg.sender == offer.owner)
        ) {
            // xmr
            require(offer.state == OfferState.READY || offer.state == OfferState.TAKEN, ErrorOfferNotReadyOrTaken());
            require(block.timestamp > offer.t1, ErrorClaimUnavailable());

            require(
                offer.xmrPublicSpendKey == Ed25519.scalarMultBaseCompressed(spendingKey), ErrorInvalidPrivateSpendKey()
            );
            offer.xmrPrivateSpendKey = spendingKey;
        } else if (
            (offer.kind == OfferType.BUY && msg.sender == offer.owner)
                || (offer.kind == OfferType.SELL && msg.sender == offer.counterparty)
        ) {
            // evm
            require(
                (offer.state == OfferState.TAKEN && (block.timestamp <= offer.t0 || block.timestamp > offer.t1))
                    || (offer.kind != OfferType.INVALID
                        && offer.state == OfferState.READY
                        && block.timestamp > offer.t1),
                ErrorInvalidOfferStateForQuit()
            );
            require(
                offer.kind != OfferType.SELL || block.number > offer.blockTaken, ErrorSellOfferCannotQuitInTakenBlock()
            );

            require(
                offer.evmPublicSpendKey == Ed25519.scalarMultBaseCompressed(spendingKey),
                ErrorBuyOfferInvalidEVMPrivateSpendKey()
            );
            require(
                offer.evmPublicViewKey == Ed25519.scalarMultBaseCompressed(viewingKey), ErrorInvalidEVMPrivateViewKey()
            );
            offer.evmPrivateSpendKey = spendingKey;
            offer.evmPrivateViewKey = viewingKey;
        } else {
            revert ErrorNonMember();
        }

        offer.state = OfferState.REFUNDED;
        offer.lastupdate = block.timestamp;

        uint256 amountR1 = offer.kind == OfferType.BUY ? offer.amount : offer.kind == OfferType.SELL ? offer.deposit : 0;
        uint256 amountR2 = offer.kind == OfferType.BUY ? offer.deposit : offer.kind == OfferType.SELL ? offer.amount : 0;
        _payout(offer.owner, amountR1);
        _payout(offer.counterparty, amountR2);

        emit OfferEvent(offer.id, offer.kind, offer.state);
    }

    /// Ready an offer
    /// This function is called by the buyer once the XMR deposit has been validated
    function ready(uint256 offerId) public nonReentrant {
        Offer storage offer = offers[offerId];
        require(offer.state == OfferState.TAKEN, ErrorOfferNotTaken());
        require(block.timestamp <= offer.t0, ErrorOfferAfterT0());
        require(
            (offer.kind == OfferType.BUY && msg.sender == offer.owner)
                || (offer.kind == OfferType.SELL && msg.sender == offer.counterparty),
            ErrorNonMember()
        );
        offer.state = OfferState.READY;
        offer.lastupdate = block.timestamp;

        emit OfferEvent(offer.id, offer.kind, offer.state);
    }

    /// Claim an offer
    /// @param offerId Offer ID
    /// @param privateSpendKey XMR private spend key
    /// The claim function completes a swap by revealing the private spend key
    function claim(uint256 offerId, uint256 privateSpendKey) public nonReentrant {
        Offer storage offer = offers[offerId];
        require(offer.state == OfferState.READY || offer.state == OfferState.TAKEN, ErrorOfferNotReadyOrTaken());

        require(
            (offer.state == OfferState.TAKEN && block.timestamp > offer.t0 && block.timestamp <= offer.t1)
                || (offer.state == OfferState.READY && block.timestamp <= offer.t1),
            ErrorClaimUnavailable()
        );
        require(
            (offer.kind == OfferType.BUY && msg.sender == offer.counterparty)
                || (offer.kind == OfferType.SELL && msg.sender == offer.owner),
            ErrorNonMember()
        );

        require(
            offer.xmrPublicSpendKey == Ed25519.scalarMultBaseCompressed(privateSpendKey), ErrorInvalidPrivateSpendKey()
        );
        offer.xmrPrivateSpendKey = privateSpendKey;

        offer.state = OfferState.CLAIMED;
        offer.lastupdate = block.timestamp;

        uint256 amount = offer.amount + offer.deposit;
        _payout(msg.sender, amount);

        emit OfferEvent(offer.id, offer.kind, offer.state);
    }

    /// Sweep only ETH that is not owed to anyone (e.g. force-sent via selfdestruct).
    function recover() public onlyOwner nonReentrant {
        uint256 balance = address(this).balance;
        require(balance >= liability, ErrorInvalidAmount());
        uint256 surplus = balance - liability;
        require(surplus > 0, ErrorInvalidAmount());
        (bool res,) = payable(msg.sender).call{value: surplus}("");
        require(res, ErrorUnableToRefund());
    }

    function listOffers(uint256 offset, uint256 count, bool reverse) public view returns (Offer[] memory) {
        Offer[] memory _offers = new Offer[](count);
        for (uint256 i = 0; i < count; i++) {
            uint256 index = reverse ? offset + count - 1 - i : offset + i;
            _offers[i] = offers[index];
        }
        return _offers;
    }

    function _setParameters(Parameters memory _parameters) internal {
        parameters = _parameters;
        require(parameters.T0_DELAY >= MINIMUM_DELAY, ErrorParametersInvalid());
        require(parameters.T1_DELAY >= MINIMUM_DELAY, ErrorParametersInvalid());
        require(
            parameters.DEPOSIT_RATIO > 0 && parameters.DEPOSIT_RATIO <= DEPOSIT_DENOMINATOR, ErrorParametersInvalid()
        );
        require(parameters.MINIMUM_OFFER > 0, ErrorParametersInvalid());
        require(parameters.MINIMUM_OFFER <= parameters.MAXIMUM_OFFER, ErrorParametersInvalid());
    }

    function setParameters(Parameters memory _parameters) public onlyOwner {
        _setParameters(_parameters);
    }
}
