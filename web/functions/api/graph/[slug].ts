import { proxyGraph, type Env } from '../../_shared'

/**
 * `/api/graph/<slug>` — one subgraph per chain.
 *
 * A manifest targets exactly one network, so three indexed chains are three
 * query URLs. Only the slug varies, and it comes from the client's own chain
 * registry, so this is a substitution rather than a mapping that can drift.
 */
export const onRequest: PagesFunction<Env, 'slug'> = ({ request, env, params }) =>
  proxyGraph(request, env, String(params.slug))
