import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildTrackThumbUrl, clampThumbSize } from '../events-media-url'
import { buildKindLabels } from '../events-taxonomy'
import {
  applyTrackFlagPatches,
  filterRows,
  rowCaption,
  rowMatchesAttributes,
  rowMatchesClasses,
  rowMatchesSearch,
  resolveRowTitle,
  toEventsTrackRow,
  toEventsTrackRows,
} from '../events-track-row'

const NAMES = new Map<number, string>([
  [101, 'Front Door'],
  [102, 'Driveway'],
])

/** Normalise + resolve the title in one step — the title is no longer baked
 *  onto the row, so every assertion about it goes through the one rule. */
function titleOf(raw: unknown): string {
  const row = toEventsTrackRow(raw, NAMES)
  if (row === null) throw new Error('fixture: row did not normalise')
  return resolveRowTitle(row).text
}

const RAW = {
  trackId: 'trk-1',
  deviceId: 101,
  className: 'person',
  firstSeen: 1000,
  lastSeen: 2000,
  state: 'moving',
  active: true,
  zonesVisited: ['porch'],
  bestEventId: 'evt-1',
}

describe('toEventsTrackRow', () => {
  it('normalises a slim row and resolves the camera name', () => {
    const row = toEventsTrackRow(RAW, NAMES)
    expect(row).not.toBeNull()
    expect(row?.cameraName).toBe('Front Door')
    expect(row?.bestEventId).toBe('evt-1')
    expect(row?.active).toBe(true)
  })

  it('falls back to the numeric id rather than dropping a row for an unknown camera', () => {
    const row = toEventsTrackRow({ ...RAW, deviceId: 999 }, NAMES)
    expect(row?.cameraName).toBe('Camera 999')
  })

  it('falls back bestEventId → trackId (the media plane resolves both)', () => {
    const row = toEventsTrackRow({ ...RAW, bestEventId: undefined }, NAMES)
    expect(row?.bestEventId).toBe('trk-1')
  })

  it('shows the FINEST label: subLabel over label over class', () => {
    expect(titleOf({ ...RAW, label: 'dog' })).toBe('dog')
    expect(titleOf({ ...RAW, label: 'dog', subLabel: 'Canis lupus' })).toBe('Canis lupus')
    expect(titleOf(RAW)).toBe('person')
  })

  it('titles a SYNTHETIC track with its sensor TYPE, and carries the name beside it', () => {
    // The type is the projected event KIND (`className`), translated when the
    // host sent a dictionary. `Front Door Contact` is a `switch` here on
    // purpose: a title derived from the NAME would say `Front`, and this row is
    // the reason the derivation is a taxonomy lookup and not a string split.
    const row = toEventsTrackRow(
      { ...RAW, className: 'switch', producingDeviceName: 'Front Door Contact' },
      NAMES,
    )
    if (row === null) throw new Error('fixture: row did not normalise')

    const raw = resolveRowTitle(row)
    expect(raw.text).toBe('switch')
    expect(raw.tier).toBe('device')
    expect(raw.fullText).toBe('Front Door Contact')

    const translated = resolveRowTitle(row, buildKindLabels({ switch: 'Interruttore' }))
    expect(translated.text).toBe('Interruttore')
    // The NAME is never translated — it is a proper noun, like a tier-2 value.
    expect(translated.fullText).toBe('Front Door Contact')
  })

  it('always includes className in `classes`', () => {
    expect(toEventsTrackRow(RAW, NAMES)?.classes).toEqual(['person'])
    expect(toEventsTrackRow({ ...RAW, classes: ['vehicle'] }, NAMES)?.classes).toEqual([
      'person',
      'vehicle',
    ])
  })

  it('lifts distinct audio labels out of the aggregate array', () => {
    const row = toEventsTrackRow(
      {
        ...RAW,
        audioLabels: [
          { label: 'dog_bark', peakScore: 0.9, count: 3 },
          { label: 'dog_bark', peakScore: 0.8, count: 1 },
          { label: 'speech', peakScore: 0.7, count: 1 },
          { nope: 1 },
        ],
      },
      NAMES,
    )
    expect(row?.audioLabels).toEqual(['dog_bark', 'speech'])
  })

  it('returns null for a malformed row rather than throwing', () => {
    expect(toEventsTrackRow(null, NAMES)).toBeNull()
    expect(toEventsTrackRow({ ...RAW, trackId: '' }, NAMES)).toBeNull()
    expect(toEventsTrackRow({ ...RAW, deviceId: '101' }, NAMES)).toBeNull()
    expect(toEventsTrackRow({ ...RAW, lastSeen: undefined }, NAMES)).toBeNull()
  })

  it('skips bad rows in a page instead of emptying it', () => {
    const rows = toEventsTrackRows([RAW, null, { ...RAW, trackId: 'trk-2' }, 42], NAMES)
    expect(rows.map((r) => r.trackId)).toEqual(['trk-1', 'trk-2'])
  })

  it('is total for a non-array page', () => {
    expect(toEventsTrackRows(undefined, NAMES)).toEqual([])
  })
})

