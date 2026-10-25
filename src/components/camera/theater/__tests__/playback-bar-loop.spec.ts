/**
 * @vitest-environment jsdom
 *
 * The LOOP control in the playback bar.
 *
 * > *"vorrei anche aggiungessi un pulsante di loop nella playback bar, default
 * > true, che riproduce in loop la stessa clip alla fine"* — the operator,
 * > 2026-09-23.
 *
 * Two rules, and they are the bar's own:
 *
 *  • an ABSENT binding is an absent control, never a disabled one — the rule
 *    `record`, `onStepFrame` and `onToggleLiveLock` already follow here. There
 *    is nothing to loop on a surface with no clip on the frame, and there is
 *    no camera that cannot be dialled again from offset 0, so there is no
 *    reason to draw this one disabled anywhere (D62 asks for a REASON, and
 *    inventing one is worse than an absence that means what it says);
 *  • the control says which way it is set, in WORDS: one accessibility label
 *    per state, because `react-native-web` drops `accessibilityState.selected`
 *    for a button and a colour is not a sentence.
 *
 * The bar draws it in the trailing slot the record control occupies, which is
 * why `playbackBarLayout` must hide the record control while a clip holds the
 * frame — otherwise the fit estimator (`playback-bar-fit.ts`, which prices ONE
 * trailing icon button) is measuring a bar that cannot happen, and the
 * narrowest panel overflows again.
 */
import { recordBinding } from '../../../../testing/record-binding.js'
import { describe, it, expect, afterEach, vi } from 'vitest'
import React from 'react'
import { render, cleanup, fireEvent } from '@testing-library/react'

import { ThemeProvider } from '../../../../theme/theme-provider.js'
import '../../../../app/i18n.js'
import { TimelinePlaybackBar, RECORD_TEST_ID } from '../TimelinePlaybackBar.js'
import { playbackBarLayout } from '../timeline-layout.js'
import type { ClipLoopBinding } from '../../../../clips/clip-loop.js'
import type { RecordControlBinding } from '../../../../recording/record-control.js'

afterEach(cleanup)

const NOOP = (): void => undefined

const RECORD: RecordControlBinding = recordBinding()

function mountBar(options: {
  readonly clipHeld: boolean
  readonly clipLoop?: ClipLoopBinding
  readonly record?: RecordControlBinding
}): HTMLElement {
  const { container } = render(
    React.createElement(
      ThemeProvider,
      null,
      React.createElement(TimelinePlaybackBar, {
        mode: 'playback',
        rate: 1,
        paused: false,
        loading: false,
        onTogglePause: NOOP,
        onJogBack: NOOP,
        onJogForward: NOOP,
        onSelectRate: NOOP,
        onGoLive: NOOP,
        clipHeld: options.clipHeld,
        ...(options.clipLoop === undefined ? {} : { clipLoop: options.clipLoop }),
        ...(options.record === undefined ? {} : { record: options.record }),
      }),
    ),
  )
  return container
}

const loopButton = (root: HTMLElement): Element | null =>
  root.querySelector('[aria-label="Loop this clip, on"]') ??
  root.querySelector('[aria-label="Loop this clip, off"]')

describe('the loop control appears where a clip can be looped', () => {
  it('is drawn while a clip holds the frame and the surface binds a loop', () => {
    const root = mountBar({ clipHeld: true, clipLoop: { enabled: true, onToggle: NOOP } })
    expect(loopButton(root)).not.toBeNull()
  })

  it('is ABSENT — not disabled — on a surface that binds no loop', () => {
    const root = mountBar({ clipHeld: true })
    expect(loopButton(root)).toBeNull()
  })

  it('is absent with no clip on the frame, even when a binding is handed over', () => {
    const root = mountBar({ clipHeld: false, clipLoop: { enabled: true, onToggle: NOOP } })
    expect(loopButton(root)).toBeNull()
  })
})

describe('the control says which way it is set, and toggles', () => {
  /**
   * The LABEL is what is asserted, not `accessibilityState.selected`:
   * `react-native-web` drops `selected` for `role="button"` entirely (measured
   * here, 2026-09-23 — the rendered element carries `aria-label` and nothing
   * else), so on web the label is the only thing that says which way the
   * switch is set. It is carried anyway for iOS and Android, which do read it.
   * This is the live lock's grammar on this same bar, one label per state.
   */
  it('reads ON when the loop is on', () => {
    const root = mountBar({ clipHeld: true, clipLoop: { enabled: true, onToggle: NOOP } })
    expect(loopButton(root)?.getAttribute('aria-label')).toBe('Loop this clip, on')
  })

  it('reads OFF when the loop is off', () => {
    const root = mountBar({ clipHeld: true, clipLoop: { enabled: false, onToggle: NOOP } })
    expect(loopButton(root)?.getAttribute('aria-label')).toBe('Loop this clip, off')
  })

  it('hands the press to the binding, which owns the state', () => {
    const onToggle = vi.fn()
    const root = mountBar({ clipHeld: true, clipLoop: { enabled: true, onToggle } })
    fireEvent.click(loopButton(root) as Element)
    expect(onToggle).toHaveBeenCalledTimes(1)
  })
})

describe('the trailing slot holds ONE of them', () => {
  it('the record control is withdrawn while a clip holds the frame', () => {
    // A file on the frame is not recordable — the screen already withholds
    // both flows for it, and the capture of a clip off the <video> is ended by
    // `shouldEndLiveCapture`. Saying it in the layout is what makes the fit
    // estimator's single trailing button true rather than merely customary.
    expect(playbackBarLayout('playback', false, null, true, false, true).record).toBe('hidden')
    expect(playbackBarLayout('playback', false, null, true, false, false).record).toBe(
      'exportSelection',
    )
  })

  it('so a bar with a held clip draws the loop and no record dot', () => {
    const root = mountBar({
      clipHeld: true,
      clipLoop: { enabled: true, onToggle: NOOP },
      record: RECORD,
    })
    expect(loopButton(root)).not.toBeNull()
    expect(root.querySelector(`[data-testid="${RECORD_TEST_ID}"]`)).toBeNull()
  })
})
