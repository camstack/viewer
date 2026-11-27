/**
 * @vitest-environment jsdom
 *
 * OverlayLayer applies each overlay's size step (planning#749): step 0 (Auto)
 * adds nothing around the node, a non-zero step draws it at a stepped scale.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import React from 'react'
import { render, cleanup } from '@testing-library/react'

vi.mock('../../AudioLevelMeter.js', () => ({ AudioLevelMeter: () => null }))
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
  OverlayStack: ({ entries }: { entries: readonly { id: string; node: React.ReactNode }[] }) =>
    React.createElement(
      'div',
      null,
      entries.map((e) => React.createElement('div', { key: e.id, 'data-id': e.id }, e.node)),
    ),
}))

import { OverlayLayer } from '../OverlayLayer.js'
import { useOverlayScale } from '../OverlayFrame.js'
import { OVERLAY_DEFAULTS, setSizeStep } from '../overlay-config.js'
import { stepScale } from '../overlay-size.js'

afterEach(cleanup)

function Probe(): React.JSX.Element {
  return React.createElement('span', { 'data-testid': 'scale' }, String(useOverlayScale()))
}

function scaleOfName(step: number): string | null {
  const config = setSizeStep(OVERLAY_DEFAULTS, 'cameraName', step)
  const { container } = render(
    React.createElement(OverlayLayer, {
      deviceId: 1,
      config,
      gates: { audioMeter: false, motion: false, occupancy: false, stats: false, viewers: false, readouts: false, doorbell: false },
      controlsVisible: true,
      deviceInfo: 'off',
      getStats: async () => null,
      name: React.createElement(Probe),
    }),
  )
  return container.querySelector('[data-testid="scale"]')?.textContent ?? null
}

describe('OverlayLayer size step', () => {
  it('Auto draws at the main scale', () => {
    expect(scaleOfName(0)).toBe('1')
  })
  it('a non-zero step scales the overlay, up and down', () => {
    expect(scaleOfName(2)).toBe(String(stepScale(1, 2)))
    expect(Number(scaleOfName(2))).toBeGreaterThan(1)
    expect(Number(scaleOfName(-2))).toBeLessThan(1)
  })
  it('even at the largest main scale, +3 still grows past it (the step follows the clamp)', () => {
    expect(stepScale(2, 3)).toBeGreaterThan(2)
  })
})
