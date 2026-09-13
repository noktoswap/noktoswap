#!/usr/bin/env -S npx tsx
import { formatEther } from 'viem'
import { generateCanonicalKeypair } from '../../web/src/lib/keys'
import { realmOf } from '../../web/src/lib/chains'
import { Chain, valueToOpen, valueToTake, sideOf, type OnChainOffer } from './chain'
import { ConfigError, parseFlags, resolveConfig, type Config } from './config'
import { decide, describe, escrowAddressFor, keysForOpen, keysForTake, perform, type Position } from './engine'
import { Keystore } from './keystore'
import { ManualMonero } from './monero/manual'
import { WalletRpc } from './monero/walletRpc'
import { formatXmr, type MoneroBackend } from './monero/backend'
import { alreadyQuoted, describeQuote, midFromBook, plan, type Inventory } from './strategy'

/**
 * Market-making CLI for the Noktoswap offer book.
 *
 * The protocol is a two-sided atomic swap with per-side deadlines, which makes the
 * interesting part of a market maker not the pricing but the *servicing*: an offer
 * that gets taken commits the bot to a sequence of actions with a clock on each,
 * and missing one converts a profitable trade into a refund at best. So the shape
 * here is a loop that reads state from the chain, decides one action per position,
 * and does it — rather than anything resembling an order router.
 *
 * Read `engine.ts` for the state machine and `strategy.ts` for the quoting. This
 * file is argument handling and output.
 */

const HELP = `noktoswap-bot — market making for the ETH/XMR offer book

  status                    balances, market parameters, and every live position
  book                      the open book as the contract reports it
  quote                     what the strategy would post right now, and why
  make                      post quotes, then service positions, once
  run                       the same, on a loop
  service                   service existing positions only, no new quotes
  take <id>                 take one offer by id
  cancel <id>               cancel one of your own open offers
  escrow <id>               print an offer's escrow address and keys
  keys                      list stored keypairs
  backup                    print every mnemonic, for writing down

Safety, because this program spends money unattended:

  --dry-run                 simulate every write, send nothing  [default]
  --live                    actually send transactions
  --max-offer-eth <eth>     cap per offer   (required with --live)
  --max-total-eth <eth>     cap on total exposure (required with --live)

Market:

  --testnet                 Sepolia instead of the default, which is mainnet
  --chain <id>              any deployed chain by id; default 1 (Ethereum)
  --spread <fraction>       0.02 = quote ±2% around mid  [default 0.02]
  --depth <n>               offers per side  [default 2]
  --mid <rate>              XMR per ETH; overrides the book median
  --interval <seconds>      loop delay for \`run\`  [default 60]
  --payout <address>        Monero address to sweep won escrows to

Monero:

  --monero-rpc <url>        monero-wallet-rpc, e.g. http://127.0.0.1:18082
                            without it the bot runs EVM-side only

Environment (never flags — argv is visible in \`ps\`):

  BOT_PRIVATE_KEY           the bot's EVM key, 32 bytes hex
  BOT_RPC_<chainId>         RPC override for that chain
  MONERO_WALLET_RPC         same as --monero-rpc
  MONERO_RPC_USER / MONERO_RPC_PASSWORD
  BOT_KEYSTORE              default .noktoswap-bot/keys
`

const out = (line = '') => process.stdout.write(`${line}\n`)

const backendFor = (config: Config): MoneroBackend =>
  config.monero.kind === 'wallet-rpc'
    ? new WalletRpc({
        url: config.monero.url,
        ...(config.monero.username ? { username: config.monero.username } : {}),
        ...(config.monero.password ? { password: config.monero.password } : {}),
      })
    : new ManualMonero()

/** Chain time, not wall time — every deadline in the contract is block.timestamp. */
const chainNow = async (chain: Chain): Promise<bigint> => {
  const block = await chain.reader.getBlock()
  return block.timestamp
}

/**
 * Every offer this bot is party to, with the next action for each.
 *
 * Read from the contract rather than the subgraph: the indexer lags by design and
 * these are deadline decisions. The scan walks back from `nextOfferId` because a
 * market maker cares about recent offers, and the contract's own pagination is the
 * only listing available.
 */
