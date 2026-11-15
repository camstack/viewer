/**
 * @vitest-environment jsdom
 *
 * The served-quality badge on the transport (#568).
 *
 * While a clip or recording plays, the bar reports the tier the hub actually
 * served — a letter pinned to the corner of the play/pause disc. It had a
 * border and a muted letter but no fill, so it was drawn straight over the
 * accent disc and over the picture: on most frames it could not be read. It
 * carries its own opaque surface token now, in both themes.
 */
import { describe, it, expect, afterEach } from 'vitest'
import React from 'react'
import { render, cleanup } from '@testing-library/react'

import { ThemeProvider } from '../../../../theme/theme-provider.js'
import '../../../../app/i18n.js'
import { TimelinePlaybackBar } from '../TimelinePlaybackBar.js'
import type { ServedProfileReport } from '../../../../recording/recording-messages.js'

afterEach(cleanup)

const NOOP = (): void => undefined

function badgeFor(servedTier: ServedProfileReport): HTMLElement {
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
        clipHeld: true,
        servedTier,
      }),
    ),
  )
  const badge = container.querySelector<HTMLElement>('[aria-label*="laying"]')
  if (badge === null) throw new Error('no served-tier badge drawn')
  return badge
}

function isOpaque(color: string): boolean {
  if (color === '' || color === 'transparent') return false
  const rgba = /rgba\([^)]*,\s*([\d.]+)\)/.exec(color)
  return rgba === null || Number(rgba[1]) === 1
}

describe('the served-tier badge reads on any frame', () => {
  it('a matching tier sits on an opaque surface', () => {
    const badge = badgeFor({ profile: 'low', requested: 'low' })
    expect(isOpaque(getComputedStyle(badge).backgroundColor)).toBe(true)
  })

  it('a degraded tier sits on an opaque surface too', () => {
    const badge = badgeFor({ profile: 'low', requested: 'high' })
    expect(isOpaque(getComputedStyle(badge).backgroundColor)).toBe(true)
  })
})
