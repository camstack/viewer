/**
 * What a tile SAYS about a track: which chips draw, which text, which flags.
 * Pure, so every branch is asserted without a renderer.
 */
import { describe, expect, it } from 'vitest'
import { tileAccessibilityLabel, tileChips, tileZone, type TileChipOptions } from '../tile-model.js'
import type { EventsTrackRow } from '../../../../../shared/events/events-track-row.js'

const BASE: EventsTrackRow = {
  trackId: 't1', deviceId: 1, cameraName: 'Front gate', className: 'person', firstSeen: 1_000, lastSeen: 81_000,
  state: 'idle', active: false, zonesVisited: [], zoneNames: [], classes: ['person'], audioLabels: [], bestEventId: 't1',
}
const OPTIONS: TileChipOptions = {
  labelMode: 'icon', showAdminFlags: false,
  kindLabels: new Map([['person', 'Persona'], ['van', 'Furgone']]), iconIds: new Map(), locale: 'en-GB',
  nowMs: new Date(2026, 9, 18, 12, 0).getTime(),
}

describe('tileChips — the label capsule', () => {
  it('a class-only track is the GLYPH alone under the default icon style', () => {
    const chips = tileChips(BASE, OPTIONS)
    expect(chips.text).toBeNull()
    expect(chips.glyphId).toBe('person')
  })

  it('label mode gives the class its translated name too', () => {
    expect(tileChips(BASE, { ...OPTIONS, labelMode: 'label' }).text).toBe('Persona')
  })

  it('icon mode never shows text, even for a recognised identity', () => {
    const chips = tileChips({ ...BASE, subLabel: 'Dave' }, OPTIONS)
    expect(chips.text).toBeNull()
    expect(chips.glyphId).toBe('person')
  })

  it('label mode shows identity verbatim', () => {
    expect(tileChips({ ...BASE, subLabel: 'Dave' }, { ...OPTIONS, labelMode: 'label' }).text).toBe('Dave')
  })

  it('a sub-class finer than the stored class is translated taxonomy in label mode', () => {
    const chips = tileChips({ ...BASE, className: 'vehicle', classes: ['vehicle'], label: 'van' }, { ...OPTIONS, labelMode: 'label' })
    expect(chips.text).toBe('Furgone')
  })

  it('off drops EVERY text — the glyph stays when the capsule is shown', () => {
    const chips = tileChips({ ...BASE, subLabel: 'Dave' }, { ...OPTIONS, labelMode: 'off' })
    expect(chips.text).toBeNull()
    expect(chips.glyphId).toBe('person')
  })
})

describe('tileChips — the "?" chip and flags', () => {
  it('raises "?" only for a face that is captured and still nameless', () => {
    expect(tileChips({ ...BASE, hasUnassignedFace: true }, OPTIONS).unassignedFace).toBe(true)
    expect(tileChips(BASE, OPTIONS).unassignedFace).toBe(false)
  })

  it('D / T / trained pills are admin-only; the star and the active dot are for everyone', () => {
    const flagged: EventsTrackRow = { ...BASE, debug: true, markForTrain: true, retrainStatus: 'trained', favourited: true, active: true }
    const viewer = tileChips(flagged, OPTIONS)
    expect([viewer.debug, viewer.train, viewer.trained]).toEqual([false, false, false])
    expect([viewer.favourited, viewer.active]).toEqual([true, true])
    const admin = tileChips(flagged, { ...OPTIONS, showAdminFlags: true })
    expect([admin.debug, admin.train, admin.trained]).toEqual([true, true, true])
  })

  it('the corner chip is the TIME of the last sighting, never a duration', () => {
    const chips = tileChips(BASE, { ...OPTIONS, nowMs: BASE.lastSeen })
    expect(chips.time).toBe(new Date(BASE.lastSeen).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }))
    expect(chips.time).toMatch(/^\d{2}:\d{2}$/)
    expect('duration' in chips).toBe(false)
  })

  it('an audio-sourced track takes the audio glyph, not the bare macro', () => {
    expect(tileChips({ ...BASE, className: 'speech', source: 'audio' }, OPTIONS).glyphId).toBe('audio-speech')
  })
})

describe('tileZone and the accessibility label', () => {
  it('shows the first zone NAME, never an id', () => {
    expect(tileZone({ ...BASE, zonesVisited: ['cfeec78c-8d69'], zoneNames: ['Driveway'] })).toBe('Driveway')
    expect(tileZone({ ...BASE, zonesVisited: ['cfeec78c-8d69'] })).toBeNull()
  })

  it('reads title, camera and time as one line', () => {
    expect(tileAccessibilityLabel(BASE, OPTIONS.kindLabels, '14:35')).toBe('Persona, Front gate, 14:35')
  })
})

describe('tileChips — the day shortcut on the time chip', () => {
  const at = (day: number): EventsTrackRow => ({ ...BASE, lastSeen: new Date(2026, 9, day, 14, 32).getTime() })

  it('today is the clock alone, in either locale', () => {
    expect(tileChips(at(18), OPTIONS).time).toBe('14:32')
    expect(tileChips(at(18), { ...OPTIONS, locale: 'it-IT' }).time).toBe('14:32')
  })

  it('yesterday is named, a week back is the weekday, older is DD/MM', () => {
    expect(tileChips(at(17), OPTIONS).time).toBe('Yesterday 14:32')
    expect(tileChips(at(17), { ...OPTIONS, locale: 'it-IT' }).time).toBe('Ieri 14:32')
    expect(tileChips(at(15), { ...OPTIONS, locale: 'it-IT' }).time).toBe('gio 14:32')
    expect(tileChips(at(3), { ...OPTIONS, locale: 'it-IT' }).time).toBe('03/10 14:32')
  })
})
