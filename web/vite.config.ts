import { defineConfig, loadEnv, type ProxyOptions } from 'vite'
import solid from 'vite-plugin-solid'

/**
 * Three upstreams, all of them key-bearing, none of them CORS-open to a browser.
 *
 * The keys stay on this side of the wire: the dev server attaches them, so the
 * bundle never sees one and a leaked `dist/` leaks nothing. Deploying means
 * standing up the same three rewrites as edge functions — see web/README.md.
 */
const upstream = (target: string, headers: Record<string, string | undefined>): ProxyOptions => ({
  target,
  changeOrigin: true,
  secure: true,
  headers: Object.fromEntries(
    Object.entries(headers).filter((e): e is [string, string] => Boolean(e[1])),
  ),
})

export default defineConfig(({ mode }) => {
  // '' prefix: these are server-side secrets, deliberately not VITE_-prefixed,
  // because anything VITE_ gets inlined into the client bundle.
  const env = loadEnv(mode, process.cwd(), '')

  // The Studio query URL carries the subgraph path, but a proxy target's own
  // path gets prepended to the rewritten one — so split it and use only the
  // origin as the target.
  const graphUrl = new URL(
    env.GRAPH_QUERY_URL ?? 'https://api.studio.thegraph.com/query/5944/xmrp-2-p/version/latest',
  )

  return {
    plugins: [solid()],
    server: {
      port: 5173,
      proxy: {
        '/api/graph': {
          ...upstream(graphUrl.origin, {
            Authorization: env.GRAPH_API_KEY && `Bearer ${env.GRAPH_API_KEY}`,
          }),
          rewrite: () => graphUrl.pathname,
        },
        '/api/token': {
          // token-api.thegraph.com no longer resolves; the service moved to Pinax.
          ...upstream('https://api.pinax.network', {
            Authorization: env.TOKEN_API_JWT && `Bearer ${env.TOKEN_API_JWT}`,
            Accept: 'application/json',
          }),
          rewrite: (p) => p.replace(/^\/api\/token/, ''),
        },
        '/api/uniswap': {
          ...upstream('https://trade-api.gateway.uniswap.org', {
            'x-api-key': env.UNISWAP_API_KEY,
            'x-universal-router-version': '2.0',
          }),
          rewrite: (p) => p.replace(/^\/api\/uniswap/, '/v1'),
        },
      },
    },
    build: { target: 'es2022' },
  }
})