describe('filters', () => {
  const person = toEventsTrackRow(RAW, NAMES)
  const audio = toEventsTrackRow(
    {
      ...RAW,
      trackId: 'trk-a',
      className: 'motion',
      audioLabels: [{ label: 'dog_bark', peakScore: 0.9, count: 1 }],
    },
    NAMES,
  )
  if (person === null || audio === null) throw new Error('fixture')

  it('an empty selection matches everything', () => {
    expect(rowMatchesClasses(person, new Set())).toBe(true)
  })

  it('matches the audio vocabulary through the NAMESPACED id the picker emits', () => {
    // Audio labels are stored bare (`dog_bark`) and the taxonomy keys them
    // `audio-dog_bark`; the picker emits the namespaced form, or the bare
    // `audio` macro for the whole group. Both must hit.
    expect(rowMatchesClasses(audio, new Set(['audio-dog_bark']))).toBe(true)
    expect(rowMatchesClasses(audio, new Set(['audio']))).toBe(true)
    expect(rowMatchesClasses(audio, new Set(['person']))).toBe(false)
  })

  it('matches the accumulated classes, not just the current one', () => {
    const reclassified = toEventsTrackRow({ ...RAW, classes: ['vehicle'] }, NAMES)
    if (reclassified === null) throw new Error('fixture')
    expect(rowMatchesClasses(reclassified, new Set(['vehicle']))).toBe(true)
  })

  it('EXPANDS a macro selection to its subs through the taxonomy', () => {
    // The reported gap: selecting `vehicle` lost every `truck`. A track stores
    // the class it was detected as; the picker offers the family.
    const truck = toEventsTrackRow({ ...RAW, className: 'truck' }, NAMES)
    if (truck === null) throw new Error('fixture')
    const toMacro = new Map([
      ['truck', 'vehicle'],
      ['car', 'vehicle'],
      ['vehicle', 'vehicle'],
    ])
    expect(rowMatchesClasses(truck, new Set(['vehicle']), toMacro)).toBe(true)
    // …and the sub still matches itself.
    expect(rowMatchesClasses(truck, new Set(['truck']), toMacro)).toBe(true)
    // Expansion is UPWARD only — a truck is not a car.
    expect(rowMatchesClasses(truck, new Set(['car']), toMacro)).toBe(false)
    // Without the taxonomy it degrades to exact-id: narrower, never empty.
    expect(rowMatchesClasses(truck, new Set(['vehicle']))).toBe(false)
    expect(rowMatchesClasses(truck, new Set(['truck']))).toBe(true)
  })

  it('searches both label tiers, the class, the camera and audio labels', () => {
    const alice = toEventsTrackRow({ ...RAW, subLabel: 'Alice' }, NAMES)
    if (alice === null) throw new Error('fixture')
    expect(rowMatchesSearch(alice, 'ali')).toBe(true)
    expect(rowMatchesSearch(alice, 'PERSON')).toBe(true)
    expect(rowMatchesSearch(alice, 'front')).toBe(true)
    expect(rowMatchesSearch(audio, 'bark')).toBe(true)
    expect(rowMatchesSearch(alice, 'zzz')).toBe(false)
  })

  it('free text finds tier 2 — the identity, which is where names now live', () => {
    // Reading only tier 1 makes a box captioned "label / identity / plate"
    // match nothing when you type a person's name.
    const alice = toEventsTrackRow({ ...RAW, label: 'dog', subLabel: 'Alice' }, NAMES)
    if (alice === null) throw new Error('fixture')
    expect(rowMatchesSearch(alice, 'alice')).toBe(true)
    expect(rowMatchesSearch(alice, 'dog')).toBe(true)
  })

  it('free text expands a class to its FAMILY', () => {
    const truck = toEventsTrackRow({ ...RAW, className: 'truck' }, NAMES)
    if (truck === null) throw new Error('fixture')
    const toMacro = new Map([['truck', 'vehicle']])
    expect(rowMatchesSearch(truck, 'vehicle', toMacro)).toBe(true)
    expect(rowMatchesSearch(truck, 'vehicle')).toBe(false)
  })

  it('an empty needle matches everything', () => {
    expect(rowMatchesSearch(person, '   ')).toBe(true)
  })

  it('applies both filters in one pass', () => {
    expect(filterRows([person, audio], ['person'], '').map((r) => r.trackId)).toEqual(['trk-1'])
    expect(filterRows([person, audio], [], 'bark').map((r) => r.trackId)).toEqual(['trk-a'])
    expect(filterRows([person, audio], [], '')).toHaveLength(2)
  })
})

