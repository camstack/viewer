import { describe, expect, it } from 'vitest'
import { mergeSearchRows, toSemanticRow, toSemanticRows } from '../events-semantic'
import { buildClassToMacro, macroOf } from '../events-taxonomy'
import { resolveRowTitle, type EventsTrackRow } from '../events-track-row'

const NAMES = new Map<number, string>([[101, 'Front Door']])

function hit(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'evt-1',
    deviceId: 101,
    timestamp: 5_000,
    className: 'person',
    score: 0.42,
    trackId: 'trk-1',
    ...over,
  }
}

describe('toSemanticRow', () => {
  it('normalises a scored event into a renderable row', () => {
    const r = toSemanticRow(hit(), NAMES)
    expect(r).not.toBeNull()
    expect(r?.trackId).toBe('trk-1')
    expect(r?.cameraName).toBe('Front Door')
    expect(r?.score).toBe(0.42)
  })

  it('bestEventId is informational only (mediaId → trackId → id) — EventsCard addresses media via trackId, never this', () => {
    // D482: the event's own media row id, when the server reports one.
    expect(toSemanticRow(hit({ mediaId: 9 }), NAMES)?.bestEventId).toBe('9')
    expect(toSemanticRow(hit(), NAMES)?.bestEventId).toBe('trk-1')
    expect(toSemanticRow(hit({ trackId: undefined }), NAMES)?.bestEventId).toBe('evt-1')
  })

  it('shows the FINEST label, like every other surface — through the ONE rule', () => {
    // A semantic hit is normalised into the same row shape, and its title is
    // resolved by the same `resolveRowTitle`. It used to bake a second copy of
    // the precedence on this path, which is how the untranslated fallback
    // survived being fixed elsewhere.
    const title = (over: Record<string, unknown>): string | undefined => {
      const row = toSemanticRow(hit(over), NAMES)
      return row === null ? undefined : resolveRowTitle(row).text
    }
    expect(title({ label: 'dog' })).toBe('dog')
    expect(title({ label: 'dog', subLabel: 'Rex' })).toBe('Rex')
    expect(title({})).toBe('person')
  })

  it('collapses the window to the event moment rather than inventing a duration', () => {
    const r = toSemanticRow(hit(), NAMES)
    expect(r?.firstSeen).toBe(5_000)
    expect(r?.lastSeen).toBe(5_000)
  })

  it('leaves the track-only aggregates EMPTY instead of faking them', () => {
    const r = toSemanticRow(hit(), NAMES)
    expect(r?.zonesVisited).toEqual([])
    expect(r?.audioLabels).toEqual([])
    expect(r?.active).toBe(false)
  })

  it('falls back to the event id when the hit carries no track', () => {
    expect(toSemanticRow(hit({ trackId: undefined }), NAMES)?.trackId).toBe('evt-1')
  })

  it('returns null for a malformed row rather than throwing', () => {
    expect(toSemanticRow(null, NAMES)).toBeNull()
    expect(toSemanticRow(hit({ score: undefined }), NAMES)).toBeNull()
    expect(toSemanticRow(hit({ deviceId: '101' }), NAMES)).toBeNull()
    expect(toSemanticRow(hit({ className: '' }), NAMES)).toBeNull()
  })
})

describe('toSemanticRows', () => {
  it('DEDUPLICATES by track, keeping the best score', () => {
    // One person crossing the frame is many matching detections of one crop;
    // undeduplicated that reads as many events.
    const rows = toSemanticRows(
      [hit({ id: 'e1', score: 0.3 }), hit({ id: 'e2', score: 0.8 }), hit({ id: 'e3', score: 0.5 })],
      NAMES,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]?.bestEventId).toBe('trk-1')
  })

  it('orders by score DESC', () => {
    const rows = toSemanticRows(
      [
        hit({ id: 'a', trackId: 't1', score: 0.2 }),
        hit({ id: 'b', trackId: 't2', score: 0.9 }),
        hit({ id: 'c', trackId: 't3', score: 0.5 }),
      ],
      NAMES,
    )
    expect(rows.map((r) => r.trackId)).toEqual(['t2', 't3', 't1'])
  })

  it('breaks equal scores chronologically, newest first', () => {
    const rows = toSemanticRows(
      [
        hit({ id: 'a', trackId: 't1', score: 0.5, timestamp: 100 }),
        hit({ id: 'b', trackId: 't2', score: 0.5, timestamp: 300 }),
      ],
      NAMES,
    )
    expect(rows.map((r) => r.trackId)).toEqual(['t2', 't1'])
  })

  it('skips bad rows instead of emptying the result', () => {
    const rows = toSemanticRows([hit(), null, 42, hit({ trackId: 't2' })], NAMES)
    expect(rows).toHaveLength(2)
  })

  it('is total for a non-array payload', () => {
    expect(toSemanticRows(undefined, NAMES)).toEqual([])
    expect(toSemanticRows({ error: 'nope' }, NAMES)).toEqual([])
  })
})

