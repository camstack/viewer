/**
 * EventsCard — the embed draws no face-assignment marker. Assigning a name is
 * never relevant inside the embed, so an assignable, unnamed face renders
 * exactly like any other track.
 */
import { resolveTileDisplay } from '../../../../shared/events/events-tile-display'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
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

function renderCard(row: EventsTrackRow) {
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
      onClick={() => undefined}
    />,
  )
}

afterEach(cleanup)

describe('EventsCard face marker', () => {
  it('renders no "?" chip for an assignable, unnamed face', () => {
    const { queryByTestId, container } = renderCard({ ...BASE_ROW, hasUnassignedFace: true })
    expect(queryByTestId('card-face-unassigned')).toBeNull()
    expect(container.textContent).not.toContain('?')
  })
})