describe('operator flags on the slim row and the flag chips', () => {
  const debugRow = toEventsTrackRow({ ...RAW, trackId: 'trk-d', debug: true }, NAMES)
  const trainRow = toEventsTrackRow({ ...RAW, trackId: 'trk-t', markForTrain: true }, NAMES)
  const favRow = toEventsTrackRow({ ...RAW, trackId: 'trk-f', favourited: true }, NAMES)
  const plain = toEventsTrackRow(RAW, NAMES)

  it('emits a flag only when the slim row says true (absent ≠ false)', () => {
    expect(debugRow?.debug).toBe(true)
    expect(trainRow?.markForTrain).toBe(true)
    expect(favRow?.favourited).toBe(true)
    expect(plain?.debug).toBeUndefined()
    expect(plain?.markForTrain).toBeUndefined()
    expect(plain?.favourited).toBeUndefined()
    expect(toEventsTrackRow({ ...RAW, debug: false }, NAMES)?.debug).toBeUndefined()
  })

  it('an empty flag selection matches everything', () => {
    const rows = [debugRow!, trainRow!, favRow!, plain!]
    expect(filterRows(rows, [], '', undefined, [], {}).map((r) => r.trackId)).toEqual([
      'trk-d',
      'trk-t',
      'trk-f',
      'trk-1',
    ])
  })

  it('selected flags OR together and hide unflagged rows', () => {
    const rows = [debugRow!, trainRow!, favRow!, plain!]
    expect(
      filterRows(rows, [], '', undefined, [], { debug: true }).map((r) => r.trackId),
    ).toEqual(['trk-d'])
    expect(
      filterRows(rows, [], '', undefined, [], { debug: true, train: true }).map((r) => r.trackId),
    ).toEqual(['trk-d', 'trk-t'])
    expect(
      filterRows(rows, [], '', undefined, [], { favourited: true }).map((r) => r.trackId),
    ).toEqual(['trk-f'])
  })

  it('the debug chip hides a locally reviewed track even if the hub flag is still on', () => {
    const rows = [debugRow!, trainRow!, favRow!, plain!]
    expect(
      filterRows(rows, [], '', undefined, [], {
        debug: true,
        reviewedTrackIds: ['trk-d'],
      }).map((r) => r.trackId),
    ).toEqual([])
  })

  it('a live flag patch stamps already-loaded rows so the debug chip can see them', () => {
    // The feed does not refetch a row whose lastSeen has not moved. A write
    // made in the host detail therefore never reached the card or the chip
    // until something else happened to replace the row.
    const stamped = applyTrackFlagPatches([plain!], {
      [plain!.trackId]: { debug: true, markForTrain: false, favourited: false },
    })
    expect(stamped[0]?.debug).toBe(true)
    expect(
      filterRows(stamped, [], '', undefined, [], { debug: true }).map((r) => r.trackId),
    ).toEqual([plain!.trackId])
  })

  it('clearing a flag drops it back to absent, not false', () => {
    const stamped = applyTrackFlagPatches([debugRow!], {
      [debugRow!.trackId]: { debug: false, markForTrain: false, favourited: false },
    })
    expect(stamped[0]?.debug).toBeUndefined()
  })
})