const positions = async (
  config: Config,
  chain: Chain,
  keystore: Keystore,
  monero: MoneroBackend,
  scan = 200n,
): Promise<Position[]> => {
  const next = await chain.nextOfferId()
  const count = next > scan ? scan : next
  if (count === 0n) return []
  const offers = await chain.listOffers(next - count, count, true)
  const me = config.account.address
  const now = await chainNow(chain)
  const mainnet = config.chain.moneroMainnet

  const result: Position[] = []
  for (const offer of offers) {
    const side = sideOf(offer, me)
    if (!side) continue
    const ref = `${config.chain.chain.id}-${offer.id}`
    const stored = keystore.get(ref)
    const action = await decide({
      offer,
      me,
      now,
      mainnet,
      pair: stored?.pair ?? null,
      alreadySentXmr: Boolean(stored?.record.xmrSentTxid),
      alreadySwept: Boolean(stored?.record.sweptTxid),
      monero,
    })
    result.push({ offer, side, ref: stored ? ref : null, pair: stored?.pair ?? null, action })
  }
  return result
}

const inventoryFor = async (
  chain: Chain,
  monero: MoneroBackend,
  live: readonly Position[],
): Promise<Inventory> => {
  const [ethWei, xmr] = await Promise.all([chain.ethBalance(), monero.balance()])
  const committedWei = live
    .filter((p) => ['OPEN', 'TAKEN', 'READY'].includes(p.offer.state))
    .reduce(
      (sum, p) =>
        sum + (p.side === 'evm' ? p.offer.amount : p.offer.deposit),
      0n,
    )
  return { ethWei, xmrAtomic: xmr.unlocked, committedWei }
}

const midFor = async (
  flags: Map<string, string>,
  chain: Chain,
): Promise<{ mid: number; source: string } | null> => {
  const override = flags.get('mid')
  if (override) {
    const value = Number(override)
    if (!Number.isFinite(value) || value <= 0) throw new ConfigError('--mid must be a positive number')
    return { mid: value, source: '--mid' }
  }
  const next = await chain.nextOfferId()
  const count = next > 100n ? 100n : next
  const offers = count > 0n ? await chain.listOffers(next - count, count, true) : []
  const mid = midFromBook(offers)
  return mid === null ? null : { mid, source: `book median of ${offers.filter((o) => o.state === 'OPEN').length} open` }
}

// ── commands ───────────────────────────────────────────────────────────────

const cmdStatus = async (config: Config, chain: Chain, keystore: Keystore, monero: MoneroBackend) => {
  const parameters = await chain.parameters()
  const live = await positions(config, chain, keystore, monero)
  const inventory = await inventoryFor(chain, monero, live)

  out(`chain     ${config.chain.label} (${config.chain.chain.id}) · ${realmOf(config.chain.chain.id)}`)
  out(`contract  ${chain.contract}`)
  out(`account   ${config.account.address}`)
  out(`mode      ${config.mode}${config.mode === 'dry-run' ? ' — nothing will be sent' : ''}`)
  out(`monero    ${monero.name}`)
  out()
  out(`ETH       ${formatEther(inventory.ethWei)}`)
  out(`XMR       ${formatXmr(inventory.xmrAtomic)} unlocked`)
  out(`committed ${formatEther(inventory.committedWei)} ETH in live positions`)
  out(`caps      ${formatEther(config.maxOfferWei)} per offer, ${formatEther(config.maxTotalWei)} total`)
  out()
  out(`market    min ${formatEther(parameters.minimumOffer)} ETH, max ${formatEther(parameters.maximumOffer)} ETH`)
  out(`deposit   ${Number(parameters.depositRatio) / 100}% of the ETH leg`)
  out(`deadlines t0 +${parameters.t0Delay}s, t1 +${parameters.t1Delay}s`)
  out()
  if (live.length === 0) {
    out('no positions')
    return
  }
  out(`${live.length} position${live.length === 1 ? '' : 's'}:`)
  for (const position of live) {
    out(`  ${describe(position)}`)
    const why =
      'why' in position.action ? position.action.why : null
    if (why) out(`      ${why}`)
  }
}

const cmdBook = async (config: Config, chain: Chain) => {
  const next = await chain.nextOfferId()
  const count = next > 100n ? 100n : next
  const offers = count > 0n ? await chain.listOffers(next - count, count, true) : []
  const open = offers.filter((o) => o.state === 'OPEN')
  if (open.length === 0) {
    out('the book is empty')
    return
  }
  out(`${open.length} open offer${open.length === 1 ? '' : 's'} on ${config.chain.label}:`)
  for (const offer of open) {
    const rate = Number(offer.xmrAmount) / 1e12 / (Number(offer.amount) / 1e18)
    const mine = offer.owner.toLowerCase() === config.account.address.toLowerCase() ? ' (yours)' : ''
    out(
      `  #${offer.id} ${offer.kind.padEnd(4)} ${formatEther(offer.amount).padStart(10)} ETH / ` +
        `${formatXmr(offer.xmrAmount).padStart(10)} XMR  @ ${rate.toFixed(4)}${mine}`,
    )
  }
}

