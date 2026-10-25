/**
 * EventsCard — what a tile in Libreria → Eventi actually SAYS.
 *
 * Three rules, each from an operator report on this same grid:
 *
 *  1. the line UNDER the tile is the CAMERA, on every tile — a synthetic
 *     (sensor) one included. It used to prefer the sensor name, which the pill
 *     was also carrying: one fact, said twice, one of the two clipped.
 *
 *  2. the pill OVER the thumbnail of a sensor event is the sensor's TYPE
 *     (`Contatto`), not its whole name (`Contatto porta front door`) — the whole
 *     name covered the picture. The type comes from the row's `className`,
 *     which for a synthetic track IS the event kind the hub projected it under
 *     (`synthetic-track.ts`), never from the first word of the name: a
 *     `contact` sensor called `Sensore porta garage` must still say `Contatto`.
 *     The whole name is what the DETAIL shows (`trackTitle`), and it stays one
 *     hover away here.
 *
 *  3. every taxonomy label goes through the host's dictionary. The pills read
 *     `Car` inside an Italian app — not a missing key (`locales/it.json` has
 *     all 69 of them) but a path that never asked the translator.
 */
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_EVENTS_FIELDS } from '../../embed/events-config'
import { DARK_PALETTE } from '../../embed/events-theme'
import { buildKindLabels } from '../../../../shared/events/events-taxonomy'
import type { EventsTrackRow } from '../../../../shared/events/events-track-row'
import { EventsCard } from '../EventsCard'

/** The medium tile the operator's density renders at (`cardEdgePx('medium')`). */
const TILE_PX = 106