/**
 * Every fixture below carries a string OBSERVED on the live hub on 2026-08-09,
 * verbatim — the audio classifier's own vocabulary (`crying`, `glass_breaking`)
 * and camera 101's two zone names (`Uscio`, `Aiuola`). An invented tidy label
 * would have hidden both defects these tests exist for: the underscore, and the
 * fact that `zonesVisited` holds ZONE IDS, never names.
 */
describe('free text reads every useful textual field of a track', () => {
  const crying = toEventsTrackRow(
    { ...RAW, className: 'person', audioLabels: [{ label: 'speech' }, { label: 'crying' }] },
    NAMES,
  )
  const glass = toEventsTrackRow(
    { ...RAW, trackId: 'trk-g', audioLabels: [{ label: 'glass_breaking' }] },
    NAMES,
  )
  if (crying === null || glass === null) throw new Error('fixture')

  it('finds an audio label by the WORD a human types (cry → crying)', () => {
    // 92 tracks carried `crying` in the 7 days before this was written.
    expect(rowMatchesSearch(crying, 'cry')).toBe(true)
    expect(rowMatchesSearch(crying, 'crying')).toBe(true)
    expect(rowMatchesSearch(crying, 'CRY')).toBe(true)
  })

  it('finds a MULTI-WORD audio label typed with a space, not an underscore', () => {
    // Nobody types `glass_breaking`. The classifier emits nothing else.
    expect(rowMatchesSearch(glass, 'glass breaking')).toBe(true)
    expect(rowMatchesSearch(glass, 'glass_breaking')).toBe(true)
    expect(rowMatchesSearch(glass, 'breaking')).toBe(true)
  })

  it('finds a track by ZONE NAME', () => {
    // `zonesVisited` on the wire is `['cfeec78c-…','fa03b60a-…']` — the names
    // live on the `zones` cap and are stamped onto the row server-side.
    const zoned = toEventsTrackRow(
      {
        ...RAW,
        zonesVisited: ['cfeec78c-8d69-4678-9d25-937193eacb5d'],
        zoneNames: ['Uscio'],
      },
      NAMES,
    )
    if (zoned === null) throw new Error('fixture')
    expect(zoned.zoneNames).toEqual(['Uscio'])
    expect(rowMatchesSearch(zoned, 'uscio')).toBe(true)
    expect(rowMatchesSearch(zoned, 'Usc')).toBe(true)
  })

  it('never offers a raw zone ID as a search token', () => {
    // A UUID is not a word a human types, and matching one would let a stray
    // hex needle return an arbitrary slice of the feed.
    const zoned = toEventsTrackRow(
      { ...RAW, zonesVisited: ['cfeec78c-8d69-4678-9d25-937193eacb5d'] },
      NAMES,
    )
    if (zoned === null) throw new Error('fixture')
    expect(rowMatchesSearch(zoned, 'cfeec78c')).toBe(false)
  })

  it('still refuses a needle nothing carries', () => {
    expect(rowMatchesSearch(crying, 'zzz')).toBe(false)
    expect(rowMatchesSearch(glass, 'siren')).toBe(false)
  })
})

