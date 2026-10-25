/**
 * @vitest-environment jsdom
 *
 * The speed menu and the frame-step pair, against the HUB's per-camera answer
 * (`videoclips.getPlaybackOptions`, D612).
 *
 * The defect this replaces: the bar drew its own six-rate ladder from a
 * constant in this app and offered every rate on every camera. A Hikvision
 * clip arrives at 1.01× realtime — the pacer consumes `rate` seconds of media
 * per second while the socket supplies one — so 2× and 4× accepted the press
 * and delivered 1×. A control that does not do what it says reads as broken.
 *
 * Two rules are asserted together, because either alone is a different defect:
 *
 *  • A rate the camera cannot serve is DRAWN and DISABLED, never dropped
 *    (D62). A menu that silently stopped at 1× is indistinguishable from a
 *    viewer that never built 2×, and the operator files a missing feature.
 *  • Nothing is disabled on an answer that has not arrived (D315). Pending is
 *    not absent.
 */
import { describe, it, expect, afterEach } from 'vitest'
import React from 'react'
import { render, cleanup, fireEvent } from '@testing-library/react'
import { CLIP_PLAYBACK_OPTIONS } from '@camstack/types'

import { ThemeProvider } from '../../../../theme/theme-provider.js'
import '../../../../app/i18n.js'
import { TimelinePlaybackBar } from '../TimelinePlaybackBar.js'
import {
  LEGACY_CONTROLS_VIEW,
  resolveClipControls,
  type ClipControlsView,
} from '../../../../clips/clip-controls.js'

afterEach(cleanup)

const NOOP = (): void => undefined

const REALTIME = resolveClipControls('present', CLIP_PLAYBACK_OPTIONS.realtimeStream)
const FILE = resolveClipControls('present', CLIP_PLAYBACK_OPTIONS.file)

function mountBar(clipControls: ClipControlsView | undefined, paused = true): HTMLElement {
  const { container } = render(
    React.createElement(
      ThemeProvider,
      null,
      React.createElement(TimelinePlaybackBar, {
        mode: 'playback',
        rate: 1,
        paused,
        loading: false,
        onTogglePause: NOOP,
        onJogBack: NOOP,
        onJogForward: NOOP,
        onStepFrame: NOOP,
        onSelectRate: NOOP,
        onGoLive: NOOP,
        ...(clipControls === undefined ? {} : { clipControls }),
      }),
    ),
  )
  return container
}

/** Open the speed dropdown and hand back every row in it. */
function rateRows(root: HTMLElement): readonly HTMLElement[] {
  const chip = root.querySelector('[aria-label="Playback speed"]')
  expect(chip).not.toBeNull()
  fireEvent.click(chip as Element)
  return [...root.querySelectorAll('[role="menuitem"]')] as HTMLElement[]
}

const labels = (rows: readonly HTMLElement[]): readonly string[] =>
  rows.map((r) => r.getAttribute('aria-label') ?? '')

const dead = (rows: readonly HTMLElement[]): readonly string[] =>
  labels(rows.filter((r) => r.getAttribute('aria-disabled') === 'true'))

