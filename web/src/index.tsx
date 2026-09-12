/* @refresh reload */
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { render } from 'solid-js/web'
import { WagmiProvider } from '@wagmi/solid'
import { App } from './App'
import { config } from './lib/wagmi'
import './styles/lofi.css'

/**
 * Provider order follows the official docs: WagmiProvider outermost, query
 * client inside it.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Chain and indexer reads are cheap to repeat and expensive to get wrong
      // when stale, so refetch on focus but do not hammer on every mount.
      retry: 1,
      refetchOnWindowFocus: true,
      staleTime: 10_000,
    },
  },
})

const root = document.getElementById('root')
if (!root) throw new Error('#root is missing from index.html')

render(
  () => (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </WagmiProvider>
  ),
  root,
)