const cmdQuote = async (
  config: Config,
  chain: Chain,
  keystore: Keystore,
  monero: MoneroBackend,
  flags: Map<string, string>,
) => {
  const parameters = await chain.parameters()
  const live = await positions(config, chain, keystore, monero)
  const inventory = await inventoryFor(chain, monero, live)
  const mid = await midFor(flags, chain)

  if (!mid) {
    out('no mid price: the book has fewer than three open offers and no --mid was given.')
    out('A median over one or two offers is not a price. Pass --mid <XMR per ETH> to quote anyway.')
    return
  }
  out(`mid       ${mid.mid.toFixed(4)} XMR/ETH (${mid.source})`)
  out(`inventory ${formatEther(inventory.ethWei)} ETH, ${formatXmr(inventory.xmrAtomic)} XMR unlocked`)
  out()

  const quotes = plan({
    mid: mid.mid,
    spread: config.spread,
    depth: config.depth,
    maxOfferWei: config.maxOfferWei,
    maxTotalWei: config.maxTotalWei,
    parameters,
    inventory,
  })
  if (quotes.length === 0) {
    out('nothing quotable: inventory, caps or the contract bounds leave no room.')
    return
  }
  const mine = live.map((p) => p.offer)
  for (const quote of quotes) {
    const held = alreadyQuoted(quote, mine)
    out(`  ${held ? 'have' : 'post'}  ${describeQuote(quote)}`)
  }
}

/** Post quotes that are missing. Every offer gets a fresh keypair — see below. */
const postQuotes = async (
  config: Config,
  chain: Chain,
  keystore: Keystore,
  monero: MoneroBackend,
  flags: Map<string, string>,
) => {
  const parameters = await chain.parameters()
  const live = await positions(config, chain, keystore, monero)
  const inventory = await inventoryFor(chain, monero, live)
  const mid = await midFor(flags, chain)
  if (!mid) {
    out('! no mid price and no --mid; not quoting')
    return
  }

  const quotes = plan({
    mid: mid.mid,
    spread: config.spread,
    depth: config.depth,
    maxOfferWei: config.maxOfferWei,
    maxTotalWei: config.maxTotalWei,
    parameters,
    inventory,
  })
  const mine = live.map((p) => p.offer)

  for (const quote of quotes) {
    if (alreadyQuoted(quote, mine)) continue

    /*
     * A fresh keypair per offer, always. `_keySanity` in the contract records every
     * public key it has ever seen and reverts on a repeat, so reusing a pair does
     * not merely weaken the escrow — it makes the transaction fail. Generated
     * canonically because the contract also rejects non-canonical points.
     */
    const pair = generateCanonicalKeypair()
    const draft = `${config.chain.chain.id}-draft-${Date.now()}-${quote.kind}`
    keystore.put(draft, {
      mnemonic: pair.mnemonic,
      role: 'open',
      offerKind: quote.kind,
      chainId: config.chain.chain.id,
      offerId: null,
      createdAt: Date.now(),
    })

    const keys = keysForOpen(quote.kind, pair)
    const kindEnum = quote.kind === 'BUY' ? 1 : 2
    const value = valueToOpen(quote.kind, quote.ethAmount, parameters.depositRatio)
    const result = await chain.write(
      'openOffer',
      [kindEnum, quote.xmrAmount, '0x0000000000000000000000000000000000000000', keys.spendingKey, keys.viewingKey],
      value,
    )

    if (!result.hash) {
      out(`  skip  ${describeQuote(quote)}`)
      out(`        ${result.reason}`)
      continue
    }
    out(`  post  ${describeQuote(quote)}`)
    out(`        ${result.hash}`)

    /*
     * Read the new id from the receipt rather than waiting for the indexer, and
     * re-key the stored mnemonic onto it. Until this happens the keys are only
     * findable under a timestamp, which is recoverable but manual.
     */
    const receipt = await chain.waitFor(result.hash)
    const id = offerIdFromLogs(receipt.logs, chain.contract)
    if (id !== null) {
      keystore.claimId(draft, id, config.chain.chain.id)
      out(`        offer #${id}, keys stored as ${config.chain.chain.id}-${id}`)
    } else {
      out(`        ! could not read the offer id from the receipt; keys remain under ${draft}`)
    }
  }
}

