import { Route, Router } from '@solidjs/router'
import { Match, Switch, type JSX } from 'solid-js'
import { ChainPicker } from './components/ChainPicker'
import { ConnectWallet } from './components/ConnectWallet'
import { CreateOffer } from './components/CreateOffer'
import { OrderDialog } from './components/OrderDialog'
import { Settings } from './components/Settings'
import { SwapReview } from './components/SwapReview'
import { TokenPicker } from './components/TokenPicker'
import { Book } from './routes/Book'
import { Find } from './routes/Find'
import { Orders } from './routes/Orders'
import { Results } from './routes/Results'
import { AppProvider } from './state/app'
import { modal, type Modal } from './state/modals'

/**
 * Modals are rendered once, here, off a single piece of state.
 *
 * The alternative — each screen owning its own dialogs — means the order dialog
 * exists in four places and drifts in three of them. It is the same dialog
 * whether it was opened from the widget, the results list or the book.
 */
/**
 * `Match` is given a narrowing accessor rather than a boolean, so each branch
 * receives the already-narrowed modal and Solid remounts it when the *identity*
 * changes. Passing `modal()?.kind === 'order'` and re-reading the signal inside
 * the branch would type-widen and keep a stale dialog mounted across a switch
 * from one order to another.
 */
const asKind = <K extends NonNullable<Modal>['kind']>(kind: K) => {
  type Narrowed = Extract<NonNullable<Modal>, { kind: K }>
  return (): Narrowed | undefined => {
    const current = modal()
    return current?.kind === kind ? (current as Narrowed) : undefined
  }
}

const Modals = (): JSX.Element => (
  <Switch>
    <Match when={asKind('order')()}>
      {(current) => <OrderDialog offerId={current().offerId} />}
    </Match>
    <Match when={asKind('create')()}>
      <CreateOffer />
    </Match>
    <Match when={asKind('review')()}>
      <SwapReview />
    </Match>
    <Match when={asKind('settings')()}>
      <Settings />
    </Match>
    <Match when={asKind('connect')()}>
      <ConnectWallet />
    </Match>
    <Match when={asKind('token')()}>
      {(current) => (
        <TokenPicker
          current={current().current}
          onPick={current().onPick}
          allowXmr={current().allowXmr}
        />
      )}
    </Match>
    <Match when={asKind('chains')()}>
      {/* The payload names which filter to edit; the picker reads it live. */}
      {(current) => <ChainPicker target={current().target} />}
    </Match>
  </Switch>
)

export const App = (): JSX.Element => (
  <Router
    root={(props) => (
      <AppProvider>
        {props.children}
        <Modals />
      </AppProvider>
    )}
  >
    <Route path="/" component={Find} />
    <Route path="/offers" component={Results} />
    <Route path="/book" component={Book} />
    <Route path="/orders" component={Orders} />
    {/* Anything else is the front door — there is nothing here worth a 404 page. */}
    <Route path="*" component={Find} />
  </Router>
)
