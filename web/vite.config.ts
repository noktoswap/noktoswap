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

  /**
   * One subgraph per chain, so one route per slug: `/api/graph/<slug>`.
   *
   * A subgraph targets exactly one network — every data source in a manifest must
   * share it — so indexing three chains means three deployments and three query
   * URLs. The slug is the only thing that varies, and it comes from the client's
   * own chain registry, so this rewrite is a substitution rather than a mapping
   * that could drift out of sync with it.
   */
  const studioBase = new URL(
    env.GRAPH_STUDIO_BASE ?? 'https://api.studio.thegraph.com/query/5944',
  )
  /** Slugs are `[a-z0-9-]`; anything else is not ours to forward. */
  const SLUG = /^[a-z0-9-]{1,64}$/

  return {
    plugins: [solid()],
    server: {
      port: 5173,
      proxy: {
        '/api/graph': {
          ...upstream(studioBase.origin, {
            Authorization: env.GRAPH_API_KEY && `Bearer ${env.GRAPH_API_KEY}`,
          }),
          rewrite: (path) => {
            const slug = path.replace(/^\/api\/graph\/?/, '').split(/[/?]/)[0] ?? ''
            if (!SLUG.test(slug)) {
              // Refuse rather than forward something shaped like a path traversal
              // with the API key attached.
              throw new Error(`refusing to proxy an unrecognised subgraph slug: ${slug}`)
            }
            return `${studioBase.pathname}/${slug}/version/latest`
          },
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
