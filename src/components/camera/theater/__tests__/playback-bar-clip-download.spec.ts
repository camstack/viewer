/**
 * @vitest-environment jsdom
 *
 * The clip DOWNLOAD in the playback bar (#443).
 *
 * While a clip holds the frame the bar's record/export control is withdrawn
 * (a held file is not recordable), so the only way to keep the file on screen
 * was the small icon on its card. The bar now carries the SAME binding the
 * card does — `ClipSaveBinding`, whose press opens the one `ClipExportModal` —
 * drawn with the timeline's own Download icon.
 *
 * Rules, the bar's own:
 *  • an absent binding is an absent control;
 *  • a refusal (`onSave: null`) is drawn disabled with its reason as the label;
 *  • the press calls the binding — the modal is the timeline's, never a copy.
 *
 * And the wiring: the timeline hands the bar the HELD clip's entry of the very
 * map the cards read (`clipSaves`), gated on `axis === 'clip'`.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import React from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, cleanup, fireEvent } from '@testing-library/react'

import { ThemeProvider } from '../../../../theme/theme-provider.js'
import '../../../../app/i18n.js'
import { TimelinePlaybackBar } from '../TimelinePlaybackBar.js'
import type { ClipSaveBinding } from '../TimelineScroller.js'

afterEach(cleanup)

const NOOP = (): void => undefined

function mountBar(clipDownload?: ClipSaveBinding, clipHeld = true): HTMLElement {
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
        clipHeld,
        ...(clipHeld ? { clipLoop: { enabled: true, onToggle: NOOP } } : {}),
        ...(clipDownload === undefined ? {} : { clipDownload }),
      }),
    ),
  )
  return container
}

describe('the bar offers the held clip for download', () => {
  it('draws nothing without a binding', () => {
    const root = mountBar()
    expect(root.querySelector('[aria-label="Save clip"]')).toBeNull()
  })

  it('draws the download and the press reaches the binding', () => {
    const onSave = vi.fn()
    const root = mountBar({ onSave, reason: null })
    const button = root.querySelector('[aria-label="Save clip"]')
    expect(button).not.toBeNull()
    fireEvent.click(button!)
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('a refusal is drawn, disabled, with its reason', () => {
    const root = mountBar({ onSave: null, reason: 'The camera refused this clip' })
    const button = root.querySelector('[aria-label="The camera refused this clip"]')
    expect(button).not.toBeNull()
    expect(button!.getAttribute('aria-disabled')).toBe('true')
  })
})

describe('clips mode offers the SELECTED clip, not only a held file (#567)', () => {
  // A clip of our own recording is played by SEEKING the recorded transport:
  // nothing is "held", the bar stays on the epoch axis — and it used to draw no
  // download at all, so clips mode had no way to keep the clip it was showing.
  it('draws the download while the bar is on the epoch axis', () => {
    const onSave = vi.fn()
    const root = mountBar({ onSave, reason: null }, false)
    const button = root.querySelector('[aria-label="Save clip"]')
    expect(button).not.toBeNull()
    fireEvent.click(button!)
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('still draws nothing without a binding', () => {
    expect(mountBar(undefined, false).querySelector('[aria-label="Save clip"]')).toBeNull()
  })
})

describe('the timeline hands the bar the card binding of the selected clip', () => {
  const src = readFileSync(
    join(process.cwd(), 'src/components/camera/theater/TheaterTimeline.tsx'),
    'utf8',
  )

  it('reads the SAME map the cards read, for the held file OR the seeked clip', () => {
    expect(src).toMatch(/clipDownload:\s*selectedClipSave,/)
    expect(src).toMatch(/selectedClipSave[\s\S]{0,700}clipSaves\.get\(/)
    expect(src).toMatch(/clipsSurface\.axis === 'clip'\s*\?\s*\(props\.clipOnFrameId \?\? null\)\s*:\s*activeClipId/)
  })
})
