import type { JSX } from 'solid-js'
import { HOME_CHAIN } from '../lib/chains'
import { Footer, Nav } from '../components/Nav'
import { SwapWidget } from '../components/SwapWidget'
import { WaitingOnYou } from '../components/WaitingOnYou'

/**
 * The front door. No heading — two amounts and a button say what this is.
 *
 * All three of the wireframe's landing states (exact / near only / nothing this
 * size) are this one screen: the readout updates as you type, and there is no
 * search to submit that could fail. The state machine lives in SwapWidget.
 */
export const Find = (): JSX.Element => (
  <div class="page">
    <Nav />
    <WaitingOnYou />
    <SwapWidget />
    <Footer contract={HOME_CHAIN.deployment ?? undefined} explorer={HOME_CHAIN.explorer} />
  </div>
)
