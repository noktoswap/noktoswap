import { readContract } from '@wagmi/core'
import { optimism } from 'viem/chains'
import type { Address } from 'viem'
import { config } from './wagmi'

/**
 * XMR per ETH from Chainlink, as the last fallback behind the book's own rate.
 *
 * ── why this exists at all ──────────────────────────────────────────────────
 *
 * The designer argued against an external feed here, and the argument is good:
 * what a maker competes with is the people already offering, not a spot price.
 * So the book's own figures come first — an exact offer's real numbers, then the
 * best near rate, then the book-wide median.
 *
 * This is the fourth rung, for the state the design treated as rare and which is
 * in fact where the Sepolia deployment sits today: an outright empty book. A dash
 * there tells a user nothing and gives someone about to post the first offer no
 * number to price against.
 *
 * ── why Optimism ────────────────────────────────────────────────────────────
 *
 * Chainlink's mainnet XMR/USD proxy (0xFA66458C…, still what `xmr-usd.data.eth`
 * resolves to) **reverts on every call** — decommissioned, consistent with XMR
 * being delisted from most venues. The Optimism pair is live: verified on-chain,
 * 1200s heartbeat, 0.2% deviation threshold.
 *
 * So these reads go to Optimism regardless of which chain the wallet is on, which
 * is fine — nothing here touches a transaction, it only fills a readout.
 */

/** The slice of AggregatorV3Interface worth having. */
const aggregatorAbi = [
  {
    type: 'function',
    name: 'latestRoundData',
    inputs: [],
    outputs: [
      { name: 'roundId', type: 'uint80' },
      { name: 'answer', type: 'int256' },
      { name: 'startedAt', type: 'uint256' },
      { name: 'updatedAt', type: 'uint256' },
      { name: 'answeredInRound', type: 'uint80' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'decimals',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
    stateMutability: 'view',
  },
] as const

const FEED_CHAIN = optimism.id

const FEEDS = {
  xmrUsd: '0x2a8D91686A048E98e6CCF1A89E82f40D14312672' as Address,
  ethUsd: '0x13e3Ee699D1909E989722E753853AE30b17e08c5' as Address,
} as const

/**
 * XMR/USD publishes on a 1200s heartbeat. Two hours is generous enough to ride
 * out a slow round or a paused sequencer, and short enough that a genuinely dead
 * feed is reported as dead rather than quoted.
 *
 * This is also what stands in for Chainlink's L2 sequencer-uptime check: a
 * stalled sequencer shows up as a stale `updatedAt`, and the only consequence
 * here is a readout, never a transaction.
 */
export const MAX_AGE_SECONDS = 2 * 3600

export type OracleRate = {
  /** XMR per ETH. */
  rate: number
  ethUsd: number
  xmrUsd: number
  /** Unix seconds — the older of the two rounds. */
  updatedAt: number
}

/**
 * Whether a quote has gone stale, derived rather than stored.
 *
 * It used to be a boolean computed inside the fetch, which froze it: a page left
 * open for hours kept reporting a fresh feed because nothing recomputed it. Age
 * is a function of the clock, so it belongs with the clock — the caller passes
 * `now` and gets an answer that is true when it is read.
 */
export const isStale = (quote: OracleRate, nowSeconds: number): boolean =>
  nowSeconds - quote.updatedAt > MAX_AGE_SECONDS

type Round = { answer: bigint; updatedAt: bigint; decimals: number }

const readFeed = async (address: Address): Promise<Round> => {
  const [round, decimals] = await Promise.all([
    readContract(config, {
      abi: aggregatorAbi,
      address,
      functionName: 'latestRoundData',
      chainId: FEED_CHAIN,
    }),
    readContract(config, {
      abi: aggregatorAbi,
      address,
      functionName: 'decimals',
      chainId: FEED_CHAIN,
    }),
  ])
  // Read decimals rather than assume 8 — Chainlink can replace the aggregator
  // behind a proxy, and feeds do not all agree on scale.
  return { answer: round[1], updatedAt: round[3], decimals }
}

const toNumber = (round: Round): number => Number(round.answer) / 10 ** round.decimals

export const fetchXmrPerEth = async (): Promise<OracleRate> => {
  const [xmr, eth] = await Promise.all([readFeed(FEEDS.xmrUsd), readFeed(FEEDS.ethUsd)])

  const xmrUsd = toNumber(xmr)
  const ethUsd = toNumber(eth)
  if (!(xmrUsd > 0) || !(ethUsd > 0)) {
    throw new Error('Chainlink returned a non-positive price')
  }

  const updatedAt = Number(xmr.updatedAt < eth.updatedAt ? xmr.updatedAt : eth.updatedAt)

  return {
    // One ETH buys ethUsd dollars; one XMR costs xmrUsd. Hence the ratio.
    rate: ethUsd / xmrUsd,
    ethUsd,
    xmrUsd,
    updatedAt,
  }
}

export const FEED_NETWORK_LABEL = 'Optimism'
