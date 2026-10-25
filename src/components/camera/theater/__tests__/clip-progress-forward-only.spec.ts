/**
 * @vitest-environment jsdom
 *
 * A forward-only clip's track says so, instead of undoing the gesture.
 *
 * `use-clip-stage` has refused a backward commit since D602 — but the refusal
 * was invisible: the bar took the drag, the commit was dropped and the knob
 * snapped forward under the finger. That is a control that reads as BROKEN,
 * where one that cannot be dragged there reads as unavailable (D62), and D602's
 * own docstring names that distinction as the reason the declaration is on the
 * wire at all. The viewer half was missing.
 *
 * Both halves stay: the stretch behind the head is drawn spent, and the gesture
 * stops at it — so the picture and the drag cannot disagree about where the
 * operator may go.
 */
import { describe, it, expect, afterEach } from 'vitest'
import React from 'react'
import { render, cleanup } from '@testing-library/react'

import { ThemeProvider } from '../../../../theme/theme-provider.js'
import '../../../../app/i18n.js'
import {
  ClipProgressBar,
  CLIP_PROGRESS_NO_SCRUB_TEST_ID,
  CLIP_PROGRESS_SPENT_TEST_ID,
  CLIP_PROGRESS_TEST_ID,
} from '../ClipProgressBar.js'
import {
  LEGACY_CONTROLS,
  LEGACY_CONTROLS_VIEW,
  clipSeekFloorFraction,
  resolveClipControls,
  type ClipControlsView,
  type ClipSourceControls,
} from '../../../../clips/clip-controls.js'
import { CLIP_PLAYBACK_OPTIONS } from '@camstack/types'
import type { ClipProgressBinding } from '../../../../clips/clip-progress.js'

afterEach(cleanup)

const NOOP = (): void => undefined

/**
 * Forward-only, but still SCRUBBABLE — a shape no hub envelope produces
 * (every forward-only one turns scrub off too), constructed here on purpose so
 * the seek floor can be exercised as the separate verb it is.
 */
const FORWARD_ONLY: ClipSourceControls = { ...LEGACY_CONTROLS, seek: 'forward' }
const FORWARD_ONLY_VIEW: ClipControlsView = { presence: 'present', controls: FORWARD_ONLY }
/** What a realtime-bound camera really answers: no scrub at all. */
const NO_SCRUB = resolveClipControls('present', CLIP_PLAYBACK_OPTIONS.realtimeStream)

function mount(
  controls: ClipControlsView,
  fraction: number | null,
  over: Partial<ClipProgressBinding> = {},
): HTMLElement {
  const { container } = render(
    React.createElement(
      ThemeProvider,
      null,
      React.createElement(ClipProgressBar, {
        progress: {
          positionMs: fraction === null ? null : Math.round(fraction * 30_000),
          duration: { ms: 30_000, source: 'measured' },
          fraction,
        },
        controls,
        onSeekBegin: NOOP,
        onSeekMove: NOOP,
        onSeekCommit: NOOP,
        ...over,
      }),
    ),
  )
  return container
}

describe('the track marks what a forward-only clip can no longer reach', () => {
  it('draws the spent stretch once the broker has declared forward-only', () => {
    const el = mount(FORWARD_ONLY_VIEW, 0.5).querySelector(
      `[data-testid="${CLIP_PROGRESS_SPENT_TEST_ID}"]`,
    )
    expect(el).not.toBeNull()
  })

  it('draws NOTHING of the sort on a freely seekable clip', () => {
    // The ordinary case, and the majority one: a file the broker serves by
    // range. Marking it would tell the operator they cannot do something they
    // can.
    expect(
      mount(LEGACY_CONTROLS_VIEW, 0.5).querySelector(`[data-testid="${CLIP_PROGRESS_SPENT_TEST_ID}"]`),
    ).toBeNull()
  })

  it('draws nothing before the first position report — a floor from nothing would lock the track', () => {
    // `fraction: null` is "we have not been told where the picture is". Read as
    // a floor of 0 that is exactly right; read as anything else it would mark
    // the whole track spent on a clip that has only just opened.
    expect(
      mount(FORWARD_ONLY_VIEW, null).querySelector(`[data-testid="${CLIP_PROGRESS_SPENT_TEST_ID}"]`),
    ).toBeNull()
  })

  it('the floor is the HEAD, and it is the same rule the commit enforces', () => {
    // Drawn and enforced from one function (`clipSeekFloorFraction`), beside
    // the commit gate. They disagreed for a release, in the direction that
    // matters: the bar took a backward drag the commit then threw away.
    expect(clipSeekFloorFraction(FORWARD_ONLY, 0.5)).toBe(0.5)
    expect(clipSeekFloorFraction(FORWARD_ONLY, null)).toBe(0)
    expect(clipSeekFloorFraction(LEGACY_CONTROLS, 0.5)).toBe(0)
  })

  it('draws the track at all on a camera that serves NO scrub — disabled, never hidden', () => {
    // D62's rule at its sharpest: a bar that vanished would say this app
    // cannot show a clip's position. What is true is that this camera cannot
    // be dragged along it, and the position readout is still worth having.
    const track = mount(NO_SCRUB, 0.5).querySelector(`[data-testid="${CLIP_PROGRESS_TEST_ID}"]`)
    expect(track).not.toBeNull()
  })

  it('says WHY, in words, on the control itself', () => {
    // A dimmed track is not a reason. The padlock carries the sentence as its
    // label, which is the difference between "not here" and "broken" (D62).
    const lock = mount(NO_SCRUB, 0.5).querySelector(
      `[data-testid="${CLIP_PROGRESS_NO_SCRUB_TEST_ID}"]`,
    )
    expect(lock).not.toBeNull()
    expect(lock?.getAttribute('aria-label')).toBe(
      "This camera's clips cannot be scrubbed — only forward from where the picture is",
    )
  })

  it('claims nothing of the sort while the read is still PENDING (D315)', () => {
    // The same envelope, unsettled. An unanswered query must not draw a dead
    // control — that is a UI asserting an absence it was never told.
    const pending = resolveClipControls('pending', CLIP_PLAYBACK_OPTIONS.realtimeStream)
    const root = mount(pending, 0.5)
    expect(root.querySelector(`[data-testid="${CLIP_PROGRESS_NO_SCRUB_TEST_ID}"]`)).toBeNull()
    // The SEEK half too: the floor reads the controls straight, with no
    // presence of its own, so the collapse has to have happened upstream in
    // `resolveClipControls`. Assert the spent band as well or that collapse
    // can be deleted and only the lock notices.
    expect(root.querySelector(`[data-testid="${CLIP_PROGRESS_SPENT_TEST_ID}"]`)).toBeNull()
  })

  it('and never on an ordinary file-served camera', () => {
    expect(
      mount(LEGACY_CONTROLS_VIEW, 0.5).querySelector(
        `[data-testid="${CLIP_PROGRESS_NO_SCRUB_TEST_ID}"]`,
      ),
    ).toBeNull()
  })
})
