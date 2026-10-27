/**
 * EventsCard — the viewer's tile settings (`tileLabelMode`, `tileDetailCamera`,
 * `tileDetailZone`) and the clock on the picture's top-right corner.
 */
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_EVENTS_FIELDS } from '../../embed/events-config'
import { DARK_PALETTE } from '../../embed/events-theme'
import { fitTileText, TILE_TEXT_MAX_PX, TILE_TEXT_MIN_PX } from '../../embed/pill-fit'
import {
  DEFAULT_TILE_DISPLAY,
  resolveTileDisplay,
  type TileDisplay,
} from '../../../../shared/events/events-tile-display'
import type { EventsTrackRow } from '../../../../shared/events/events-track-row'
import { EventsCard } from '../EventsCard'

const ROW: EventsTrackRow = {
  trackId: 'trk-1',
  deviceId: 101,
  cameraName: 'Videocamera salone',
  className: 'person',
  label: 'Anna',
  firstSeen: 1000,
  lastSeen: 2000,
  state: 'moving',
  active: false,
  zonesVisited: ['Ingresso'],
  zoneNames: ['Ingresso'],
  classes: ['person'],
  audioLabels: [],
  bestEventId: 'evt-1',
}

function renderCard(display: TileDisplay, heroPx = 74) {
  return render(
    <EventsCard
      row={ROW}
      serverUrl="https://hub.invalid"
      token="tok"
      thumbPx={192}
      width="100%"
      heroPx={heroPx}
      fields={DEFAULT_EVENTS_FIELDS}
      display={display}
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

describe('the clock', () => {
  it('sits on the picture (top-right), not in a line under it', () => {
    const { getByTestId } = renderCard(DEFAULT_TILE_DISPLAY)
    const time = getByTestId('card-time')
    expect(time.style.top).toBe('4px')
    expect(time.style.right).toBe('4px')
    // Inside the hero (the element that owns the image backing), not the body.
    expect(time.parentElement).toBe(getByTestId('card-image-backing').parentElement)
  })
})

describe('the viewer tile settings', () => {
  it('default: glyph chip only, nothing under the picture', () => {
    const { queryByTestId } = renderCard(DEFAULT_TILE_DISPLAY)
    expect(queryByTestId('card-class-glyph')).not.toBeNull()
    expect(queryByTestId('card-title')).toBeNull()
    expect(queryByTestId('card-camera')).toBeNull()
    expect(queryByTestId('card-zone')).toBeNull()
  })

  it('tileLabelMode label adds the finest name; off removes every chip', () => {
    const label = renderCard({ ...DEFAULT_TILE_DISPLAY, tileLabelMode: 'label' })
    expect(label.getByTestId('card-title').textContent).toBe('Anna')
    cleanup()
    const off = renderCard({ ...DEFAULT_TILE_DISPLAY, tileLabelMode: 'off' })
    expect(off.queryByTestId('card-class-glyph')).toBeNull()
    expect(off.queryByTestId('card-title')).toBeNull()
  })

  it('tileDetailCamera / tileDetailZone draw the lines under the picture', () => {
    const { getByTestId } = renderCard({
      ...DEFAULT_TILE_DISPLAY,
      tileDetailCamera: true,
      tileDetailZone: true,
    })
    expect(getByTestId('card-camera').textContent).toBe('Videocamera salone')
    expect(getByTestId('card-zone').textContent).toBe('Ingresso')
  })

  it('a legacy fields-only host resolves to what it always rendered', () => {
    expect(resolveTileDisplay(DEFAULT_EVENTS_FIELDS, {})).toEqual({
      tileLabelMode: 'label',
      tileDetailCamera: true,
      tileDetailZone: true,
    })
    expect(
      resolveTileDisplay({ ...DEFAULT_EVENTS_FIELDS, camera: false }, { tileDetailCamera: true })
        .tileDetailCamera,
    ).toBe(true)
  })
})

describe('the camera line scales with the tile', () => {
  it('shrinks to fit one line, then takes a second line at the floor', () => {
    const wide = fitTileText('Videocamera salone', 200)
    expect(wide).toEqual({ fontSizePx: TILE_TEXT_MAX_PX, maxLines: 1 })
    const mid = fitTileText('Videocamera salone', 110)
    expect(mid.maxLines).toBe(1)
    expect(mid.fontSizePx).toBeLessThan(TILE_TEXT_MAX_PX)
    expect(fitTileText('Videocamera sala da pranzo', 74)).toEqual({
      fontSizePx: TILE_TEXT_MIN_PX,
      maxLines: 2,
    })
  })

  it('the rendered font size follows the tile width', () => {
    const narrow = renderCard({ ...DEFAULT_TILE_DISPLAY, tileDetailCamera: true }, 74)
    const narrowPx = narrow.getByTestId('card-camera').style.fontSize
    cleanup()
    const wide = renderCard({ ...DEFAULT_TILE_DISPLAY, tileDetailCamera: true }, 200)
    expect(Number.parseInt(wide.getByTestId('card-camera').style.fontSize, 10)).toBeGreaterThan(
      Number.parseInt(narrowPx, 10),
    )
  })
})
