import type { JSX } from 'solid-js'
import { Footer, Nav } from '../components/Nav'
import { SwapWidget } from '../components/SwapWidget'
import { WaitingOnYou } from '../components/WaitingOnYou'
import { useApp } from '../state/app'

/**
 * The front door. No heading — two amounts and a button say what this is.
 *
 * All three of the wireframe's landing states (exact / near only / nothing this
 * size) are this one screen: the readout updates as you type, and there is no
 * search to submit that could fail. The state machine lives in SwapWidget.
 */
export const Find = (): JSX.Element => {
  const app = useApp()
  return (
    <div class="page">
      <Nav />
      <WaitingOnYou />
      <SwapWidget />
      <Footer chainId={app.actionChainId()} />
    </div>
  )
}
