import { createElement } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { TrackDetail } from '../EmbedTrackPage'
import { parseEventsConfig } from '../../embed/events-config'
import { DARK_PALETTE } from '../../embed/events-theme'
import { toEventsTrackRow } from '../../../../shared/events/events-track-row'
import { resetAuthedImageCache } from '../../embed/use-authed-image'

afterEach(() => {
  cleanup()
  resetAuthedImageCache()
})

function config(extra: Record<string, unknown> = {}) {
  const r = parseEventsConfig({ serverUrl: 'https://hub.test', token: 'jwt', refreshMs: 0, ...extra })
  if (!r.ok) throw new Error(r.error)
  return r.config
}

describe('TrackDetail', () => {
  const row = toEventsTrackRow(
    {
      trackId: 't-1',
      deviceId: 7,
      className: 'person',
      subLabel: 'Alice',
      firstSeen: 1_000,
      lastSeen: 13_000,
      zoneNames: ['Porch'],
      active: true,
      favourited: true,
    },
    new Map([[7, 'Camera hall one']]),
  )
  if (row === null) throw new Error('row')

  it('names the subject, camera, zone, time span and badges', () => {
    render(
      createElement(TrackDetail, {
        row,
        media: { stills: [], clip: null },
        config: config(),
        palette: DARK_PALETTE,
      }),
    )
    expect(screen.getByText('Alice')).toBeTruthy()
    expect(screen.getByText('Camera hall one')).toBeTruthy()
    expect(screen.getByText('Porch')).toBeTruthy()
    expect(screen.getByText(/12 s/)).toBeTruthy()
    expect(screen.getByText('active')).toBeTruthy()
    expect(screen.getByText('favourite')).toBeTruthy()
  })

  it('offers the strip only when there is more than one still', () => {
    const still = { key: 'a', kind: 'keyFrame', url: 'https://hub.test/m/1' }
    const { rerender } = render(
      createElement(TrackDetail, { row, media: { stills: [still], clip: null }, config: config(), palette: DARK_PALETTE }),
    )
    expect(screen.queryByTestId('track-strip')).toBeNull()
    rerender(
      createElement(TrackDetail, {
        row,
        media: { stills: [still, { ...still, key: 'b', kind: 'crop' }], clip: null },
        config: config(),
        palette: DARK_PALETTE,
      }),
    )
    expect(screen.getByTestId('track-strip')).toBeTruthy()
  })

  it('does not offer a clip to a page that must bearer-fetch', () => {
    render(
      createElement(TrackDetail, {
        row,
        media: { stills: [], clip: { key: 'c', kind: 'clip', url: 'https://hub.test/m/2' } },
        config: config(),
        palette: DARK_PALETTE,
      }),
    )
    expect(screen.queryByTestId('track-clip')).toBeNull()
  })

  it('renders its words and badges in Italian when the config says lang it', () => {
    render(
      createElement(TrackDetail, {
        row,
        media: { stills: [], clip: null },
        config: config({ locale: 'it' }),
        palette: DARK_PALETTE,
      }),
    )
    expect(screen.getByText('Zona')).toBeTruthy()
    expect(screen.getByText('Ora')).toBeTruthy()
    expect(screen.getByText('preferita')).toBeTruthy()
    expect(screen.getByText('attiva')).toBeTruthy()
    expect(screen.queryByText('Zone')).toBeNull()
  })

  it('lets host labels win over the language default', () => {
    render(
      createElement(TrackDetail, {
        row,
        media: { stills: [], clip: null },
        config: config({ locale: 'it', labels: { favourite: 'Top' } }),
        palette: DARK_PALETTE,
      }),
    )
    expect(screen.getByText('Top')).toBeTruthy()
    expect(screen.getByText('attiva')).toBeTruthy()
  })
})