describe('rowCaption — only what the thumbnail does NOT say', () => {
  const THUMBNAIL = true
  const NO_THUMBNAIL_LABELS = false

  it('says NOTHING when the thumbnail is carrying the labels', () => {
    // The three redundancies the operator caught on the live gallery.
    const audio = toEventsTrackRow(
      {
        ...RAW,
        className: 'motion',
        audioLabels: [{ label: 'speech' }, { label: 'music' }],
      },
      NAMES,
    )
    const vehicle = toEventsTrackRow({ ...RAW, className: 'vehicle', label: 'Car' }, NAMES)
    const identity = toEventsTrackRow({ ...RAW, subLabel: 'Dave' }, NAMES)
    if (audio === null || vehicle === null || identity === null) throw new Error('fixture')

    // (a) glyphs speech+music, and the caption used to transcribe them.
    expect(rowCaption(audio, THUMBNAIL, titleOf({ ...RAW, className: 'motion' }))).toBe('')
    // (b) `car` glyph + `Car` pill, and the caption used to add the COARSER
    //     `vehicle` underneath.
    expect(rowCaption(vehicle, THUMBNAIL, 'Car')).toBe('')
    // (c) `Dave` pill beside a person glyph, and the caption said `person`.
    expect(rowCaption(identity, THUMBNAIL, 'Dave')).toBe('')
  })

  it('becomes the ONLY carrier when the thumbnail shows no labels', () => {
    // `fields.label:false, fields.sublabel:true` is a real combination — no
    // chips on the image, but give me a text line.
    const identity = toEventsTrackRow({ ...RAW, label: 'dog', subLabel: 'Rex' }, NAMES)
    if (identity === null) throw new Error('fixture')
    expect(rowCaption(identity, NO_THUMBNAIL_LABELS, 'Rex')).toBe('Rex')
  })

  it('adds audio labels only when they say something the title does not', () => {
    const row = toEventsTrackRow(
      {
        ...RAW,
        className: 'motion',
        audioLabels: [{ label: 'speech' }, { label: 'music' }],
      },
      NAMES,
    )
    if (row === null) throw new Error('fixture')
    expect(rowCaption(row, NO_THUMBNAIL_LABELS, 'motion')).toBe('motion · speech · music')
  })

  it('never repeats the title as an audio label', () => {
    const row = toEventsTrackRow(
      { ...RAW, className: 'dog', audioLabels: [{ label: 'dog' }] },
      NAMES,
    )
    if (row === null) throw new Error('fixture')
    expect(rowCaption(row, NO_THUMBNAIL_LABELS, 'dog')).toBe('dog')
  })
})

describe('event-media URLs', () => {
  it('asks the OWNER form for a track — never a bare id (D482)', () => {
    const url = buildTrackThumbUrl('https://hub:4443/', 'trk-1', 192)
    expect(url).toBe(
      'https://hub:4443/addon/pipeline-analytics/event-media/o/track/trk-1?kind=thumbnailSmall&variant=thumb&size=192',
    )
    expect(url).toContain('kind=thumbnailSmall')
  })

  it('percent-encodes the trackId — it is an arbitrary owner id, not a UUID guarantee', () => {
    expect(buildTrackThumbUrl('https://hub', 'a/b', 192)).toContain('/o/track/a%2Fb')
  })

  /**
   * EVERY caller addresses the TRACK. `bestEventId` is an object-event id —
   * an opaque pointer this feed carries for the host, never an address
   * (`events-semantic.ts`, D482) — and `/o/track/<eventId>` is a 404 by
   * construction: measured on the live hub 2026-09-13, `/o/track/107461`
   * answered 404 while `/o/object/107461` answered 200.
   *
   * The card always did this correctly; the PRELOAD did not, and because the
   * blob cache is keyed by url the two halves never agreed on a single tile.
   * Source text rather than a call, because the defect was a wrong FIELD at a
   * right call — nothing about the signature could catch it.
   */
  it('and no surface mints a thumb url from bestEventId', () => {
    const root = process.cwd()
    for (const rel of ['embed/src/pages/EmbedEventsPage.tsx', 'embed/src/components/EventsCard.tsx']) {
      const src = readFileSync(join(root, rel), 'utf8')
      for (const line of src.split('\n')) {
        if (!line.includes('buildTrackThumbUrl(')) continue
        expect(line, `${rel}: ${line.trim()}`).not.toContain('bestEventId')
      }
    }
  })

  it('clamps to the range the plane accepts, so one rendering is one URL', () => {
    expect(clampThumbSize(10)).toBe(64)
    expect(clampThumbSize(9999)).toBe(320)
    expect(clampThumbSize(Number.NaN)).toBe(64)
    expect(buildTrackThumbUrl('https://hub', 'e', 5000)).toContain('size=320')
  })
})

