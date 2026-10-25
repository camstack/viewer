/**
 * @vitest-environment jsdom
 *
 * The strip on the running row draws the fraction it HAS, and nothing where it
 * has none.
 *
 * The failure this pins is the one D393 names: a length the broker never
 * measured folded into "0", drawn as an empty bar that claims the file has not
 * started and then lurches forward when a measurement lands. The unknown arm
 * renders a different thing — an indeterminate sweep — so the two cases cannot
 * be confused on screen, and this asserts they render different elements.
 */
import { describe, it, expect, afterEach } from 'vitest'
import React from 'react'
import { render, cleanup } from '@testing-library/react'

import { ThemeProvider } from '../../../../theme/theme-provider.js'
import {
  ClipRowProgress,
  CLIP_ROW_PROGRESS_FILL_TEST_ID,
  CLIP_ROW_PROGRESS_SWEEP_TEST_ID,
} from '../ClipRowProgress.js'
import type { ClipRowPlayback } from '../../../../clips/clip-row-playback.js'

afterEach(cleanup)

function mount(playback: ClipRowPlayback): HTMLElement {
  const { container } = render(
    React.createElement(
      ThemeProvider,
      null,
      React.createElement(ClipRowProgress, { playback, width: 200 }),
    ),
  )
  return container
}

function fill(el: HTMLElement): HTMLElement | null {
  return el.querySelector(`[data-testid="${CLIP_ROW_PROGRESS_FILL_TEST_ID}"]`)
}

function sweep(el: HTMLElement): HTMLElement | null {
  return el.querySelector(`[data-testid="${CLIP_ROW_PROGRESS_SWEEP_TEST_ID}"]`)
}

describe('ClipRowProgress — a known fraction', () => {
  it('fills the track to the fraction', () => {
    const el = mount({ progress: { kind: 'known', fraction: 0.4 } })
    const bar = fill(el)
    expect(bar).not.toBeNull()
    expect(bar?.style.width).toBe('40%')
  })

  it('draws no indeterminate sweep beside it', () => {
    expect(sweep(mount({ progress: { kind: 'known', fraction: 0.4 } }))).toBeNull()
  })
})

describe('ClipRowProgress — an unknown duration', () => {
  it('draws an INDETERMINATE sweep, not a fill', () => {
    const el = mount({ progress: { kind: 'unknown' } })
    expect(sweep(el)).not.toBeNull()
    expect(fill(el)).toBeNull()
  })

  it('never renders a 0 % fill for it — that is the measurement-failed-is-zero bug', () => {
    // Remove the `unknown` arm from the component and this is the element that
    // comes back: a fill at width 0, indistinguishable from a clip that has
    // genuinely just begun.
    const el = mount({ progress: { kind: 'unknown' } })
    expect(el.querySelector('[style*="width: 0%"]')).toBeNull()
  })
})

describe('ClipRowProgress — a row that is playing is drawn either way', () => {
  it('renders SOMETHING for both arms: the row is running in both', () => {
    // Highlight and progress are two facts. A clip can hold the frame with no
    // length known, and the strip must still say the row is the live one.
    expect(mount({ progress: { kind: 'known', fraction: 0 } }).firstElementChild).not.toBeNull()
    expect(mount({ progress: { kind: 'unknown' } }).firstElementChild).not.toBeNull()
  })
})
