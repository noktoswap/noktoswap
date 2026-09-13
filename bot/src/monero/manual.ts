import {
  MoneroError,
  formatXmr,
  type MoneroBackend,
  type MoneroBalance,
  type WatchResult,
} from './backend'

/**
 * No wallet attached: print what a human would have to do, and refuse the rest.
 *
 * This exists so the bot is useful before a `monero-wallet-rpc` is running, and so
 * the EVM-side flow — which needs no XMR balance at all — can be exercised end to
 * end. It is deliberately not a stub that returns zeroes: a backend that silently
 * reports "nothing received" would make the bot skip `ready()` and let good trades
 * expire, and one that reported success would make it call `ready()` on an escrow
 * that was never funded, which hands away the ETH.
 *
 * So the unsafe operations throw with instructions. That is an honest limit rather
 * than a broken feature, and the throw is caught by the engine and surfaced as a
 * position needing attention.
 */
export class ManualMonero implements MoneroBackend {
  readonly name = 'manual (no wallet attached)'

  async height(): Promise<number | null> {
    return null
  }

  async balance(): Promise<MoneroBalance> {
    // Zero rather than a throw: the strategy asks for balance to decide whether it
    // may quote the XMR side, and "no spendable XMR" is the truthful answer.
    return { total: 0n, unlocked: 0n }
  }

  async send(address: string, atomic: bigint): Promise<string> {
    throw new MoneroError(
      [
        'no Monero wallet attached, so this payment has to be made by hand:',
        `    send ${formatXmr(atomic)} XMR to ${address}`,
        '  then rerun, and the bot will see the deposit once it can watch the address.',
        '  Attach a wallet with --monero-rpc http://127.0.0.1:18082 to automate it.',
      ].join('\n'),
    )
  }

  async watch(): Promise<WatchResult> {
    throw new MoneroError(
      [
        'cannot verify an escrow deposit without a wallet to scan with.',
        '  `ready()` asserts the XMR arrived, and calling it unverified gives the',
        '  counterparty a claim on the escrowed ETH. Refusing to guess.',
        '  Attach a wallet with --monero-rpc, or verify by hand and use `ready --force`.',
      ].join('\n'),
    )
  }

  async sweep(): Promise<string> {
    throw new MoneroError(
      [
        'the escrow is spendable but sweeping needs a wallet.',
        '  Run `noktoswap-bot escrow <chainId> <offerId>` to print the address and',
        '  both private keys, and import them into any Monero wallet to collect.',
      ].join('\n'),
    )
  }
}
