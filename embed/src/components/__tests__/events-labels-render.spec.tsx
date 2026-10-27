/**
 * What the card's pills actually SAY — the fallback and the injection, on the
 * rendered DOM rather than on the resolver alone.
 *
 * `embed/src/embed/__tests__/events-labels.spec.ts` pins the values; this one
 * pins that the controls READ them. A card that resolved the labels correctly
 * and then went on drawing its own literal would pass that spec and ship an
 * English tooltip into an Italian app, which is the whole failure being
 * designed out.
 *
 * These are `title`s: on a desktop gallery they are the tooltip, and they are
 * the accessible name a screen reader reaches for a pill whose only content is
 * a glyph (`✓`, `D`, `T`, `★`) or nothing at all (the active dot).
 */
import { resolveTileDisplay } from '../../../../shared/events/events-tile-display'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_EVENTS_FIELDS } from '../../embed/events-config'
import { DEFAULT_EVENTS_LABELS, type EventsLabels } from '../../../../shared/events/events-labels'
import { DARK_PALETTE } from '../../embed/events-theme'
import type { EventsTrackRow } from '../../../../shared/events/events-track-row'
import { EventsCard } from '../EventsCard'

const TILE_PX = 106

/** Every pill this spec is about, lit at once. `debug` is deliberately absent:
 *  the D pill only draws when the track is NOT reviewed, so it needs its own
 *  row rather than a flag on this one. */
const FLAGGED_ROW: EventsTrackRow = {
  trackId: 'trk-1',
  deviceId: 101,
  cameraName: 'Front door',
  className: 'person',
  firstSeen: 1000,
  lastSeen: 2000,
  state: 'moving',
  active: true,
  zonesVisited: [],
  zoneNames: [],
  classes: ['person'],
  audioLabels: [],
  bestEventId: 'evt-1',
  hasUnassignedFace: true,
  reviewed: true,
  markForTrain: true,
  favourited: true,
}

function renderCard(row: EventsTrackRow, labels?: EventsLabels) {
  return render(
    <EventsCard
      row={row}
      serverUrl="https://hub.invalid"
      token="tok"
      thumbPx={192}
      width="100%"
      heroPx={TILE_PX}
      fields={DEFAULT_EVENTS_FIELDS}
      display={resolveTileDisplay(DEFAULT_EVENTS_FIELDS, {})}
      palette={DARK_PALETTE}
      nowMs={3000}
      variant="gallery"
      iconId="person"
      {...(labels !== undefined ? { labels } : {})}
      scrollRoot={null}
      eagerImages
      showAdminFlags
      onClick={() => undefined}
    />,
  )
}

/** The `title` of every element that carries one, as rendered. */
function titles(container: HTMLElement): readonly string[] {
  return [...container.querySelectorAll('[title]')].map((el) => el.getAttribute('title') ?? '')
}

afterEach(cleanup)

describe('a card the host told nothing', () => {
  it('draws the English pills that shipped', () => {
    const { container } = renderCard(FLAGGED_ROW)
    const drawn = titles(container)
    expect(drawn).toContain(DEFAULT_EVENTS_LABELS.unassignedFace)
    expect(drawn).toContain(DEFAULT_EVENTS_LABELS.reviewed)
    expect(drawn).toContain(DEFAULT_EVENTS_LABELS.train)
    expect(drawn).toContain(DEFAULT_EVENTS_LABELS.favourite)
    expect(drawn).toContain(DEFAULT_EVENTS_LABELS.active)
  })

  it('including the debug pill, which only a NOT-reviewed track draws', () => {
    const { container } = renderCard({ ...FLAGGED_ROW, reviewed: false, debug: true })
    expect(titles(container)).toContain(DEFAULT_EVENTS_LABELS.debug)
  })
})

describe('a card the host DID tell', () => {
  const IT: EventsLabels = {
    ...DEFAULT_EVENTS_LABELS,
    unassignedFace: 'volto non assegnato',
    reviewed: 'analizzata',
    train: 'addestramento',
    favourite: 'preferito',
    active: 'attivo',
  }

  it('draws the host words on every pill, and no English is left behind', () => {
    const { container } = renderCard(FLAGGED_ROW, IT)
    const drawn = titles(container)
    expect(drawn).toContain('volto non assegnato')
    expect(drawn).toContain('analizzata')
    expect(drawn).toContain('addestramento')
    expect(drawn).toContain('preferito')
    expect(drawn).toContain('attivo')
    // The point of the exercise: the English is GONE, not merely accompanied.
    expect(drawn).not.toContain(DEFAULT_EVENTS_LABELS.favourite)
    expect(drawn).not.toContain(DEFAULT_EVENTS_LABELS.active)
    expect(drawn).not.toContain(DEFAULT_EVENTS_LABELS.reviewed)
  })
})
