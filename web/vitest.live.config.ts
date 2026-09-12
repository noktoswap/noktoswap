import { defineConfig } from 'vitest/config'

/**
 * The tests that deliberately reach the network: Chainlink feeds and on-chain
 * balance reads. Kept out of the default run so `pnpm test` stays offline and
 * deterministic; run with `pnpm test:live` before a demo to confirm the feeds
 * are still publishing and the RPCs still answer.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.live.test.ts'],
    testTimeout: 60_000,
  },
})
