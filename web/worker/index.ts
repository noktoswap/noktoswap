import { proxyGraph, proxyToken, proxyUniswap, type Env } from './shared'

/**
 * The deployed counterpart to `vite.config.ts`'s dev proxy.
 *
 * Cloudflare consolidated Pages into Workers — "if you are starting a new
 * project, use Workers instead of Pages" — and the two have different contracts
 * here. Pages compiles a `functions/` directory into file-based routes; Workers
 * takes one entry script, so the three route files collapsed into the router
 * below. Cloudflare's own migration guide offers `wrangler pages functions build`
 * to compile the old layout instead, but the logic in `shared.ts` was already
 * plain functions of `(request, env, path)`, so routing them directly is fewer
 * moving parts than keeping a Pages-era build step alive.
 *
 * `_routes.json` has no Workers equivalent; `run_worker_first` in
 * `wrangler.jsonc` does that job, and it is what keeps this Worker off the static
 * paths — every asset request is served by the asset worker without waking this
 * one. The SPA fallback that Pages did implicitly is `not_found_handling` there
 * too.
 *
 * Whatever changes here changes in `vite.config.ts` as well. A drift means the
 * app works in development and 404s in production, which is the failure this
 * file exists to prevent.
 */

type WorkerEnv = Env

export default {
  fetch(request: Request, env: WorkerEnv): Promise<Response> | Response {
    const { pathname } = new URL(request.url)

    // One subgraph per chain: a manifest targets exactly one network, so three
    // indexed chains are three query URLs differing only in the slug. The slug
    // comes from the client's own chain registry, making this a substitution
    // rather than a mapping that can drift out of step with it.
    const graph = /^\/api\/graph\/([^/]+)\/?$/.exec(pathname)
    if (graph) return proxyGraph(request, env, graph[1] as string)

    // The Graph Token API, for wallet token discovery.
    const token = /^\/api\/token\/(.*)$/.exec(pathname)
    if (token) return proxyToken(request, env, token[1] as string)

    // The Uniswap Trading API.
    const uniswap = /^\/api\/uniswap\/(.*)$/.exec(pathname)
    if (uniswap) return proxyUniswap(request, env, uniswap[1] as string)

    /*
     * Unreachable in production, and deliberately not a fallback to the asset
     * worker: `run_worker_first` routes only `/api/*` here, so anything landing
     * on this line is a path under `/api/` that no proxy claims. Serving the app
     * shell for it would answer a bad API call with HTML, which reads to a fetch
     * caller as a parse error rather than a missing route.
     */
    return new Response(JSON.stringify({ errors: [{ message: `no proxy for ${pathname}` }] }), {
      status: 404,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    })
  },
}