const BASE_ROW: EventsTrackRow = {
  trackId: 'trk-1',
  deviceId: 101,
  cameraName: 'Front door',
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

/**
 * The host's Italian taxonomy, as `kindLabels` delivers it. The sensor kinds
 * are in there for the same reason the detection ones are: a camera advertises
 * its LINKED devices' kinds (`composeEventKinds`), and every one of them has an
 * `eventKind.*` key in both locales.
 */
const IT = buildKindLabels({
  person: 'Persona',
  vehicle: 'Veicolo',
  car: 'Auto',
  contact: 'Contatto',
  motion: 'Movimento',
  'carbon-monoxide': 'Monossido di carbonio',
})

/** The same dictionary an English host sends. */
const EN = buildKindLabels({ person: 'Person', contact: 'Contact', motion: 'Motion' })

function renderCard(row: EventsTrackRow, kindLabels?: ReadonlyMap<string, string>) {
  return render(
    <EventsCard
      row={row}
      serverUrl="https://hub.invalid"
      token="tok"
      thumbPx={192}
      width="100%"
      heroPx={TILE_PX}
      fields={DEFAULT_EVENTS_FIELDS}
      palette={DARK_PALETTE}
      nowMs={3000}
      variant="gallery"
      iconId="person"
      {...(kindLabels !== undefined ? { kindLabels } : {})}
      scrollRoot={null}
      eagerImages
      onClick={() => undefined}
    />,
  )
}

const SENSOR_ROW: EventsTrackRow = {
  ...BASE_ROW,
  className: 'contact',
  classes: ['contact'],
  source: 'sensor',
  producingDeviceName: 'Contatto porta front door',
}

afterEach(cleanup)

describe('a SENSOR tile says the sensor TYPE over the image, never the whole name', () => {
  it('the pill is the TRANSLATED type — `Contatto`', () => {
    const { getByTestId } = renderCard(SENSOR_ROW, IT)
    expect(getByTestId('card-title').textContent).toBe('Contatto')
  })

  it('the pill is NOT the sensor’s whole name', () => {
    // The defect, stated as the value it produced: `Contatto porta front door`
    // over a 106 px thumbnail is a label wearing the picture.
    const { getByTestId } = renderCard(SENSOR_ROW, IT)
    expect(getByTestId('card-title').textContent).not.toBe('Contatto porta front door')
  })

  it('takes the type from the TAXONOMY, never from the first word of the name', () => {
    // The whole reason the type is read off `className`: the same `contact`
    // sensor named `Sensore porta garage` still says `Contatto`. A first-word
    // heuristic would have said `Sensore`.
    const { getByTestId } = renderCard(
      { ...SENSOR_ROW, producingDeviceName: 'Sensore porta garage' },
      IT,
    )
    expect(getByTestId('card-title').textContent).toBe('Contatto')
  })

  it('says `Contact` on an English host — the dictionary is the host’s', () => {
    const { getByTestId } = renderCard(SENSOR_ROW, EN)
    expect(getByTestId('card-title').textContent).toBe('Contact')
  })

  it('keeps the whole name one hover away, so nothing is lost from the tile', () => {
    const { getByTestId } = renderCard(SENSOR_ROW, IT)
    expect(getByTestId('card-title').getAttribute('title')).toBe('Contatto porta front door')
  })

  it('puts the CAMERA on the line under the tile, like every other event', () => {
    const { getByTestId } = renderCard(SENSOR_ROW, IT)
    expect(getByTestId('card-camera').textContent).toBe('Front door')
  })

  it('does NOT repeat the sensor name under the tile', () => {
    // This is the older regression: the line used to prefer
    // `producingDeviceName`, so the sensor name appeared twice.
    const { getByTestId } = renderCard(SENSOR_ROW, IT)
    expect(getByTestId('card-camera').textContent).not.toBe('Contatto porta front door')
  })

  it('lets a LONG type wrap rather than clip — `Monossido di carbonio`', () => {
    // The rendered text is always complete — CSS truncation is visual — so the
    // load-bearing assertion is on the STYLE the card chose. Translated types
    // are not all short, which is why `pill-fit` outlived the device name.
    const pill = renderCard(
      { ...SENSOR_ROW, className: 'carbon-monoxide', classes: ['carbon-monoxide'] },
      IT,
    ).getByTestId('card-title')
    expect(pill.style.whiteSpace).toBe('normal')
    expect(Number(pill.style.getPropertyValue('-webkit-line-clamp'))).toBeGreaterThan(1)
  })

  it('a camera the device directory has not named still degrades to `Camera <id>`', () => {
    // There is no synthetic-only fallback: the synthetic track is attributed to
    // a camera by construction (`cameraId` in the hub's projector), so the only
    // thing that can be missing is the NAME — and it degrades exactly as a
    // detection track's does.
    const { getByTestId } = renderCard({ ...SENSOR_ROW, cameraName: 'Camera 101' }, IT)
    expect(getByTestId('card-camera').textContent).toBe('Camera 101')
  })

  it('keeps the reel on ONE line — its hero is 80 px and its footer names the device', () => {
    const { getByTestId } = render(
      <EventsCard
        row={SENSOR_ROW}
        serverUrl="https://hub.invalid"
        token="tok"
        thumbPx={192}
        width="80px"
        heroPx={80}
        fields={DEFAULT_EVENTS_FIELDS}
        palette={DARK_PALETTE}
        nowMs={3000}
        variant="reel"
        iconId="contact"
        kindLabels={IT}
        scrollRoot={null}
        eagerImages
        onClick={() => undefined}
      />,
    )
    expect(getByTestId('card-title').style.whiteSpace).toBe('nowrap')
  })
})

describe('classification labels render in the host’s language', () => {
  it('renders `Auto`, not `Car`, for an Italian host', () => {
    const { getByTestId } = renderCard(
      { ...BASE_ROW, className: 'vehicle', classes: ['vehicle'], label: 'car' },
      IT,
    )
    expect(getByTestId('card-title').textContent).toBe('Auto')
  })

  it('renders the translated class on the glyph’s tooltip too', () => {
    const { getByTestId } = renderCard(BASE_ROW, IT)
    expect(getByTestId('card-class-glyph').getAttribute('title')).toBe('Persona')
  })

  it('leaves a tier-2 IDENTITY verbatim — a name is not a taxonomy id', () => {
    // Running a proper noun through a class dictionary is how a recognised face
    // gets mistranslated. The viewer's `trackTitle` splits the tiers for the
    // same reason.
    const { getByTestId } = renderCard({ ...BASE_ROW, subLabel: 'Anna' }, IT)
    expect(getByTestId('card-title').textContent).toBe('Anna')
  })

  it('a device NAME is never translated — it just is not what the pill shows', () => {
    // The name reaches the tile only as the hover, and it reaches it verbatim:
    // a device name is a proper noun, exactly like a tier-2 identity.
    const { getByTestId } = renderCard(SENSOR_ROW, EN)
    expect(getByTestId('card-title').getAttribute('title')).toBe('Contatto porta front door')
  })

  it('a BARE class keeps its glyph and grows no text pill', () => {
    // The pill decision is the TIER, not `title !== className`: once the class
    // is translated that compare is true on every row, and a text pill would
    // have appeared on every bare `person` tile — with its glyph removed.
    const { queryByTestId, getByTestId } = renderCard(BASE_ROW, IT)
    expect(queryByTestId('card-title')).toBeNull()
    expect(getByTestId('card-class-glyph')).not.toBeNull()
  })

  it('falls back to the raw id when the host sent no dictionary', () => {
    // A host too old to send one is narrower, never blank.
    const { getByTestId } = renderCard({
      ...BASE_ROW,
      className: 'vehicle',
      classes: ['vehicle'],
      label: 'car',
    })
    expect(getByTestId('card-title').textContent).toBe('car')
  })
})
