/**
 * The `★nn` importance pip is never drawn — host `fields.importance` is kept
 * for URL/config compat but ignored at render time.
 */
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import {
  applyEventsConfigPatch,
  DEFAULT_EVENTS_FIELDS,
  eventsConfigPatchSchema,
  type EventsFields,
  parseEventsConfig,
} from '../../embed/events-config'
import { parseEventsUrlPatch } from '../../embed/events-url-config'
import { DARK_PALETTE } from '../../embed/events-theme'
import type { EventsTrackRow } from '../../../../shared/events/events-track-row'
import { EventsCard } from '../EventsCard'

const ROW: EventsTrackRow = {
  trackId: 'trk-1',
  deviceId: 101,
  cameraName: 'Front Door',
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
  importance: 0.82,
}

function renderCard(fields: EventsFields) {
  return render(
    <EventsCard
      row={ROW}
      serverUrl="https://hub.invalid"
      token="tok"
      thumbPx={192}
      width="120px"
      heroPx={120}
      fields={fields}
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

function parsedFields(raw: unknown): EventsFields {
  const result = parseEventsConfig(raw)
  if (!result.ok) throw new Error(result.error)
  return result.config.fields
}

afterEach(cleanup)

describe('importance pip — never rendered', () => {
  it('the default fields hide the score and keep the badges', () => {
    expect(DEFAULT_EVENTS_FIELDS.importance).toBe(false)
    expect(DEFAULT_EVENTS_FIELDS.badges).toBe(true)
  })

  it('a host that sends no fields gets no pip', () => {
    const fields = parsedFields({ serverUrl: 'https://hub', token: 'jwt' })
    expect(fields.importance).toBe(false)
    expect(renderCard(fields).queryByTestId('card-importance')).toBeNull()
  })

  it('a host built before the flag (five keys, badges on) gets no pip', () => {
    const fields = parsedFields({
      serverUrl: 'https://hub',
      token: 'jwt',
      fields: { label: true, sublabel: true, camera: true, time: true, badges: true },
    })
    expect(fields.importance).toBe(false)
    expect(renderCard(fields).queryByTestId('card-importance')).toBeNull()
  })

  it('explicit importance:true still renders no pip (flag is a no-op)', () => {
    expect(renderCard({ ...DEFAULT_EVENTS_FIELDS, importance: true }).queryByTestId('card-importance')).toBeNull()
  })

  it('importance:true is independent of badges — still no pip', () => {
    expect(
      renderCard({ ...DEFAULT_EVENTS_FIELDS, badges: false, importance: true }).queryByTestId(
        'card-importance',
      ),
    ).toBeNull()
  })

  it('a runtime patch that does not mention importance leaves it alone', () => {
    const result = parseEventsConfig({
      serverUrl: 'https://hub',
      token: 'jwt',
      fields: { ...DEFAULT_EVENTS_FIELDS, importance: true },
    })
    if (!result.ok) throw new Error(result.error)
    const patch = eventsConfigPatchSchema.parse({ fields: { badges: false } })
    expect(patch.fields).toEqual({ badges: false })
    const next = applyEventsConfigPatch(result.config, patch)
    expect(next.fields.importance).toBe(true)
    expect(next.fields.badges).toBe(false)
  })

  it('a URL fields= allow-list may set importance in config but never draws the pip', () => {
    const without = parseEventsUrlPatch('?v=1&fields=label,badges')
    const withIt = parseEventsUrlPatch('?v=1&fields=label,badges,importance')
    expect(without?.ok && without.patch.fields?.importance).toBe(false)
    expect(withIt?.ok && withIt.patch.fields?.importance).toBe(true)
    if (withIt?.ok && withIt.patch.fields) {
      expect(renderCard({ ...DEFAULT_EVENTS_FIELDS, ...withIt.patch.fields }).queryByTestId('card-importance')).toBeNull()
    }
  })
})
