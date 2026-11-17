/**
 * @vitest-environment jsdom
 *
 * The Recent reel's retry RECOVERS the reel — on the Cameras page, mounted
 * (planning#110).
 *
 * `track-reel-mount.spec.ts` proves the reel shows a Retry inside its band
 * when the feed gives up. It does not press it, and it mounts `TrackReel`
 * alone. The wire a refactor severs is the rest: CamerasScreen →
 * RecentReelBlock → TrackReel → the feed's `retry`. A Retry handed a no-op,
 * or a block that stopped passing the feed through, draws the same button and
 * leaves the operator with a reel that never comes back.
 *
 * Deterministic: the feed's backoff (`shared/events/page-retry.ts`, four
 * attempts, ≤ 4 s each) runs on fake timers, advanced past its whole budget;
 * nothing waits on the real clock.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import React from 'react'

import i18n from '../../app/i18n.js'
import { mountScreen } from '../../testing/mount.js'
import { hubCalls } from '../../testing/hub-stub.js'
import { setTestViewport } from '../../testing/viewport-control.js'
import { PAGE_RETRY_ATTEMPTS, PAGE_RETRY_CAP_MS } from '../../../shared/events/page-retry.js'
import { CamerasScreen } from '../CamerasScreen.js'

vi.mock('../../connection/ConnectionProvider.js', async () =>
  (await import('../../testing/connection-stub.js')).connectionStubModule(),
)

const CAMERA_NAME = 'Front gate'
const RECENT = 'pipelineAnalytics.listRecentTracks'
/** Every backoff at its cap, plus slack: the feed has certainly given up. */
const WHOLE_BACKOFF_MS = PAGE_RETRY_ATTEMPTS * PAGE_RETRY_CAP_MS + 1_000

const hubState = { failing: true }

function recentTracks(): unknown {
  if (hubState.failing) throw new Error('hub unreachable')
  const lastSeen = Date.now() - 5 * 60_000
  return {
    tracks: [
      {
        trackId: 'r1',
        deviceId: 1,
        className: 'person',
        firstSeen: lastSeen - 8_000,
        lastSeen,
        state: 'idle',
        active: false,
        zonesVisited: [],
        zoneNames: [],
        classes: ['person'],
        audioLabels: [],
        bestEventId: 'ev-r1',
        source: 'pipeline',
      },
    ],
    nextCursor: null,
  }
}

const HUB = {
  'auth.me': { id: 'u1', username: 'operator', isAdmin: true },
  'deviceManager.listAll': [
    { id: 1, name: CAMERA_NAME, type: 'camera', isCamera: true, online: true, disabled: false, features: [] },
  ],
  [RECENT]: recentTracks,
}

const recentCalls = (): number => hubCalls().filter((c) => c.path === RECENT).length

/** The reel's cards: a pressable labelled with the camera it came from. */
const reelCards = (): readonly HTMLElement[] =>
  [...document.querySelectorAll<HTMLElement>('[role="button"], button')].filter((el) =>
    (el.getAttribute('aria-label') ?? '').includes(CAMERA_NAME),
  )

async function settle(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

beforeEach(async () => {
  hubState.failing = true
  await AsyncStorage.clear()
  act(() => setTestViewport({ width: 390, height: 844 }))
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})

afterEach(() => {
  vi.useRealTimers()
  cleanup()
})

describe('Cameras page: the Recent reel retry', () => {
  it('gives up after its attempts, then a press of Retry asks again and draws the reel', async () => {
    mountScreen(React.createElement(CamerasScreen), { hub: HUB })
    await settle(WHOLE_BACKOFF_MS)

    const retry = screen.getByText(i18n.t('v2.events.retry'))
    expect(recentCalls()).toBe(PAGE_RETRY_ATTEMPTS)
    const cardsBefore = reelCards().length

    hubState.failing = false
    fireEvent.click(retry)
    await settle(1_000)

    expect(recentCalls()).toBeGreaterThan(PAGE_RETRY_ATTEMPTS)
    expect(screen.queryByText(i18n.t('v2.events.retry'))).toBeNull()
    expect(reelCards().length).toBeGreaterThan(cardsBefore)
  })
})
