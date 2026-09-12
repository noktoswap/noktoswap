import { proxyUniswap, type Env } from '../../_shared'

/** `/api/uniswap/*` — the Uniswap Trading API. */
export const onRequest: PagesFunction<Env, 'path'> = ({ request, env, params }) => {
  const path = Array.isArray(params.path) ? params.path.join('/') : String(params.path ?? '')
  return proxyUniswap(request, env, path)
}
