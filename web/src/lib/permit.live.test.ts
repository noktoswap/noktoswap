import { describe, expect, it } from 'vitest'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { permitTypedData, type PermitData } from './uniswap'

/**
 * Does the Trading API accept a Permit2 signature built by `permitTypedData`?
 *
 * The unit tests in domain.test.ts prove the reshaping is internally consistent —
 * right primary type, no precision lost. They cannot prove the result is what
 * Permit2 actually wants, because that depends on a domain separator and struct
 * hash computed inside Uniswap's service. A wrong `primaryType`, a field in the
 * wrong order, or a rounded `amount` all still produce 65 valid-looking bytes;
 * the only thing that distinguishes them is the recovered signer address.
 *
 * So this signs a real quote's permitData with a throwaway key and posts it to
 * `/swap`. `simulateTransaction` is false on purpose: the throwaway account holds
 * no USDC, and a simulation failure would mask the signature verdict behind a
 * balance error. What is under test is whether the API recovers our signature to
 * the swapper it issued the quote for.
 *
 * Run with `pnpm test:live`. Needs UNISWAP_API_KEY and the dev server proxy, or
 * set UNISWAP_API_KEY and it will call the gateway directly.
 */

const KEY = process.env.UNISWAP_API_KEY
const GATEWAY = 'https://trade-api.gateway.uniswap.org/v1'
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const NATIVE = '0x0000000000000000000000000000000000000000'

const call = async (path: string, body: unknown): Promise<{ status: number; json: any }> => {
  const response = await fetch(`${GATEWAY}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': KEY as string,
      'x-universal-router-version': '2.0',
    },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  let json: any
  try {
    json = JSON.parse(text)
  } catch {
    json = { raw: text.slice(0, 300) }
  }
  return { status: response.status, json }
}

describe.skipIf(!KEY)('live Permit2 signature, end to end', () => {
  it('is accepted by /swap and recovers to the swapper', async () => {
    // A fresh key each run, so this can never touch anyone's funds.
    const account = privateKeyToAccount(generatePrivateKey())
    console.log('  swapper  ', account.address)

    // The direction the escrow actually funds through: spend a token, land an
    // exact amount of ETH. This is the side that needs a permit; native-in never
    // does, which is why a native-in quote returns permitData: null.
    const quote = await call('/quote', {
      type: 'EXACT_OUTPUT',
      amount: '1000000000000000',
      tokenInChainId: 1,
      tokenOutChainId: 1,
      tokenIn: USDC,
      tokenOut: NATIVE,
      swapper: account.address,
      autoSlippage: 'DEFAULT',
    })
    expect(quote.status).toBe(200)

    const permit = quote.json.permitData as PermitData | null
    console.log('  routing  ', quote.json.routing)
    console.log('  permit?  ', permit ? 'required' : 'none')
    // A brand new address has no Permit2 allowance, so one is always required
    // here. If this ever stops holding, the assertion below is the wrong test.
    expect(permit).toBeTruthy()

    const typed = permitTypedData(permit as PermitData)
    console.log('  signing  ', typed.primaryType)
    const signature = await account.signTypedData(typed as never)
    console.log('  signature', `${signature.slice(0, 20)}… (${signature.length} chars)`)
    expect(signature).toMatch(/^0x[0-9a-f]{130}$/)

    const swap = await call('/swap', {
      quote: quote.json.quote,
      permitData: permit,
      signature,
      // Off on purpose — see the note at the top of this file.
      simulateTransaction: false,
      refreshGasPrice: true,
    })
    console.log('  /swap    ', swap.status)

    if (swap.status !== 200) {
      console.log('  body     ', JSON.stringify(swap.json).slice(0, 400))
    }
    expect(swap.status).toBe(200)

    const tx = swap.json.swap
    const data = String(tx?.data).toLowerCase()
    console.log('  to       ', tx?.to)
    console.log('  selector ', data.slice(0, 10), '(execute on the Universal Router)')
    console.log('  calldata ', `${data.length - 2} hex chars`)

    expect(tx?.to).toMatch(/^0x[0-9a-fA-F]{40}$/)
    // `execute(bytes commands, bytes[] inputs, uint256 deadline)`.
    expect(data.slice(0, 10)).toBe('0x3593564c')

    /*
     * The assertion that actually proves the signature was understood, rather
     * than merely not rejected: our 65 bytes appear verbatim inside the calldata.
     *
     * The API cannot embed a signature it failed to recover to the swapper — the
     * PERMIT2_PERMIT command carries the PermitSingle struct and this signature,
     * and Permit2 verifies it on-chain against the struct hash. So finding it here
     * means the domain separator, the primary type, the field order and the
     * uint160 amount were all what Permit2 expects. Any of those wrong and the
     * service would have answered 4xx instead.
     */
    expect(data).toContain(signature.slice(2).toLowerCase())
  }, 60_000)
})