/**
 * `OfferEvent(uint256 id, OfferType kind, OfferState state)` — id is the first
 * indexed topic. Read from the receipt because the subgraph lags and the id is
 * needed immediately to file the keys.
 */
const offerIdFromLogs = (
  logs: readonly { address: string; topics: readonly string[] }[],
  contract: string,
): bigint | null => {
  for (const log of logs) {
    if (log.address.toLowerCase() !== contract.toLowerCase()) continue
    const topic = log.topics[1]
    if (topic) return BigInt(topic)
  }
  return null
}

const servicePositions = async (
  config: Config,
  chain: Chain,
  keystore: Keystore,
  monero: MoneroBackend,
  flags: Map<string, string>,
) => {
  const live = await positions(config, chain, keystore, monero)
  const actionable = live.filter((p) => !['wait', 'done'].includes(p.action.kind))
  if (actionable.length === 0) {
    out(`  ${live.length} position${live.length === 1 ? '' : 's'}, nothing to do`)
    return
  }
  for (const position of actionable) {
    out(`  ${describe(position)}`)
    const said = await perform({
      position,
      chain,
      keystore,
      monero,
      payoutAddress: flags.get('payout') ?? null,
    })
    out(`        ${said}`)
  }
}

const cmdTake = async (
  config: Config,
  chain: Chain,
  keystore: Keystore,
  id: bigint,
) => {
  const offer = await chain.offer(id)
  if (offer.state !== 'OPEN') throw new ConfigError(`offer #${id} is ${offer.state}, not OPEN`)
  if (offer.owner.toLowerCase() === config.account.address.toLowerCase()) {
    throw new ConfigError('that is your own offer — the contract rejects taking it')
  }
  const value = valueToTake(offer)
  if (value > config.maxOfferWei) {
    throw new ConfigError(
      `taking #${id} stakes ${formatEther(value)} ETH, over the ${formatEther(config.maxOfferWei)} per-offer cap`,
    )
  }

  const pair = generateCanonicalKeypair()
  const draft = `${config.chain.chain.id}-draft-take-${id}`
  keystore.put(draft, {
    mnemonic: pair.mnemonic,
    role: 'take',
    offerKind: offer.kind === 'BUY' ? 'BUY' : 'SELL',
    chainId: config.chain.chain.id,
    offerId: id.toString(),
    createdAt: Date.now(),
  })
  // Under the real ref too, since the id is already known here.
  keystore.put(`${config.chain.chain.id}-${id}`, {
    mnemonic: pair.mnemonic,
    role: 'take',
    offerKind: offer.kind === 'BUY' ? 'BUY' : 'SELL',
    chainId: config.chain.chain.id,
    offerId: id.toString(),
    createdAt: Date.now(),
  })

  const keys = keysForTake(offer.kind === 'BUY' ? 'BUY' : 'SELL', pair)
  out(`taking #${id} ${offer.kind}: staking ${formatEther(value)} ETH`)
  out(`  you become the ${offer.kind === 'BUY' ? 'XMR' : 'EVM'} side`)
  const result = await chain.write('take', [id, keys.spendingKey, keys.viewingKey], value)
  out(result.hash ? `  sent ${result.hash}` : `  not sent: ${result.reason}`)
}

const cmdCancel = async (config: Config, chain: Chain, id: bigint) => {
  const offer = await chain.offer(id)
  if (offer.owner.toLowerCase() !== config.account.address.toLowerCase()) {
    throw new ConfigError(`#${id} is not yours to cancel`)
  }
  const result = await chain.write('cancel', [id])
  out(result.hash ? `cancelled #${id} — ${result.hash}` : `not sent: ${result.reason}`)
}

const cmdEscrow = async (config: Config, chain: Chain, keystore: Keystore, id: bigint) => {
  const offer = await chain.offer(id)
  const address = escrowAddressFor(offer, config.chain.moneroMainnet)
  out(`offer     #${id} ${offer.kind} ${offer.state}`)
  out(`amounts   ${formatEther(offer.amount)} ETH / ${formatXmr(offer.xmrAmount)} XMR`)
  out(`escrow    ${address ?? 'not derivable yet — both sides must have committed keys'}`)
  out(`network   ${config.chain.moneroMainnet ? 'Monero mainnet' : 'Monero stagenet'}`)
  const stored = keystore.get(`${config.chain.chain.id}-${id}`)
  if (!stored) {
    out('keys      none stored for this offer')
    return
  }
  const side = sideOf(offer, config.account.address)
  out(`side      ${side ?? 'not a party'}`)
  out('')
  out('Your half of the escrow — enough to spend it only once the other half is revealed:')
  out(`  private spend  ${stored.pair.privateSpend}`)
  out(`  private view   ${stored.pair.privateView}`)
  if (offer.xmrPrivateSpendKey !== 0n) {
    out('')
    out('The counterparty revealed its spend scalar, so the escrow is spendable now.')
    out('Import these into a Monero wallet (monero-wallet-cli: restore from keys):')
    const { combinePrivateKeys, toMoneroKeyHex } = await import('../../web/src/lib/monero')
    out(`  address        ${address}`)
    out(`  spend key      ${toMoneroKeyHex(combinePrivateKeys(stored.pair.privateSpend, offer.xmrPrivateSpendKey))}`)
    out(`  view key       ${toMoneroKeyHex(combinePrivateKeys(stored.pair.privateView, offer.xmrPrivateViewKey))}`)
  }
}

