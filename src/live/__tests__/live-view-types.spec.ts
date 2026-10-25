import { describe, it, expect } from 'vitest'
import { LIVE_VIEW_HANDLE_METHODS } from '../live-view-types'
describe('LiveViewHandle contract', () => {
  it('declares the recorded-control methods', () => {
    expect(LIVE_VIEW_HANDLE_METHODS).toEqual(
      expect.arrayContaining([
        'playRecorded',
        'seek',
        'scrubStart',
        'scrubTo',
        'scrubEnd',
        'scrubCommit',
        'setRate',
        'goLive',
      ]),
    )
  })

  it('declares retry — the recovery the host bar drives', () => {
    // The retry affordance lives on the playback bar (outside the video's
    // gesture layer), so the host needs a way to reach the player. Every
    // variant must expose it or the bar's button is dead on that platform.
    expect(LIVE_VIEW_HANDLE_METHODS).toContain('retry')
  })

  it('declares live capture start/stop — the host bar records the decoded view', () => {
    expect(LIVE_VIEW_HANDLE_METHODS).toContain('startLiveCapture')
    expect(LIVE_VIEW_HANDLE_METHODS).toContain('stopLiveCapture')
  })
})
