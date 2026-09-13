import { defineConfig } from 'vitest/config'

/** Offline and deterministic: no RPC, no wallet, no network. */
export default defineConfig({
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
})
