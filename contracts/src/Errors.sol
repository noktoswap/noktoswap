// SPDX-License-Identifier: MIT
//
// Copyright (c) 2025-2026  v1rtl
//

pragma solidity ^0.8.34;

import "./Enums.sol";

//
// Errors
//

error ErrorNonMember();

error ErrorInvalidPrivateSpendKey();

error ErrorClaimUnavailable();

error ErrorOfferNotReadyOrTaken();

error ErrorOfferAfterT0();

error ErrorUnableToRefund();

error ErrorInvalidEVMPrivateViewKey();

error ErrorSellOfferCannotQuitInTakenBlock();

error ErrorOfferNotTaken();

error ErrorInvalidOfferStateForQuit();

error ErrorInvalidOfferAmount();

error ErrorOfferNotOpen();

error ErrorParametersInvalid();

error ErrorInvalidAmount();

/// Error raised when an address attempts to create a BuyOffer while there exists a FundingRequest for that same address.
/// The rationale is that if the address opens a BuyOffer then it has a balance which would have allowed to open a SellOffer.
/// So we disallow creating a BuyOffer unless the FundingRequest is removed, either voluntarily or because the SellOffer which
/// it funded has completed.
error ErrorBuyOfferNoCreationWhenActiveFundingRequestExists();

/// This error is raised when a BuyOffer is created or updated and the specified amount is below the minimum amount
/// configured in the contract for buy offers (MINIMUM_BUY_OFFER)
/// @param minimum the minimum acceptable amount
error ErrorBuyOfferAmountBelowMinimum(uint256 minimum);

/// This error is raised when a BuyOffer is created or updated and the specified amount is above the maximum amount
/// configured in the contract for buy offers (MAXIMUM_BUY_OFFER)
/// @param maximum the maximum acceptable amount
error ErrorBuyOfferAmountAboveMaximum(uint256 maximum);

/// This error is raised when a BuyOffer is updated and the specified state is not compatible with updates
/// @param state the current state of the offer
error ErrorBuyOfferInvalidStateForUpdate(OfferState state);

/// Error raised when attempting to reference a non existent BuyOffer.
error ErrorBuyOfferUnknown();

/// Error raised when attempting to update a BuyOffer from an address which is neither the owner nor the optionally configured manager
error ErrorBuyOfferInvalidCallerForUpdate();

/// Error raised when an operation that can only be performed by the buy offer owner is called from another address
error ErrorBuyOfferNotOwner();

/// Error raised when decreasing the maximum amount of a Buy Offer and the delta amount could not be sent back to the offer owner
error ErrorBuyOfferUnableToSendAmountDelta();

error ErrorKeyAlreadyUsed();

/// Error raised when the price specified in a take call is below the offer's fixed price
/// @param price the offer's fixed price
/// @param minprice the lower acceptable price specified by the taker
error ErrorBuyOfferPriceTooLow(uint256 price, uint256 minprice);

/// Error raised when the amount of XMR specified in a take call is below the minimum amount the buy offer owner is willing to buy
/// @param amount the amount of XMR specified in the take call
/// @param minamount the minimum amount of XMR the buy offer owner is willing to acquire
error ErrorBuyOfferXMRAmountTooLow(uint256 amount, uint256 minamount);

/// Error raised when a take operation is funded by a FundingRequest but the amount specified for the take doesn't cover the funding fee
error ErrorBuyOfferAmountTooLowToCoverFundingFee();

/// Error raised when a take operation is attempted on an offer which is not in the OPEN state.
/// @param state the current state of the offer
error ErrorBuyOfferInvalidStateForTake(OfferState state);

/// Error raised when a ready operation is attempted on an offer which is not in the TAKEN state.
/// @param state the current state of the offer
error ErrorBuyOfferInvalidStateForReady(OfferState state);

/// Error raised when attempting to call ready on a Buy Offer after the t0 timestamp
error ErrorBuyOfferAfterT0();

/// Error raised when attempting to call claim on a Buy Offer after the t1 timestamp
error ErrorBuyOfferAfterT1();

/// Error raised when attempting to call refund on a Buy Offer in the ready state on or before the t1 timestamp
error ErrorBuyOfferNotAfterT1();

/// Error raised when attempting to call claimDeposit before t1 if the offer was not refunded
error ErrorBuyOfferNotAfterT1OrRefunded();

/// Error raised when attempting to call refund on a Buy Offer when the current timestamp is > t0 and <= t1
error ErrorBuyOfferBetweenT0AndT1();

/// Error raised when attempting to call claim on a Buy Offer when the current timestamp is not > t0 and <= t1
error ErrorBuyOfferNotBetweenT0AndT1();

/// Error raised when the address calling claim is not the taker of the offer
error ErrorBuyOfferNotTaker();

/// Error raised when attempting to call claim on an offer which is not in a state from which it can be claimed (TAKEN or READY)
/// @param state the current state of the offer
error ErrorBuyOfferInvalidStateForClaim(OfferState state);

/// Error raised when attempting to call claimDeposit on a buy offer not in the READY or TAKEN state
error ErrorBuyOfferInvalidStateForClaimDeposit();

