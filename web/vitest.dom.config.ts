import { defineConfig } from 'vitest/config'
import solid from 'vite-plugin-solid'

/**
 * The DOM half of the suite: mounts real components under jsdom.
 *
 * Split from vitest.config.ts because Solid ships separate browser and server
 * builds, and a single config cannot resolve both — the `solid` export condition
 * has to be pinned to the client build for `render` to work at all. The pure
 * domain tests want neither this plugin nor a DOM, so they keep their own config.
 */
export default defineConfig({
  plugins: [solid()],
  resolve: { conditions: ['development', 'browser'] },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.dom.test.tsx'],
    setupFiles: ['./src/test-setup.ts'],
  },
})
