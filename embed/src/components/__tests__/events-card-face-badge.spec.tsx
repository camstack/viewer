/**
 * EventsCard — the unassigned-face "?" badge.
 *
 * The operator's rule: a track whose face is ASSIGNABLE but not yet named must
 * say so on the card — a `ScanFace` glyph + "?" chip in the same chip row where
 * a recognised identity renders its name pill. A recognised face keeps its name
 * pill and gains NO extra glyph (the operator already rejected an icon that
 * restates the pill), and a track the hub said nothing about renders nothing.
 */
import { resolveTileDisplay } from '../../../../shared/events/events-tile-display'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_EVENTS_FIELDS } from '../../embed/events-config'
import { DARK_PALETTE } from '../../embed/events-theme'
import type { EventsTrackRow } from '../../../../shared/events/events-track-row'
import { EventsCard } from '../EventsCard'

const BASE_ROW: EventsTrackRow = {
  trackId: 'trk-1',
  deviceId: 101,
  cameraName: 'Front Door',
  className: 'person',
  firstSeen: 1000,
  lastSeen: 2000,
  state: 'moving',
  active: false,
  zonesVisited: [],
  zoneNames: [],
  classes: ['person'],
  audioLabels: [],
  bestEventId: 'evt-1',
}

interface CardHandlers {
  readonly onClick?: (row: EventsTrackRow) => void
  readonly onAssignFace?: (row: EventsTrackRow) => void
}

function renderCard(row: EventsTrackRow, handlers: CardHandlers = {}) {
  return render(
    <EventsCard
      row={row}
      serverUrl="https://hub.invalid"
      token="tok"
      thumbPx={192}
      width="120px"
      heroPx={120}
      fields={DEFAULT_EVENTS_FIELDS}
      display={resolveTileDisplay(DEFAULT_EVENTS_FIELDS, {})}
      palette={DARK_PALETTE}
      nowMs={3000}
      variant="gallery"
      iconId="person"
      scrollRoot={null}
      eagerImages
      onClick={handlers.onClick ?? (() => undefined)}
      {...(handlers.onAssignFace === undefined ? {} : { onAssignFace: handlers.onAssignFace })}
    />,
  )
}

afterEach(cleanup)

describe('EventsCard unassigned-face badge', () => {
  it('renders the ScanFace + "?" chip when the face is assignable but unnamed', () => {
    const { getByTestId } = renderCard({ ...BASE_ROW, hasUnassignedFace: true })
    const badge = getByTestId('card-face-unassigned')
    expect(badge.textContent).toContain('?')
    expect(badge.querySelector('svg')).not.toBeNull()
  })

  it('renders NOTHING extra when the hub said nothing about a face', () => {
    const { queryByTestId } = renderCard(BASE_ROW)
    expect(queryByTestId('card-face-unassigned')).toBeNull()
  })

  it('a recognised face keeps its name pill and gets no "?" badge', () => {
    const { queryByTestId, getByTestId } = renderCard({
      ...BASE_ROW,
      subLabel: 'Anna',
      hasAssignableFace: true,
    })
    expect(getByTestId('card-title').textContent).toBe('Anna')
    expect(queryByTestId('card-face-unassigned')).toBeNull()
  })

  /**
   * The chip lives in the caption row, which is `pointer-events: none` so the
   * caption never eats the card's own open. The ONE interactive chip has to opt
   * back in explicitly — without it the chip is a button nothing can hit, every
   * tap falls through to the card, and the assignment never opens.
   *
   * jsdom dispatches a click regardless of `pointer-events`, so firing the
   * event proves NOTHING about this. The inline value is the assertion.
   */
  it('the chip opts back INTO hit-testing out of the non-interactive chip row', () => {
    const { getByTestId } = renderCard(
      { ...BASE_ROW, hasUnassignedFace: true },
      { onAssignFace: () => undefined },
    )
    const badge = getByTestId('card-face-unassigned')
    expect(badge.style.pointerEvents).toBe('auto')
    // The row it sits in really is the non-interactive one — the opt-in above
    // is load-bearing only because of this.
    expect((badge.parentElement as HTMLElement).style.pointerEvents).toBe('none')
  })

  it('stays transparent to taps when the host offers no assignment surface', () => {
    const { getByTestId } = renderCard({ ...BASE_ROW, hasUnassignedFace: true })
    expect(getByTestId('card-face-unassigned').style.pointerEvents).toBe('none')
  })

  it('a tap asks for the assignment and NOT the plain card open', () => {
    const onAssignFace = vi.fn()
    const onClick = vi.fn()
    const { getByTestId } = renderCard(
      { ...BASE_ROW, hasUnassignedFace: true },
      { onAssignFace, onClick },
    )
    fireEvent.click(getByTestId('card-face-unassigned'))
    expect(onAssignFace).toHaveBeenCalledTimes(1)
    expect(onAssignFace.mock.calls[0]?.[0]?.trackId).toBe('trk-1')
    // Two views would race and the last handler would win.
    expect(onClick).not.toHaveBeenCalled()
  })

  it('the badge rides the label chip row: fields.label off hides it too', () => {
    const { queryByTestId } = render(
      <EventsCard
        row={{ ...BASE_ROW, hasUnassignedFace: true }}
        serverUrl="https://hub.invalid"
        token="tok"
        thumbPx={192}
        width="120px"
        heroPx={120}
        fields={{ ...DEFAULT_EVENTS_FIELDS, label: false }}
        display={resolveTileDisplay({ ...DEFAULT_EVENTS_FIELDS, label: false }, {})}
        palette={DARK_PALETTE}
        nowMs={3000}
        variant="gallery"
        iconId="person"
        scrollRoot={null}
        eagerImages
        onClick={() => undefined}
      />,
    )
    expect(queryByTestId('card-face-unassigned')).toBeNull()
  })
})
