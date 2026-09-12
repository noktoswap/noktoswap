import { defineConfig } from 'vitest/config'

/**
 * Separate from vite.config.ts on purpose.
 *
 * Everything under test is a pure module — matching, order timing, formatting,
 * key encoding — so the suite needs neither a DOM nor the Solid plugin. Keeping
 * it out of the app config means the tests do not quietly depend on the dev
 * server's proxy setup either.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // *.live.test.ts reaches the network on purpose (Chainlink feeds). Kept out
    // of the default run so the suite stays offline and deterministic; run it
    // with `pnpm test:live` when checking a feed is still publishing.
    exclude: ['src/**/*.live.test.ts', 'node_modules/**'],
  },
})
