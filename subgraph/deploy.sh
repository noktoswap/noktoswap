#!/usr/bin/env bash
#
# Deploy one subgraph per chain.
#
# A subgraph targets exactly one network — every data source in a manifest must
# share it — so three deployments are not a convenience, they are the only way to
# index three chains.
#
# `graph build --network` rewrites subgraph.yaml in place from networks.json, so
# this restores the file afterwards to keep the working tree clean. Losing that
# restore means committing whichever network happened to be built last.
set -euo pipefail
cd "$(dirname "$0")"

[ -f .env ] && set -a && . ./.env && set +a
: "${GRAPH_DEPLOY_KEY:?set GRAPH_DEPLOY_KEY in subgraph/.env}"

VERSION="${VERSION:-v0.1.0}"

# network → Studio slug
declare -a TARGETS=(
  "sepolia:xmrp-2-p"
  "mainnet:noktoswap-mainnet"
  "base:noktoswap-base"
)

restore() { git checkout -- subgraph.yaml 2>/dev/null || true; }
trap restore EXIT

pnpm exec graph auth "$GRAPH_DEPLOY_KEY"

for target in "${TARGETS[@]}"; do
  network="${target%%:*}"
  slug="${target##*:}"
  echo
  echo "── $network → $slug @ $VERSION"
  pnpm exec graph codegen
  pnpm exec graph build --network "$network"
  pnpm exec graph deploy "$slug" --version-label "$VERSION"
done