/// Error raised when attempting to call refund on an offer which is not in a state compatible with a refund call (TAKEN or READY)
/// @param state the current state of the offer
error ErrorBuyOfferInvalidStateForRefund(OfferState state);

/// Error raised when calling claim with a private spend key whose associated public spend key is not that specified when taking the offer
error ErrorBuyOfferInvalidXMRPrivateSpendKey();

/// Error raised when calling refund with a private spend key whose associated public spend key is not that specified when creating the offer
error ErrorBuyOfferInvalidEVMPrivateSpendKey();

/// Error raised when calling refund with a private view key whose associated public veiew key is not that specified when creating the offer
error ErrorBuyOfferInvalidEVMPrivateViewKey();

/// Error raised when attempting to cancel a buy offer which is not in the OPEN state
/// @param state the current state of the offer
error ErrorBuyOfferInvalidStateForCancel(OfferState state);

/// Error raised when attempting to take a buy offer while an unused fundind request exists for the caller
error ErrorBuyOfferAvailableFundingRequest();

/// Error raised when deposit could not be sent back to the caller during a cancel or refund call
error ErrorBuyOfferUnableToRefund();

/// Error raised when attempting to reduce an offer's maxamount value while transfering value in the tx
error ErrorBuyOfferNoValueAllowedWhenReducingMaxamount();

/// This error occurs when attempting to create a buy offer when the offer book is already at the configured limit
/// @param size the configured offer book maximum size
error ErrorMaximumOfferBookSizeReached(uint256 size);

/// This error is raised when price is 0 and oracleRatio is also 0
error ErrorBuyOfferNoPriceDefined();

/// This error is raised when a taker attempts to take a BuyOffer without sending any value with the transaction and
/// there is no FundingRequest for the taker's address.
error ErrorBuyOfferNoFundingRequestFound();

/// Error raised when the account taking the offer is not the specified counterparty
error ErrorBuyOfferInvalidCounterparty();

/// Error raised when there was an error sending back to the buyer the difference between the settlement amount and its deposit
error ErrorBuyOfferUnableToPayBuyer();

/// Error raised when attempting to call claimDeposit on a buy offer whose taker was funded
error ErrorBuyOfferCannotClaimDepositOfFundedOffer();

/// Error raised when attempting to create or update a sell offer with an amount below the configured minimum (MINIMUM_SELL_OFFER)
/// @param minimum the current configured minimum sell offer amount
error ErrorSellOfferAmountBelowMinimum(uint256 minimum);

/// Error raised when attempting to create or update a sell offer with an amount above the configured maximum (MAXIMUM_SELL_OFFER)
/// That error is also raised when attempting to take a sell offer with an amont above the offer's maximum
/// @param maximum the current configured maxmimum sell offer amount
error ErrorSellOfferAmountAboveMaximum(uint256 maximum);

/// Error raised when the account attempting to update a sell offer is neither its owner nor its manager
error ErrorSellOfferInvalidCallerForUpdate();

/// Error raised when attempting to update a sell offer which is not in the OPEN state
/// @param state the current state of the offer
error ErrorSellOfferInvalidStateForUpdate(OfferState state);

/// Error raised when attempting to perform an operation only avaialble to the owner of a Sell Offer from an address which is not the owner
error ErrorSellOfferNotOwner();

/// Error raised when cancelSellOffer was called by an account which is not the funder of the request or if the
/// required delay (2 * (T0_DELAY + T1_DELAY) has not passed since the funding request was funded.
error ErrorSellOfferNotCancellableByCaller();

/// Error raised when attempting to refund a sell offer from an address which is not the counterparty which took the offer
error ErrorSellOfferNotCounterparty();

/// Error raised when attempting to update the deposit amount of a sell offer which was created using a funding request
error ErrorSellOfferImmutableDeposit();

/// Error raised when the specified offer id is not a sell offer
error ErrorSellOfferUnknown();

/// Error raised when creating or updating a sell offer without specifying a price
error ErrorSellOfferNoPriceDefined();

/// Error raised when the amount resulting from taking a sell offer is not sufficient to cover the fees promised
/// to the funder of the FundingRequest which was used to create the sell offer.
/// This can be raised during calls to createSellOffer, updateSellOffer and takeSellOffer
error ErrorSellOfferAmountTooLowToCoverFundingFee();

/// Error raised when creating a sell offer with a public spend key which has already been used.
/// This is a check to ensure private spend keys are not reused across offers as this could lead to stolen funds.
error ErrorSellOfferPublicSpendKeyAlreadyUsed();

/// Error raised when the price resulting from taking a sell offer is above the taker's specified maximum
/// @param price the resulting price
/// @param maxprice the upper price limit which was specified by the taker
error ErrorSellOfferPriceTooHigh(uint256 price, uint256 maxprice);

/// Error raised when the resulting amount of XMR being sold is below the minimum specified by the buyer
/// @param amount resulting amount of XMR being sold
/// @param minimum cpecified minimum amount the buyer wants to acquire
error ErrorSellOfferXMRAmountTooLow(uint256 amount, uint256 minimum);

