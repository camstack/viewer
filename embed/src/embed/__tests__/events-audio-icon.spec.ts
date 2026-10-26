/**
 * An AUDIO-EPISODE track must render its audio glyph, never the neutral `Tag`.
 *
 * The hub materialises an audio episode as a SYNTHETIC track whose `className`
 * is the BARE audio macro (`speech`, `animal`, `water`) with `source: 'audio'`
 * — verified live: `pa-synth-…` rows on Dispensa / Bedroom / Camera
 * Carol all carried `className: 'speech'`. The glyph dictionary keys audio
 * subs under `audio-<id>`, so the bare id matched nothing, did not start with
 * `audio-`, and fell all the way through to `Tag` — the operator saw a wall of
 * generic tags where the pink speech bubble belongs.
 *
 * `source` is the authority (it is what the materialiser stamps), never a guess
 * from the label set: `animal` and `water` are BOTH a video class and an audio
 * class, and the two want different glyphs.
 */
import { EVENT_KIND_ICONS, resolveEventKindIcon } from '@camstack/ui-library'
import { describe, expect, it } from 'vitest'
import { audioKindId, buildKindIconIds, iconIdForClass } from '../../../../shared/events/events-taxonomy'
import { accentForClass } from '../events-theme'
import { getPaletteView, paintKind } from '../../../../shared/palette'
import { isAudioSourceRow, toEventsTrackRow } from '../../../../shared/events/events-track-row'

const NAMES = new Map<number, string>([[1438, 'Camera dispensa']])

/** The live shape of an audio-episode row (slim projection, hub 1.2.102). */
const AUDIO_RAW = {
  trackId: 'pa-synth-e9fa4bb8-3451-47e7-b86a-a8db979f1079',
  deviceId: 1438,
  className: 'speech',
  source: 'audio',
  firstSeen: 1787204172911,
  lastSeen: 1787204202704,
  state: 'idle',
  active: false,
  audioLabels: [{ label: 'speech', peakScore: 0.699, count: 1 }],
}

const VIDEO_RAW = {
  trackId: 'trk-1',
  deviceId: 1438,
  className: 'person',
  source: 'pipeline',
  firstSeen: 1000,
  lastSeen: 2000,
  state: 'moving',
  active: true,
}

const EMPTY_ICON_IDS: ReadonlyMap<string, string> = new Map()

describe('audio-episode rows carry their source', () => {
  it('keeps `source` through normalisation and flags the audio ones', () => {
    const audio = toEventsTrackRow(AUDIO_RAW, NAMES)
    expect(audio?.source).toBe('audio')
    expect(isAudioSourceRow(audio!)).toBe(true)
  })

  it('does not flag a pipeline track, nor one from a hub that omits the field', () => {
    expect(isAudioSourceRow(toEventsTrackRow(VIDEO_RAW, NAMES)!)).toBe(false)
    const legacy = toEventsTrackRow({ ...VIDEO_RAW, source: undefined }, NAMES)
    expect(legacy?.source).toBeUndefined()
    expect(isAudioSourceRow(legacy!)).toBe(false)
  })
})

describe('iconIdForClass namespaces an audio class', () => {
  it('resolves a bare audio class to its audio glyph, not the neutral Tag', () => {
    const iconId = iconIdForClass('speech', EMPTY_ICON_IDS, true)
    expect(iconId).toBe('audio-speech')
    const Glyph = resolveEventKindIcon(iconId)
    expect(Glyph).toBe(EVENT_KIND_ICONS['audio-speech'])
    expect(Glyph).not.toBe(EVENT_KIND_ICONS['generic'])
  })

  it('prefers the iconId the taxonomy DECLARES for the namespaced kind', () => {
    const iconIds = buildKindIconIds([
      {
        deviceId: 1438,
        kinds: [{ kind: 'audio-speech', parentKind: 'audio', iconId: 'audio-speech' }],
      },
    ])
    expect(iconIdForClass('speech', iconIds, true)).toBe('audio-speech')
  })

  it('keeps the audio and video readings of a shared id apart', () => {
    const asAudio = resolveEventKindIcon(iconIdForClass('water', EMPTY_ICON_IDS, true))
    const asVideo = resolveEventKindIcon(iconIdForClass('water', EMPTY_ICON_IDS, false))
    expect(asAudio).toBe(EVENT_KIND_ICONS['audio-water'])
    expect(asVideo).toBe(EVENT_KIND_ICONS['water'])
    expect(asAudio).not.toBe(asVideo)
  })

  it('degrades an UNKNOWN audio class to the audio glyph, never to Tag', () => {
    const Glyph = resolveEventKindIcon(iconIdForClass('Nonsense_XYZ', EMPTY_ICON_IDS, true))
    expect(Glyph).toBe(EVENT_KIND_ICONS['audio'])
    expect(Glyph).not.toBe(EVENT_KIND_ICONS['generic'])
  })

  /**
   * D189 (hub): an audio row now says `className: 'audio'` and carries the
   * heard macro on `audioLabels`. This compensation stays — an OLD hub still
   * serves the bare macro to a NEW viewer, and that window is exactly what it
   * protects — but it must be IDEMPOTENT, or it namespaces the already-correct
   * class into `audio-audio`: an id the taxonomy does not know, that shadows
   * both `EVENT_KIND_ICONS.audio` and the 25 curated `audio-*` glyphs.
   */
  it('never double-namespaces a class that already carries the namespace', () => {
    expect(audioKindId('audio-speech')).toBe('audio-speech')
    expect(iconIdForClass('audio-speech', EMPTY_ICON_IDS, true)).toBe('audio-speech')
  })

  it('leaves a D189 `audio` class as the macro, never `audio-audio`', () => {
    const iconId = iconIdForClass('audio', EMPTY_ICON_IDS, true)
    expect(iconId).toBe('audio')
    expect(resolveEventKindIcon(iconId)).toBe(EVENT_KIND_ICONS['audio'])
  })

  it('leaves the detection path exactly as it was', () => {
    expect(iconIdForClass('person', EMPTY_ICON_IDS)).toBe('person')
    expect(resolveEventKindIcon(iconIdForClass('Person', EMPTY_ICON_IDS))).toBe(
      EVENT_KIND_ICONS['person'],
    )
  })
})

describe('accentForClass tints an audio episode as audio', () => {
  const view = getPaletteView()
  const audio = paintKind(view, 'audio')

  it('tints by the SOURCE, not by a class name that reads as video', () => {
    expect(accentForClass('speech', true)).toBe(audio)
    expect(accentForClass('animal', true)).toBe(audio)
    expect(accentForClass('animal', false)).toBe(paintKind(view, 'animal'))
  })

  it('leaves detection classes on their own palette entries', () => {
    expect(accentForClass('person')).toBe(paintKind(view, 'person'))
    expect(accentForClass('audio')).toBe(audio)
  })
})
