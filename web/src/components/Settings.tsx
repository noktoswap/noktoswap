import { For, Show, createSignal, type JSX } from 'solid-js'
import { Modal, Row } from './Modal'
import { closeModal } from '../state/modals'
import {
  MAX_ALLOWED_SLIPPAGE,
  deadlineMinutes,
  isDefault,
  maxSlippage,
  nearBandPercent,
  resetSettings,
  setDeadlineMinutes,
  setMaxSlippage,
  setNearBandPercent,
} from '../state/settings'

/**
 * Three settings, each of which changes an outcome.
 *
 * Everything here was a hardcoded constant before it was a control, which is the
 * bar for being here at all: a gear that opens a panel of things that do nothing
 * is worse than no gear. There is no theme switch and no display preference,
 * because there is nothing behind either.
 */

const PRESETS = [null, 0.1, 0.5, 1] as const

const Field = (props: { label: string; hint: string; children: JSX.Element }): JSX.Element => (
  <div class="sub" style={{ display: 'flex', 'flex-direction': 'column', gap: '9px' }}>
    <span class="lbl">{props.label}</span>
    {props.children}
    <span class="cap">{props.hint}</span>
  </div>
)

export const Settings = (): JSX.Element => {
  const [customSlippage, setCustomSlippage] = createSignal(
    maxSlippage() === null ? '' : String(maxSlippage()),
  )

  const applyCustom = (text: string) => {
    setCustomSlippage(text)
    const parsed = Number(text)
    if (text.trim() !== '' && Number.isFinite(parsed) && parsed > 0) setMaxSlippage(parsed)
  }

  return (
    <Modal title="Settings">
      <Field
        label="Max slippage"
        hint={
          // Worth spelling out, because exact-output inverts where people expect
          // slippage to land.
          'Applies to the token you spend, not the ETH the order escrows — an exact-output swap fixes the ETH and lets the token amount move. Auto follows Uniswap’s own figure for the pair.'
        }
      >
        <div style={{ display: 'flex', gap: '7px', 'flex-wrap': 'wrap', 'align-items': 'center' }}>
          <For each={PRESETS}>
            {(preset) => (
              <button
                class="chip"
                classList={{ 'chip-on': maxSlippage() === preset }}
                style={{ padding: '6px 12px' }}
                onClick={() => {
                  setMaxSlippage(preset)
                  setCustomSlippage(preset === null ? '' : String(preset))
                }}
              >
                {preset === null ? 'Auto' : `${preset}%`}
              </button>
            )}
          </For>
          <span
            class="chip"
            style={{ padding: '6px 10px', gap: '4px', width: '104px' }}
          >
            <input
              inputmode="decimal"
              placeholder="Custom"
              style={{ 'font-size': '15px' }}
              value={customSlippage()}
              onInput={(event) => applyCustom(event.currentTarget.value)}
              aria-label="Custom max slippage, percent"
            />
            <span class="cap2">%</span>
          </span>
        </div>
        <Show when={maxSlippage() !== null && (maxSlippage() ?? 0) >= MAX_ALLOWED_SLIPPAGE}>
          <span class="pill pill-urgent" style={{ 'align-self': 'flex-start' }}>
            Capped at {MAX_ALLOWED_SLIPPAGE}%
          </span>
        </Show>
      </Field>

      <Field
        label="Swap deadline"
        hint="How long a signed swap stays valid. It does not affect the order’s own deadlines, which the contract sets."
      >
        <div style={{ display: 'flex', 'align-items': 'center', gap: '9px' }}>
          <span class="chip" style={{ padding: '6px 10px', width: '96px' }}>
            <input
              inputmode="numeric"
              style={{ 'font-size': '15px' }}
              value={String(deadlineMinutes())}
              onInput={(event) => {
                const parsed = Number(event.currentTarget.value)
                if (Number.isFinite(parsed) && parsed > 0) setDeadlineMinutes(parsed)
              }}
              aria-label="Swap deadline, minutes"
            />
          </span>
          <span class="cap">minutes</span>
        </div>
      </Field>

      <Field
        label="Close to my size"
        hint="How far from the amount you type still counts as a near offer. Offers outside this never appear as takeable, because taking one would change your amount."
      >
        <div style={{ display: 'flex', 'align-items': 'center', gap: '9px' }}>
          <span class="chip" style={{ padding: '6px 10px', width: '96px' }}>
            <span class="cap2">±</span>
            <input
              inputmode="decimal"
              style={{ 'font-size': '15px' }}
              value={String(nearBandPercent())}
              onInput={(event) => {
                const parsed = Number(event.currentTarget.value)
                if (Number.isFinite(parsed) && parsed > 0) setNearBandPercent(parsed)
              }}
              aria-label="Near band, percent"
            />
            <span class="cap2">%</span>
          </span>
          <span class="cap">of your amount</span>
        </div>
      </Field>

      <div class="sub" style={{ display: 'flex', 'flex-direction': 'column', gap: '7px' }}>
        <Row k="Stored">
          <span class="cap">this browser only</span>
        </Row>
      </div>

      <div style={{ display: 'flex', gap: '8px' }}>
        <button
          class="btn btn-exit"
          style={{ flex: 1 }}
          disabled={isDefault()}
          onClick={() => {
            resetSettings()
            setCustomSlippage('')
          }}
        >
          Reset
        </button>
        <button class="btn btn-primary" style={{ flex: 1 }} onClick={closeModal}>
          Done
        </button>
      </div>
    </Modal>
  )
}