/// Error raised when the XMR amount the taker is willing to buy is below the minimum set by the maker
/// @param amount amount of XMR the taker is agreeing to buy
/// @param minimum the minimum amount of XMR the maker is willing to sell
error ErrorSellOfferXMRAmountBelowOfferMinimum(uint256 amount, uint256 minimum);

/// Error raised when attempting to take an offer which is not in the OPEN state
/// @param state the current state of the offer
error ErrorSellOfferInvalidStateForTake(OfferState state);

/// Error raised when attempting to call ready on an offer which is not in the TAKEN state
/// @param state the current state of the offer
error ErrorSellOfferInvalidStateForReady(OfferState state);

/// Error raised when attempting to call ready on an offer after the t0 timestamp
error ErrorSellOfferAfterT0();

/// Error raised when the account attempting the call ready on an offer is not its taker
error ErrorSellOfferNotTaker();

/// Error raised when attempting to claim an offer after the t1 timestamp
error ErrorSellOfferAfterT1();

/// Error raised when attempting to refund an offer on or before timestamp t1
error ErrorSellOfferNotAfterT1();

/// This error is also raised when attempting to call claimDeposit before t1 or if the offer is not refunded
error ErrorSellOfferNotAfterT1OrRefunded();

/// Error raised when attempting to claim an offer on or before t0 or after t1
error ErrorSellOfferNotBetweenT0AndT1();

/// Error raised when attempting to refund an offer after t0 and on or before t1
error ErrorSellOfferBetweenT0AndT1();

/// Error raised when attempting to cancel an offer which is not in the OPEN state
/// @param state the current state of the offer
error ErrorSellOfferInvalidStateForCancel(OfferState state);

/// Error raised when attempting to claim an offer which is not in the TAKEN or READY state
/// @param state the current state of the offer
error ErrorSellOfferInvalidStateForClaim(OfferState state);

/// Error raised when attempting to call claimDeposit on a sell offer not in the READY or TAKEN state
error ErrorSellOfferInvalidStateForClaimDeposit();

/// Error raised when attempting to refund an offer which is neither in the TAKEN nor READY state
/// @param state the current state of the offer
error ErrorSellOfferInvalidStateForRefund(OfferState state);

/// Error raised when attempting to claim an offer with a private spend key which is not associated with the public spend key specified at offer creation time
error ErrorSellOfferInvalidXMRPrivateSpendKey();

/// Error raised when attempting to refund an offer with a private spend key which is not associated with the public spend key specified when taking the offer
error ErrorSellOfferInvalidEVMPrivateSpendKey();

/// Error raised when attempting to refund an offer with a private view key which is not associated with the public view key specified when taking the offer
error ErrorSellOfferInvalidEVMPrivateViewKey();

/// Error raised when attempting to create a sell offer with a non 0 deposit while having a currently unused funding request
error ErrorSellOfferAvailableFundingRequest();

/// Error raised during cancel or refund calls when a deposit cannot be sent back
error ErrorSellOfferUnableToRefund();

/// Error raised when attempting to claim an offer which has already been claimed
error ErrorSellOfferAlreadyClaimed();

/// Error raised when attempting to refund an offer which has already been refunded
error ErrorSellOfferAlreadyRefunded();

/// Error raised when taking an offer with a deposit above the required one and when the delta couldn't be sent back to the taker
error ErrorSellOfferUnableToSendAmountDelta();

/// Error raised when the account taking the offer is not the specified counterparty
error ErrorSellOfferInvalidCounterparty();

/// Error raised when there was an error sending back to the buyer the difference between the settlement amount and its deposit
error ErrorSellOfferUnableToPayBuyer();

/// Error raised when a call to refund is performed in the same block in which take was called.
/// This is a mechanism to avoid having EVM takers call take and immediately call refund which would
/// simply be a way of draining the offer book to annoy sellers.
error ErrorSellOfferCannotRefundInTakenBlock();

/// Error raised when attempting to call claimDeposit on a sell offer whose maker was funded
error ErrorSellOfferCannotClaimDepositOfFundedOffer();

/// Generic error raised when an offer is invalid (either non existent, or not associated with caller)
error ErrorInvalidOffer();

/// Generic error raised when an offer is not of an expected type, most likely because it doesn not exist and is therefore of type INVALID
error ErrorInvalidOfferType();

/// Error raised when the payment of the claimer was unsuccessful
error ErrorUnableToPayClaimer();

/// Error raised when an offer deposit could not be claimed
error ErrorUnableToClaimDeposit();

/// Error raised when the payment of the funder was unsuccessful during a call to claim
error ErrorUnableToRepayFunder();

/// Error raised when attempting to perform an operation which is only available to the contract's owner from an account which is not that owner
error ErrorNotOwner();

/// This error is raised when attempting to set T0 or T1 delay to a value lower than MINIMUM_DELAY
/// @param delay the specified delay
/// @param minimum the configured minimum
error ErrorDelayTooShort(uint256 delay, uint256 minimum);

/// Error thrown when receiving value > 0 in either receive or fallback.
error ErrorUnableToAcceptPayment();

/// Error raised when reentrancy is detected
error ErrorReentrancy();