describe('face / plate attributes', () => {
  // The strict flag, written by a hub that has the gallery-insert mark deployed.
  const embedded = { ...RAW, trackId: 'trk-embedded', hasEmbeddedFace: true }
  // Detected and nothing more — the four-out-of-five case the first release
  // shipped and the operator rejected. Must NOT match.
  const detectedOnly = { ...RAW, trackId: 'trk-detected', hasFace: true }
  // Recognised: assignable by construction, and the interim signal for history.
  const recognised = {
    ...RAW,
    trackId: 'trk-named',
    hasFace: true,
    subLabel: 'Anna',
    subLabelMeta: { stepId: 'face-recognizer', decidedAt: 1500 },
  }
  // The step the fleet ACTUALLY stamps on a plate — the empty-chip bug.
  const plate = {
    ...RAW,
    trackId: 'trk-plate',
    className: 'vehicle',
    subLabel: 'VONND9592',
    subLabelMeta: { stepId: 'plate-detection', modelId: 'vgg-english-g2', decidedAt: 1500 },
  }
  const leafPlate = {
    ...RAW,
    trackId: 'trk-plate-leaf',
    className: 'vehicle',
    subLabel: 'AB123CD',
    subLabelMeta: { stepId: 'plate-ocr', decidedAt: 1500 },
  }
  const operatorPlate = {
    ...RAW,
    trackId: 'trk-vehicle',
    className: 'vehicle',
    subLabel: 'Marco',
    subLabelMeta: { stepId: 'operator:plate-gallery', decidedAt: 1500 },
  }

  it('a DETECTED face is not an assignable one', () => {
    // `hasFace` is stamped before every gate: 399 of 1160 live tracks carry it
    // and only 100 have a gallery row. The chip promises "assignable".
    const row = toEventsTrackRow(detectedOnly, NAMES)
    expect(row?.hasAssignableFace).toBeUndefined()
    expect(filterRows([row!], [], '', undefined, ['face'])).toHaveLength(0)
  })

  it('the persisted gallery mark makes it assignable', () => {
    expect(toEventsTrackRow(embedded, NAMES)?.hasAssignableFace).toBe(true)
  })

  it('a RECOGNISED face is assignable — the interim signal for history', () => {
    expect(toEventsTrackRow(recognised, NAMES)?.hasAssignableFace).toBe(true)
  })

  it('leaves it ABSENT when the hub never said — never false', () => {
    const row = toEventsTrackRow(RAW, NAMES)
    expect(row?.hasAssignableFace).toBeUndefined()
    expect('hasAssignableFace' in (row ?? {})).toBe(false)
  })

  it('matches the plate step the fleet actually stamps', () => {
    // The whole of problem 2: the mirror listed only the OCR leaf, and the
    // writer attributes the label to the subtree ROOT.
    expect(toEventsTrackRow(plate, NAMES)?.hasPlate).toBe(true)
  })

  it('accepts the leaf and the operator spellings too', () => {
    expect(toEventsTrackRow(leafPlate, NAMES)?.hasPlate).toBe(true)
    expect(toEventsTrackRow(operatorPlate, NAMES)?.hasPlate).toBe(true)
  })

  it('a recognised FACE is not a plate, however tier-2 it is', () => {
    expect(toEventsTrackRow(recognised, NAMES)?.hasPlate).toBeUndefined()
  })

  describe('hasUnassignedFace — the "?" badge predicate', () => {
    it('an embedded face with NO identity is unassigned — the badge case', () => {
      expect(toEventsTrackRow(embedded, NAMES)?.hasUnassignedFace).toBe(true)
    })

    it('a recognised identity is NOT unassigned — the name pill already says it', () => {
      const named = {
        ...embedded,
        subLabel: 'Anna',
        subLabelMeta: { stepId: 'face-recognizer', decidedAt: 1500 },
      }
      expect(toEventsTrackRow(named, NAMES)?.hasUnassignedFace).toBeUndefined()
    })

    it('an operator-assigned identity clears the badge too', () => {
      const assigned = {
        ...embedded,
        subLabel: 'Marco',
        subLabelMeta: { stepId: 'operator:face-gallery', decidedAt: 1500 },
      }
      expect(toEventsTrackRow(assigned, NAMES)?.hasUnassignedFace).toBeUndefined()
    })

    it('a merely DETECTED face is not assignable, so not unassigned either', () => {
      const row = toEventsTrackRow(detectedOnly, NAMES)
      expect(row?.hasUnassignedFace).toBeUndefined()
    })

    it('a recognition-only row (history, no gallery mark) is already named', () => {
      expect(toEventsTrackRow(recognised, NAMES)?.hasUnassignedFace).toBeUndefined()
    })

    it('an embedded face beside a NON-face tier-2 label still asks for a name', () => {
      const withSpecies = {
        ...embedded,
        subLabel: 'Canis lupus',
        subLabelMeta: { stepId: 'species-classifier', decidedAt: 1500 },
      }
      expect(toEventsTrackRow(withSpecies, NAMES)?.hasUnassignedFace).toBe(true)
    })

    it('leaves it ABSENT when the hub never said — never false', () => {
      const row = toEventsTrackRow(RAW, NAMES)
      expect(row?.hasUnassignedFace).toBeUndefined()
      expect('hasUnassignedFace' in (row ?? {})).toBe(false)
    })
  })

  it('an unknown attribution step is neither', () => {
    const raw = { ...RAW, subLabelMeta: { stepId: 'species-classifier', decidedAt: 1 } }
    const row = toEventsTrackRow(raw, NAMES)
    expect(row?.hasPlate).toBeUndefined()
    expect(row?.hasAssignableFace).toBeUndefined()
  })

  it('an EMPTY selection matches everything', () => {
    const row = toEventsTrackRow(RAW, NAMES)
    expect(row).not.toBeNull()
    if (row !== null) expect(rowMatchesAttributes(row, new Set())).toBe(true)
  })

  it('selected attributes OR — a track with either is kept', () => {
    const rows = toEventsTrackRows([RAW, detectedOnly, embedded, plate], NAMES)
    expect(filterRows(rows, [], '', undefined, ['face']).map((r) => r.trackId)).toEqual([
      'trk-embedded',
    ])
    expect(filterRows(rows, [], '', undefined, ['plate']).map((r) => r.trackId)).toEqual([
      'trk-plate',
    ])
    expect(filterRows(rows, [], '', undefined, ['face', 'plate']).map((r) => r.trackId)).toEqual([
      'trk-embedded',
      'trk-plate',
    ])
  })

  it('ANDs with the class filter — vehicles WITH a plate', () => {
    const rows = toEventsTrackRows([embedded, plate], NAMES)
    expect(filterRows(rows, ['person'], '', undefined, ['plate'])).toHaveLength(0)
    expect(filterRows(rows, ['vehicle'], '', undefined, ['plate']).map((r) => r.trackId)).toEqual([
      'trk-plate',
    ])
  })

  it('ANDs with free text', () => {
    const rows = toEventsTrackRows([plate], NAMES)
    expect(filterRows(rows, [], 'VONND', undefined, ['plate'])).toHaveLength(1)
    expect(filterRows(rows, [], 'nothing', undefined, ['plate'])).toHaveLength(0)
  })
})
