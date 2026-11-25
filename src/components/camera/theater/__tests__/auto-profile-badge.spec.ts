/**
 * @vitest-environment jsdom
 *
 * The Auto-quality profile badge (planning#733): shown whenever Auto is on,
 * live AND recorded, "pending" while unknown, never a guessed rung.
 */
import { describe, it, expect, afterEach } from 'vitest'
import React from 'react'
import { render, cleanup } from '@testing-library/react'

import { ThemeProvider } from '../../../../theme/theme-provider.js'
import '../../../../app/i18n.js'
import { TimelinePlaybackBar } from '../TimelinePlaybackBar.js'
import { resolveAutoProfileBadge, type AutoProfileBadge } from '../auto-profile-badge.js'
import { parseStreamDebugSample } from '../../../../live/stream-debug-sample.js'

afterEach(cleanup)

const NOW = 10_000
const sample = parseStreamDebugSample({
  at: NOW - 500,
  verdict: 'ok',
  sessionId: 's',
  serverWired: true,
  serverError: null,
  stats: { at: NOW - 500, width: 1920, height: 1080 },
  server: { alive: true, servedTier: 'mid', adaptive: true, sourceKind: 'native', egressLeg: 'copy' },
})
const base = { quality: 'auto' as const, isLive: true, recorded: null, sample, nowMs: NOW }

describe('resolveAutoProfileBadge', () => {
  it('is absent when quality is not Auto', () => {
    expect(resolveAutoProfileBadge({ ...base, quality: 'high' })).toBeNull()
  })
  it('live: the hub-reported rung with the measured resolution', () => {
    expect(resolveAutoProfileBadge(base)).toEqual({ state: 'known', profile: 'mid', heightPx: 1080 })
  })
  it('live, no sample yet: pending, not a value', () => {
    expect(resolveAutoProfileBadge({ ...base, sample: null })).toEqual({ state: 'pending' })
  })
  it('live, stale sample: pending', () => {
    expect(resolveAutoProfileBadge({ ...base, nowMs: NOW + 60_000 })).toEqual({ state: 'pending' })
  })
  it('recorded: the served tier; pending until reported', () => {
    expect(
      resolveAutoProfileBadge({ ...base, isLive: false, recorded: { profile: 'low', requested: 'auto' } }),
    ).toMatchObject({ state: 'known', profile: 'low' })
    expect(resolveAutoProfileBadge({ ...base, isLive: false })).toEqual({ state: 'pending' })
  })
})

function bar(mode: 'live' | 'playback', autoProfile: AutoProfileBadge | null): HTMLElement {
  const noop = (): void => undefined
  return render(
    React.createElement(
      ThemeProvider,
      null,
      React.createElement(TimelinePlaybackBar, {
        mode,
        rate: 1,
        paused: false,
        loading: false,
        onTogglePause: noop,
        onJogBack: noop,
        onJogForward: noop,
        onSelectRate: noop,
        onGoLive: noop,
        autoProfile,
      }),
    ),
  ).container
}

describe('the bar draws the Auto badge in live and recorded', () => {
  it('live: known profile with resolution', () => {
    const c = bar('live', { state: 'known', profile: 'mid', heightPx: 1080 })
    expect(c.querySelector('[aria-label="Auto: Mid 1080p"]')).not.toBeNull()
  })
  it('live: pending is drawn, labelled as pending', () => {
    const c = bar('live', { state: 'pending' })
    expect(c.querySelector('[aria-label="Auto: working out the quality"]')).not.toBeNull()
  })
  it('recorded: drawn too', () => {
    const c = bar('playback', { state: 'known', profile: 'low', heightPx: null })
    expect(c.querySelector('[aria-label="Auto: Low"]')).not.toBeNull()
  })
  it('not Auto: nothing drawn live', () => {
    const c = bar('live', null)
    expect(c.querySelector('[aria-label^="Auto:"]')).toBeNull()
  })
})
