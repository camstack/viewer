/**
 * @vitest-environment jsdom
 *
 * The Plates page MOUNTED against a stub hub: which rows the default chips
 * show, that the detail modal's assign goes through `assignPlates`, and that a
 * text correction goes through `correctPlateText`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import React from 'react'

import { mountScreen } from '../../../testing/mount.js'
import { hubCalls } from '../../../testing/hub-stub.js'
import { PlateReviewScreen } from '../PlateReviewScreen.js'

vi.mock('../../../connection/ConnectionProvider.js', async () =>
  (await import('../../../testing/connection-stub.js')).connectionStubModule(),
)

afterEach(cleanup)

const row = (plateId: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  plateId,
  deviceId: 1,
  trackId: `t-${plateId}`,
  timestamp: 1_790_000_000_000,
  text: `PLATE${plateId.toUpperCase()}`,
  score: 0.9,
  corrected: false,
  assigned: false,
  ...extra,
})

const HUB = {
  'plateGallery.listPlates': [
    row('a', { assigned: true, recognizedVehicleId: 'v1', vehicleName: 'Panda' }),
    row('b', { recognizedVehicleId: 'v1', vehicleName: 'Panda' }),
    row('c', { keyFrameMediaId: 5151, plateBbox: { x: 10, y: 20, w: 60, h: 20 } }),
  ],
  'plateGallery.listVehicles': [{ id: 'v1', name: 'Panda', sampleCount: 2 }],
  'plateGallery.assignPlates': { assigned: 1, failed: [] },
  'plateGallery.correctPlateText': undefined,
  'cameras.list': [],
}

describe('PlateReviewScreen', () => {
  it('opens on suggested + unassigned: the assigned read is not in the grid', async () => {
    mountScreen(React.createElement(PlateReviewScreen), { hub: HUB })
    await waitFor(() => expect(screen.getByTestId('plate-cell-b')).toBeTruthy())
    expect(screen.getByTestId('plate-cell-c')).toBeTruthy()
    expect(screen.queryByTestId('plate-cell-a')).toBeNull()
    expect(screen.getByTestId('plate-review-count').textContent).toContain('2')
    const list = hubCalls().find((c) => c.path === 'plateGallery.listPlates')
    expect(list?.input).toEqual({ limit: 200, includeCrops: false })
  })

  it('confirming a suggestion assigns that read to the suggested vehicle', async () => {
    mountScreen(React.createElement(PlateReviewScreen), { hub: HUB })
    await waitFor(() => expect(screen.getByTestId('plate-cell-b')).toBeTruthy())
    const confirm = screen.getByTestId('plate-cell-b').querySelector('[aria-label="Assign"]')
    expect(confirm).not.toBeNull()
    fireEvent.click(confirm as Element)
    await waitFor(() =>
      expect(hubCalls().some((c) => c.path === 'plateGallery.assignPlates')).toBe(true),
    )
    const call = hubCalls().find((c) => c.path === 'plateGallery.assignPlates')
    expect(call?.input).toEqual({ plateIds: ['b'], vehicleId: 'v1' })
  })

  it('the detail modal lists the vehicles and corrects the text through the hub', async () => {
    mountScreen(React.createElement(PlateReviewScreen), { hub: HUB })
    await waitFor(() => expect(screen.getByTestId('plate-cell-c')).toBeTruthy())
    fireEvent.click(screen.getByTestId('plate-cell-c').querySelector('[role="button"]') as Element)
    await waitFor(() => expect(screen.getByText('Known vehicles')).toBeTruthy())
    expect(screen.getAllByText('Panda').length).toBeGreaterThan(1)
    const input = screen.getByLabelText('Plate text') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'zz 999 yy' } })
    fireEvent.click(screen.getByLabelText('Correct the text'))
    await waitFor(() =>
      expect(hubCalls().some((c) => c.path === 'plateGallery.correctPlateText')).toBe(true),
    )
    expect(hubCalls().find((c) => c.path === 'plateGallery.correctPlateText')?.input).toEqual({
      plateId: 'c',
      text: 'ZZ999YY',
    })
  })

  // Issue 557: the plate detail is the face detail's sheet, original picture
  // included (the key frame, the plate boxed on it, "Open event").
  it('the detail shows the full picture the read was cut from, and opens its track', async () => {
    mountScreen(React.createElement(PlateReviewScreen), { hub: HUB })
    await waitFor(() => expect(screen.getByTestId('plate-cell-c')).toBeTruthy())
    fireEvent.click(screen.getByTestId('plate-cell-c').querySelector('[role="button"]') as Element)
    const picture = await screen.findByTestId('face-full-picture')
    expect(picture.querySelector('[data-testid$="/event-media/m/5151"]')).not.toBeNull()
    expect(screen.getByTestId('face-open-track')).toBeTruthy()
  })

  it('says the hub kept no full picture for a read without a key frame', async () => {
    mountScreen(React.createElement(PlateReviewScreen), { hub: HUB })
    await waitFor(() => expect(screen.getByTestId('plate-cell-b')).toBeTruthy())
    fireEvent.click(screen.getByTestId('plate-cell-b').querySelector('[role="button"]') as Element)
    const absent = await screen.findByTestId('face-full-picture-absent')
    expect(absent.textContent).toBe('The hub kept no full picture for this plate.')
  })
})
