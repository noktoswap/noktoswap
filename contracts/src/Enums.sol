// SPDX-License-Identifier: MIT
//
// Copyright (c) 2025-2026  v1rtl
//

pragma solidity ^0.8.34;

enum OfferType {
    INVALID, // Used so the default value 0 is invalid
    BUY,
    SELL
}

enum OfferState {
    INVALID, // Used so the default value 0 is invalid
    OPEN, // Open offers are those still seeking a counterparty
    TAKEN, // Taken offers are those with both a buyer and a seller
    CANCELLED, // Cancelled offers are those no longer valid
    REFUNDED, // Refunded offers are those for which the buyer requested a refund
    READY, // Ready offers are those for which the Monero deposit was confirmed by the buyer
    CLAIMED // Claimed offers are those whose Monero seller has claimed the amount of EVM currency paid for its XMR
}