const cmdKeys = (keystore: Keystore) => {
  const stored = keystore.list()
  if (stored.length === 0) {
    out(`no keys in ${keystore.directory}`)
    return
  }
  out(`${stored.length} keypair${stored.length === 1 ? '' : 's'} in ${keystore.directory}:`)
  for (const { ref, record } of stored) {
    const marks = [
      record.xmrSentTxid ? 'xmr-sent' : null,
      record.sweptTxid ? 'swept' : null,
    ].filter(Boolean)
    out(`  ${ref.padEnd(26)} ${record.offerKind} ${record.role}${marks.length ? ` · ${marks.join(', ')}` : ''}`)
  }
  out()
  out('Mnemonics are not shown here. `backup` prints them.')
}

// ── entry ──────────────────────────────────────────────────────────────────

const main = async () => {
  const argv = process.argv.slice(2)
  const command = argv.find((a) => !a.startsWith('--')) ?? 'help'
  const flags = parseFlags(argv)

  if (command === 'help' || flags.has('help')) {
    out(HELP)
    return
  }

  const config = resolveConfig(flags)
  const chain = new Chain(config)
  const keystore = new Keystore(config.keystore)
  const monero = backendFor(config)

  const idArg = (): bigint => {
    const positional = argv.filter((a) => !a.startsWith('--'))
    const raw = positional[1]
    if (!raw) throw new ConfigError(`${command} needs an offer id`)
    return BigInt(raw)
  }

  switch (command) {
    case 'status':
      return cmdStatus(config, chain, keystore, monero)
    case 'book':
      return cmdBook(config, chain)
    case 'quote':
      return cmdQuote(config, chain, keystore, monero, flags)
    case 'make':
      out(`— quoting (${config.mode}) —`)
      await postQuotes(config, chain, keystore, monero, flags)
      out(`— servicing —`)
      return servicePositions(config, chain, keystore, monero, flags)
    case 'service':
      return servicePositions(config, chain, keystore, monero, flags)
    case 'run': {
      out(`running every ${config.interval}s in ${config.mode}. Ctrl-C to stop.`)
      let stop = false
      process.on('SIGINT', () => {
        out('\nstopping after this pass')
        stop = true
      })
      while (!stop) {
        const started = Date.now()
        out(`\n[${new Date().toISOString()}]`)
        try {
          await postQuotes(config, chain, keystore, monero, flags)
          await servicePositions(config, chain, keystore, monero, flags)
        } catch (cause) {
          // A pass that throws must not end the loop: the next one may be the
          // pass that services a deadline.
          out(`! pass failed: ${cause instanceof Error ? cause.message : String(cause)}`)
        }
        if (stop) break
        const elapsed = Date.now() - started
        const wait = Math.max(0, config.interval * 1000 - elapsed)
        await new Promise((resolve) => setTimeout(resolve, wait))
      }
      return
    }
    case 'take':
      return cmdTake(config, chain, keystore, idArg())
    case 'cancel':
      return cmdCancel(config, chain, idArg())
    case 'escrow':
      return cmdEscrow(config, chain, keystore, idArg())
    case 'keys':
      return cmdKeys(keystore)
    case 'backup': {
      const text = keystore.backup()
      out(text || 'nothing stored')
      return
    }
    default:
      out(`unknown command: ${command}\n`)
      out(HELP)
      process.exitCode = 1
  }
}

main().catch((cause) => {
  if (cause instanceof ConfigError) {
    process.stderr.write(`${cause.message}\n`)
    process.exitCode = 2
    return
  }
  process.stderr.write(`${cause instanceof Error ? cause.stack ?? cause.message : String(cause)}\n`)
  process.exitCode = 1
})

export type { Position, OnChainOffer }