describe('the speed menu draws what the camera can do, and nothing else', () => {
  /**
   * These three used to assert the union — six rows, three greyed, and a line
   * explaining the cap — and the operator retired it on 2026-09-23:
   * *"nascondi il selettore e basta. Mostrare quella label non ha alcun senso
   * proprio per niente"*. What is given up is the distinction between "this
   * camera cannot" and "this app never built it"; he decided that is not worth
   * three dead rows and a paragraph on every open.
   */
  it('lists only the rates a realtime-bound camera serves, fastest-first', () => {
    const rows = rateRows(mountBar(REALTIME))
    expect(labels(rows)).toEqual(['1×', '0.5×', '0.25×'])
  })

  it('…so there is nothing left to grey', () => {
    expect(dead(rateRows(mountBar(REALTIME)))).toEqual([])
  })

  it('and no line explaining a cap, because nothing is capped on screen', () => {
    const root = mountBar(REALTIME)
    rateRows(root)
    expect(root.textContent).not.toContain('cannot be paced faster than')
  })

  it('a camera with ONE rate has no speed control at all', () => {
    // A chip that opens onto a single row is furniture. Measured against the
    // real cameras this came from — Hikvision 1436 and Amcrest 3836 both
    // declare [0.25, 0.5, 1] — the control stays, because slowing down works
    // and hiding it outright would have taken that away.
    const single = resolveClipControls('present', CLIP_PLAYBACK_OPTIONS.realtimeStream)
    const onlyOne = { presence: 'present', controls: { ...single.controls, rates: [1] } } as const
    expect(mountBar(onlyOne).querySelector('[aria-label="Playback speed"]')).toBeNull()
    expect(mountBar(REALTIME).querySelector('[aria-label="Playback speed"]')).not.toBeNull()
  })

  // The ladder is `CLIP_BROKER_PACED_RATES`, spelled out rather than imported
  // on purpose: it is an assertion about what the menu OFFERS, and a test that
  // derives it from the constant it guards cannot catch a widening.
  //
  // `16×` is absent and must stay absent. A Reolink `playSpeed 16` is not a
  // rate but an I-frame-only MODE — 10 access units for a 36.3 s clip on 592,
  // no audio track. Adding it here would pin a rate that is accepted and
  // delivered at 8, which is D612's defect one number further along.
  it('a file-served camera loses nothing and is told nothing', () => {
    const root = mountBar(FILE)
    const rows = rateRows(root)
    expect(labels(rows)).toEqual(['8×', '4×', '2×', '1.5×', '1×', '0.5×', '0.25×'])
    expect(dead(rows)).toEqual([])
    expect(root.textContent).not.toContain('cannot be paced faster than')
  })

  it('a surface with no clip source to ask about offers everything', () => {
    // The on-demand overlay, a wall. Absence of a question is not a
    // restriction — it is the freedom this app always had.
    expect(dead(rateRows(mountBar(undefined)))).toEqual([])
    expect(dead(rateRows(mountBar(LEGACY_CONTROLS_VIEW)))).toEqual([])
  })

  it('shows the WHOLE ladder while the read is still pending (D315)', () => {
    // The same restrictive envelope, unsettled. A menu that shrank here would
    // be claiming a camera limitation nobody has confirmed yet — and it is the
    // shrinking, not the greying, that can now make that claim.
    const pending = resolveClipControls('pending', CLIP_PLAYBACK_OPTIONS.realtimeStream)
    const root = mountBar(pending)
    expect(labels(rateRows(root))).toEqual(['8×', '4×', '2×', '1.5×', '1×', '0.5×', '0.25×'])
    expect(dead(rateRows(root))).toEqual([])
  })

  it('shrinks nothing even when handed a pending view carrying a restrictive envelope', () => {
    // Belt AND braces, deliberately. `resolveClipControls` already collapses a
    // pending answer to the legacy freedom, so this shape cannot come out of
    // the hook — it is constructed here to prove the CHROME has its own gate.
    // With only one of the two, deleting the other is invisible.
    const root = mountBar({ presence: 'pending', controls: REALTIME.controls })
    expect(dead(rateRows(root))).toEqual([])
  })

  it('a FAILED read is not a restriction either', () => {
    const unknown = resolveClipControls('unknown', CLIP_PLAYBACK_OPTIONS.realtimeStream)
    expect(dead(rateRows(mountBar(unknown)))).toEqual([])
  })
})

describe('the backward frame-step', () => {
  const back = (root: HTMLElement): HTMLElement | null =>
    root.querySelector('[aria-label="Previous frame"]')
  const forward = (root: HTMLElement): HTMLElement | null =>
    root.querySelector('[aria-label="Next frame"]')

  it('is DRAWN and disabled on a camera that kept no frames behind the picture', () => {
    const root = mountBar(REALTIME)
    expect(back(root)).not.toBeNull()
    expect(back(root)?.getAttribute('aria-disabled')).toBe('true')
  })

  it('leaves its forward twin alone — a half-pair would read as a missing feature', () => {
    const root = mountBar(REALTIME)
    expect(forward(root)).not.toBeNull()
    expect(forward(root)?.getAttribute('aria-disabled')).not.toBe('true')
  })

  it('is live on a file-served camera, and on a surface with nothing to ask', () => {
    expect(back(mountBar(FILE))?.getAttribute('aria-disabled')).not.toBe('true')
    expect(back(mountBar(undefined))?.getAttribute('aria-disabled')).not.toBe('true')
  })

  it('is live while the read is still pending (D315)', () => {
    const pending = resolveClipControls('pending', CLIP_PLAYBACK_OPTIONS.realtimeStream)
    expect(back(mountBar(pending))?.getAttribute('aria-disabled')).not.toBe('true')
  })
})
