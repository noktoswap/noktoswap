import { proxyToken, type Env } from '../../_shared'

/** `/api/token/*` — the Graph Token API, for wallet token discovery. */
export const onRequest: PagesFunction<Env, 'path'> = ({ request, env, params }) => {
  const path = Array.isArray(params.path) ? params.path.join('/') : String(params.path ?? '')
  return proxyToken(request, env, path)
}
