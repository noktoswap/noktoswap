/**
 * Noktoswap market ABI — the subset the app actually calls, plus every custom
 * error so a revert can be decoded into something a user can read.
 *
 * Generated from `contracts/out` via `subgraph/abis/XMRP2P.json`; regenerate
 * with `pnpm run abi` in `subgraph/` if the contract changes.
 */
export const noktoswapAbi = [
  {
    "type": "function",
    "name": "cancel",
    "inputs": [
      {
        "name": "offerId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "claim",
    "inputs": [
      {
        "name": "offerId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "privateSpendKey",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "liability",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "listOffers",
    "inputs": [
      {
        "name": "offset",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "count",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "reverse",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple[]",
        "internalType": "struct NoktoSwap.Offer[]",
        "components": [
          {
            "name": "id",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "kind",
            "type": "uint8",
            "internalType": "enum OfferType"
          },
          {
            "name": "state",
            "type": "uint8",
            "internalType": "enum OfferState"
          },
          {
            "name": "owner",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "counterparty",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "amount",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "deposit",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "xmrAmount",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "lastupdate",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "blockTaken",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "evmPublicSpendKey",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "evmPrivateSpendKey",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "evmPublicViewKey",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "evmPrivateViewKey",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "xmrPublicSpendKey",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "xmrPrivateSpendKey",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "xmrPrivateViewKey",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "t0",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "t1",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "nextOfferId",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "offers",
    "inputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "id",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "kind",
        "type": "uint8",
        "internalType": "enum OfferType"
      },
      {
        "name": "state",
        "type": "uint8",
        "internalType": "enum OfferState"
      },
      {
        "name": "owner",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "counterparty",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "deposit",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "xmrAmount",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "lastupdate",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "blockTaken",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "evmPublicSpendKey",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "evmPrivateSpendKey",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "evmPublicViewKey",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "evmPrivateViewKey",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "xmrPublicSpendKey",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "xmrPrivateSpendKey",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "xmrPrivateViewKey",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "t0",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "t1",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "openOffer",
    "inputs": [
      {
        "name": "offerType",
        "type": "uint8",
        "internalType": "enum OfferType"
      },
      {
        "name": "xmrAmount",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "counterparty",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "spendingKey",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "viewingKey",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "offer",
        "type": "tuple",
        "internalType": "struct NoktoSwap.Offer",
        "components": [
          {
            "name": "id",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "kind",
            "type": "uint8",
            "internalType": "enum OfferType"
          },
          {
            "name": "state",
            "type": "uint8",
            "internalType": "enum OfferState"
          },
          {
            "name": "owner",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "counterparty",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "amount",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "deposit",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "xmrAmount",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "lastupdate",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "blockTaken",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "evmPublicSpendKey",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "evmPrivateSpendKey",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "evmPublicViewKey",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "evmPrivateViewKey",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "xmrPublicSpendKey",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "xmrPrivateSpendKey",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "xmrPrivateViewKey",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "t0",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "t1",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      }
    ],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "openOfferCount",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "parameters",
    "inputs": [],
    "outputs": [
      {
        "name": "MINIMUM_OFFER",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "MAXIMUM_OFFER",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "DEPOSIT_RATIO",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "MAXIMUM_OFFER_BOOK_SIZE",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "T0_DELAY",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "T1_DELAY",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "quit",
    "inputs": [
      {
        "name": "offerId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "spendingKey",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "viewingKey",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "ready",
    "inputs": [
      {
        "name": "offerId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "take",
    "inputs": [
      {
        "name": "offerId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "spendingKey",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "viewingKey",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "withdraw",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "withdrawable",
    "inputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "event",
    "name": "OfferEvent",
    "inputs": [
      {
        "name": "offer_id",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "kind",
        "type": "uint8",
        "indexed": true,
        "internalType": "enum OfferType"
      },
      {
        "name": "state",
        "type": "uint8",
        "indexed": true,
        "internalType": "enum OfferState"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ParametersUpdated",
    "inputs": [
      {
        "name": "parameters",
        "type": "tuple",
        "indexed": false,
        "internalType": "struct NoktoSwap.Parameters",
        "components": [
          {
            "name": "MINIMUM_OFFER",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "MAXIMUM_OFFER",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "DEPOSIT_RATIO",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "MAXIMUM_OFFER_BOOK_SIZE",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "T0_DELAY",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "T1_DELAY",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "PayoutCredited",
    "inputs": [
      {
        "name": "to",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Withdrawal",
    "inputs": [
      {
        "name": "to",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "AlreadyInitialized",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ErrorBuyOfferInvalidEVMPrivateSpendKey",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ErrorClaimUnavailable",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ErrorInvalidAmount",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ErrorInvalidEVMPrivateViewKey",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ErrorInvalidOfferAmount",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ErrorInvalidOfferStateForQuit",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ErrorInvalidOfferType",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ErrorInvalidPrivateSpendKey",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ErrorKeyAlreadyUsed",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ErrorMaximumOfferBookSizeReached",
    "inputs": [
      {
        "name": "size",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "ErrorNonMember",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ErrorOfferAfterT0",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ErrorOfferNotOpen",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ErrorOfferNotReadyOrTaken",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ErrorOfferNotTaken",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ErrorParametersInvalid",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ErrorReentrancy",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ErrorSellOfferCannotQuitInTakenBlock",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ErrorUnableToAcceptPayment",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ErrorUnableToRefund",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidScalar",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NewOwnerIsZeroAddress",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NoHandoverRequest",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NonCanonicalPoint",
    "inputs": []
  },
  {
    "type": "error",
    "name": "Unauthorized",
    "inputs": []
  }
] as const