describe('buildClassToMacro', () => {
  it('reads the server descriptors into kind → macro', () => {
    const map = buildClassToMacro([
      {
        deviceId: 101,
        kinds: [
          { kind: 'vehicle', parentKind: null },
          { kind: 'truck', parentKind: 'vehicle' },
          { kind: 'car', parentKind: 'vehicle' },
        ],
      },
    ])
    expect(macroOf('truck', map)).toBe('vehicle')
    expect(macroOf('car', map)).toBe('vehicle')
    // A macro is its own macro.
    expect(macroOf('vehicle', map)).toBe('vehicle')
  })

  it('merges the vocabularies of every camera', () => {
    const map = buildClassToMacro([
      { deviceId: 1, kinds: [{ kind: 'truck', parentKind: 'vehicle' }] },
      { deviceId: 2, kinds: [{ kind: 'dog', parentKind: 'animal' }] },
    ])
    expect(macroOf('truck', map)).toBe('vehicle')
    expect(macroOf('dog', map)).toBe('animal')
  })

  it('maps an UNKNOWN id to itself, which is what makes an empty map harmless', () => {
    expect(macroOf('truck', new Map())).toBe('truck')
  })

  it('is total for a hub too old to answer, or an error', () => {
    // A taxonomy that failed to load must NARROW the filter, never empty it.
    expect(buildClassToMacro(undefined).size).toBe(0)
    expect(buildClassToMacro({ error: 'NOT_FOUND' }).size).toBe(0)
    expect(buildClassToMacro([{ deviceId: 1 }]).size).toBe(0)
    expect(buildClassToMacro([{ deviceId: 1, kinds: [{ nope: true }] }]).size).toBe(0)
  })
})

describe('mergeSearchRows — a search result is ordered like the rest of the page', () => {
  const row = (
    trackId: string,
    lastSeen: number,
    over: Partial<EventsTrackRow> = {},
  ): EventsTrackRow => ({
    trackId,
    deviceId: 101,
    cameraName: 'Front Door',
    className: 'person',
    firstSeen: lastSeen,
    lastSeen,
    state: 'idle',
    active: false,
    zonesVisited: [],
    zoneNames: [],
    classes: ['person'],
    audioLabels: [],
    bestEventId: `evt-${trackId}`,
    ...over,
  })

  it('orders the WHOLE union newest first — never by CLIP score', () => {
    // The hub ranks by cosine similarity and the embed used to render that
    // order verbatim under a page whose sort control says "newest", with no
    // score on the card to explain it. Relevance decides WHICH rows come back
    // (`limit` + `minScore`); the page decides the order they are shown in.
    const merged = mergeSearchRows(
      // As the hub returns them: score DESC, which is not time order.
      [row('clip-hi', 1_000), row('clip-mid', 5_000), row('clip-lo', 3_000)],
      [row('text-1', 4_000)],
      'time',
    )
    expect(merged.map((r) => r.trackId)).toEqual(['clip-mid', 'text-1', 'clip-lo', 'clip-hi'])
  })

  it('shows a track that matched BOTH once, keeping the TEXT row', () => {
    // The text half is a real track row (zones, audio labels, the window); the
    // CLIP half is one event with those aggregates deliberately empty.
    const merged = mergeSearchRows(
      [row('both', 2_000)],
      [row('both', 2_000, { audioLabels: ['crying'] })],
      'time',
    )
    expect(merged).toHaveLength(1)
    expect(merged[0]?.audioLabels).toEqual(['crying'])
  })

  it('honours the page IMPORTANCE sort over the union, unscored rows last', () => {
    const merged = mergeSearchRows(
      [row('clip-1', 9_000), row('clip-2', 1_000, { importance: 90 })],
      [row('text-1', 2_000, { importance: 50 })],
      'importance',
    )
    expect(merged.map((r) => r.trackId)).toEqual(['clip-2', 'text-1', 'clip-1'])
  })

  it('ties on the same millisecond break deterministically, never at random', () => {
    const merged = mergeSearchRows([row('a', 7_000), row('b', 7_000)], [], 'time')
    expect(merged.map((r) => r.trackId)).toEqual(['b', 'a'])
  })

  it('still answers when either half is empty', () => {
    expect(mergeSearchRows([], [row('text-1', 1_000)], 'time').map((r) => r.trackId)).toEqual([
      'text-1',
    ])
    expect(mergeSearchRows([row('clip-1', 1_000)], [], 'time').map((r) => r.trackId)).toEqual([
      'clip-1',
    ])
    expect(mergeSearchRows([], [], 'time')).toEqual([])
  })

  it('does not mutate either input', () => {
    const clip = [row('clip-1', 1_000), row('clip-2', 9_000)]
    mergeSearchRows(clip, [], 'time')
    expect(clip.map((r) => r.trackId)).toEqual(['clip-1', 'clip-2'])
  })
})
