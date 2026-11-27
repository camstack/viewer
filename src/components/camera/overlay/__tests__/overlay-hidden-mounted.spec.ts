/**
 * @vitest-environment jsdom
 *
 * A faded-out overlay is hidden VISUALLY only (planning#751): the badge stays
 * mounted so its data hooks keep subscribing; the stack just does not draw it.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import React from 'react'
import { render, cleanup } from '@testing-library/react'

const mounted = vi.hoisted(() => ({ audio: 0 }))

vi.mock('../../AudioLevelMeter.js', () => ({
  AudioLevelMeter: () => {
    React.useEffect(() => {
      mounted.audio += 1
    }, [])
    return null
  },
}))
vi.mock('../../DeviceInfoOverlay.js', () => ({ DeviceInfoOverlay: () => null }))
vi.mock('../../DoorbellBadge.js', () => ({ DoorbellBadge: () => null }))
vi.mock('../../MotionBadge.js', () => ({ MotionBadge: () => null }))
vi.mock('../../LiveViewersBadge.js', () => ({ LiveViewersBadge: () => null }))
vi.mock('../../OccupancyBadge.js', () => ({ OccupancyBadge: () => null }))
vi.mock('../../StreamStatsOverlay.js', () => ({ StreamStatsOverlay: () => null }))
vi.mock('../OverlayReadouts.js', () => ({
  useReadoutEntries: () => ({ entries: [], probes: null }),
}))
vi.mock('../OverlayStack.js', () => ({
  OverlayStack: ({ entries }: { entries: readonly { id: string; hidden?: boolean; node: React.ReactNode }[] }) =>
    React.createElement(
      'div',
      null,
      entries.map((e) => React.createElement('div', { key: e.id, 'data-id': e.id, 'data-hidden': String(e.hidden === true) }, e.node)),
    ),
}))

import { OverlayLayer } from '../OverlayLayer.js'
import { OVERLAY_DEFAULTS, setFade } from '../overlay-config.js'

afterEach(() => {
  cleanup()
  mounted.audio = 0
})

describe('OverlayLayer hidden overlay', () => {
  it('keeps a faded audio meter mounted, flagged hidden', () => {
    const config = setFade({ ...OVERLAY_DEFAULTS, audioMeter: 'top-right' }, 'audioMeter', true)
    const { container } = render(
      React.createElement(OverlayLayer, {
        deviceId: 1,
        config,
        gates: { audioMeter: true, motion: false, occupancy: false, stats: false, viewers: false, readouts: false, doorbell: false },
        controlsVisible: false,
        deviceInfo: 'off',
        getStats: async () => null,
      }),
    )
    expect(mounted.audio).toBe(1)
    expect(container.querySelector('[data-id="audioMeter"]')?.getAttribute('data-hidden')).toBe('true')
  })
})
