import { vi } from 'vitest'

/**
 * jsdom is missing a few things the app touches on mount. Stub them rather than
 * guard every call site — a component should not have to know it is under test.
 */

// viem's transports and the three API clients all reach for fetch. Nothing in a
// smoke test should hit the network, so fail loudly instead of hanging.
vi.stubGlobal(
  'fetch',
  vi.fn(() => Promise.reject(new Error('network disabled in tests'))),
)

// crypto.getRandomValues exists in jsdom, but not always crypto.randomUUID,
// which wagmi's storage uses.
if (!globalThis.crypto?.randomUUID) {
  Object.defineProperty(globalThis.crypto, 'randomUUID', {
    value: () => '00000000-0000-4000-8000-000000000000',
    configurable: true,
  })
}

// The token picker's chain chips and the phone/desktop split both read media
// queries; jsdom has no matchMedia.
vi.stubGlobal(
  'matchMedia',
  vi.fn((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
)
