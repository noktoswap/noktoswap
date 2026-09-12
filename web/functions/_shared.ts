/**
 * The dev server's proxy, as edge functions.
 *
 * `vite.config.ts` attaches three API credentials server-side so the browser
 * bundle never carries one. That property has to survive deployment or it was
 * never a property — a static build of this app has no `/api/*` at all, and
 * moving the keys into `VITE_` variables to compensate would inline them into
 * the bundle, which is the exact thing the proxy exists to prevent.
 *
 * So these mirror `vite.config.ts` route for route. If you change one, change
 * both — a drift means the app works in development and 404s in production.
 */

export type Env = {
  /** Subgraph Studio query key. Not the deploy key. */
  GRAPH_API_KEY?: string
  /** Base the Studio slug is appended to. */
  GRAPH_STUDIO_BASE?: string
  /** Graph Token API bearer, issued from a project key. */
  TOKEN_API_JWT?: string
  /** Uniswap Trading API key, sent as `x-api-key`. */
  UNISWAP_API_KEY?: string
}

const DEFAULT_STUDIO_BASE = 'https://api.studio.thegraph.com/query/5944'

/**
 * Forward a request upstream with credentials attached here rather than in the
 * browser.
 *
 * The response is returned as-is, including its status: a 401 from an upstream
 * with no key configured should read as a 401, not be dressed up as something
 * else. The client already renders per-source failures.
 */
const forward = async (
  request: Request,
  url: string,
  headers: Record<string, string | undefined>,
): Promise<Response> => {
  const outgoing = new Headers()
  // Carry only what the upstream needs. Notably not cookies or the browser's
  // own auth headers — nothing here should be able to forward a viewer's
  // credentials to a third party.
  const contentType = request.headers.get('content-type')
  if (contentType) outgoing.set('content-type', contentType)
  outgoing.set('accept', request.headers.get('accept') ?? 'application/json')
  for (const [key, value] of Object.entries(headers)) {
    if (value) outgoing.set(key, value)
  }

  const init: RequestInit = { method: request.method, headers: outgoing }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = await request.text()
  }

  const response = await fetch(url, init)
  // Rebuild rather than pass through, so no upstream `set-cookie` or CORS header
  // is echoed onto this origin.
  return new Response(response.body, {
    status: response.status,
    headers: {
      'content-type': response.headers.get('content-type') ?? 'application/json',
      'cache-control': 'no-store',
    },
  })
}

/** Studio slugs are `[a-z0-9-]`. Anything else is not ours to forward. */
const SLUG = /^[a-z0-9-]{1,64}$/

export const proxyGraph = (request: Request, env: Env, slug: string): Promise<Response> => {
  if (!SLUG.test(slug)) {
    // Refuse rather than forward something shaped like a path traversal with an
    // API key attached.
    return Promise.resolve(
      new Response(JSON.stringify({ errors: [{ message: `unrecognised subgraph slug` }] }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      }),
    )
  }
  const base = env.GRAPH_STUDIO_BASE ?? DEFAULT_STUDIO_BASE
  return forward(request, `${base}/${slug}/version/latest`, {
    authorization: env.GRAPH_API_KEY ? `Bearer ${env.GRAPH_API_KEY}` : undefined,
  })
}

export const proxyToken = (request: Request, env: Env, path: string): Promise<Response> => {
  const search = new URL(request.url).search
  // token-api.thegraph.com no longer resolves; the service moved to Pinax.
  return forward(request, `https://api.pinax.network/${path}${search}`, {
    authorization: env.TOKEN_API_JWT ? `Bearer ${env.TOKEN_API_JWT}` : undefined,
  })
}

export const proxyUniswap = (request: Request, env: Env, path: string): Promise<Response> => {
  const search = new URL(request.url).search
  return forward(request, `https://trade-api.gateway.uniswap.org/v1/${path}${search}`, {
    'x-api-key': env.UNISWAP_API_KEY,
    // Must stay consistent across quote → check_approval → swap. Set in one
    // place for exactly that reason.
    'x-universal-router-version': '2.0',
  })
}
