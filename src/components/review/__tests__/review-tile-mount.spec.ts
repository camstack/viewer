/**
 * @vitest-environment jsdom
 *
 * The review tile, MOUNTED: the eye's choice decides whether the time chip and
 * the camera line are drawn, on a face and on a plate alike; Confirm reaches
 * the page only outside selection mode.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { cleanup, fireEvent } from '@testing-library/react'

import { mountScreen } from '../../../testing/mount.js'
import { ReviewTile, type ReviewTileProps } from '../ReviewTile.js'
import { faceReviewTileContent, plateReviewTileContent, type ReviewTileDisplay } from '../review-tile.js'

vi.mock('../../../connection/ConnectionProvider.js', async () =>
  (await import('../../../testing/connection-stub.js')).connectionStubModule(),
)

afterEach(cleanup)

const TS = new Date(2026, 9, 23, 10, 22).getTime()

const faceContent = faceReviewTileContent(
  {
    faceId: 'f1',
    deviceId: 101,
    cameraName: 'MARK-front-door',
    trackId: 't1',
    timestamp: TS,
    cropUrl: undefined,
    base64: undefined,
    status: 'suggested',
    assignedIdentityName: undefined,
    suggestedIdentityId: 'p1',
    suggestedIdentityName: 'MARK-Alice',
    suggestedMatchScore: 0.9,
    certainty: 'certain',
  },
  'Unassigned',
)

const plateContent = plateReviewTileContent({
  plateId: 'p1',
  deviceId: 102,
  cameraName: 'MARK-Cancello',
  trackId: 't2',
  timestamp: TS,
  text: 'AB123CD',
  score: 0.9,
  corrected: false,
  cropUrl: undefined,
  base64: undefined,
  status: 'unassigned',
  vehicleId: undefined,
  vehicleName: undefined,
})

function mount(over: Partial<ReviewTileProps> & { readonly display: ReviewTileDisplay }) {
  const props: ReviewTileProps = {
    content: faceContent,
    width: 185,
    cropUri: null,
    mediaHeaders: undefined,
    pending: false,
    selectionMode: false,
    selected: false,
    confirmLabel: 'MARK-Confirm',
    onToggleSelect: vi.fn(),
    onStartSelect: vi.fn(),
    onOpenDetail: vi.fn(),
    onConfirm: vi.fn(),
    testIDPrefix: 'cell',
    ...over,
  }
  return { props, ...mountScreen(React.createElement(ReviewTile, props)) }
}

function hasClock(container: HTMLElement): boolean {
  return /10[:.]22/.test(container.textContent ?? '')
}

describe('ReviewTile', () => {
  it.each([
    ['face', faceContent, 'cell-f1'],
    ['plate', plateContent, 'cell-p1'],
  ])('%s — default display: the time chip, no camera line', (_name, content, id) => {
    const { container, queryByTestId } = mount({ content, display: { showDate: true, showCamera: false } })
    expect(hasClock(container)).toBe(true)
    expect(queryByTestId(`${id}-where`)).toBeNull()
    // The time is the corner chip, never the tile's own `when` line.
    expect(queryByTestId(`${id}-when`)).toBeNull()
  })

  it.each([
    ['face', faceContent, 'cell-f1', 'MARK-front-door'],
    ['plate', plateContent, 'cell-p1', 'MARK-Cancello'],
  ])('%s — camera on, date off: the camera line, no time', (_name, content, id, camera) => {
    const { container, getByTestId } = mount({ content, display: { showDate: false, showCamera: true } })
    expect(getByTestId(`${id}-where`).textContent).toBe(camera)
    expect(hasClock(container)).toBe(false)
  })

  it('Confirm reaches the page with the row id, and is gone in selection mode', () => {
    const first = mount({ display: { showDate: true, showCamera: false } })
    fireEvent.click(first.getByLabelText('MARK-Confirm'))
    expect(first.props.onConfirm).toHaveBeenCalledWith('f1')
    cleanup()
    const selecting = mount({ display: { showDate: true, showCamera: false }, selectionMode: true })
    expect(selecting.queryByLabelText('MARK-Confirm')).toBeNull()
  })
})
