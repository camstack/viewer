import { describe, it, expect } from 'vitest'
import {
  foldLegacyHighlight,
  highlightPatch,
  HIGHLIGHT_DETECTION_CLASSES,
  mostCommonLegacy,
  resolveHighlight,
} from '../highlight-global.js'
import { legacyHighlightsOf } from '../highlight-migration.js'
import { resetSettingsEntry, parseSettings } from '../settings-store.js'

const fresh = () => resetSettingsEntry().highlight

describe('the global highlight document (planning#751)', () => {
  it('detection is ON exactly when a label is selected', () => {
    expect(resolveHighlight(fresh()).detection).toBe(false)
    expect(resolveHighlight({ ...fresh(), detectionClasses: ['person'] }).detection).toBe(true)
  })

  it('switching detection on selects every class; off clears the selection', () => {
    expect(highlightPatch(fresh(), { detection: true }).detectionClasses).toEqual(HIGHLIGHT_DETECTION_CLASSES)
    const picked = { ...fresh(), detectionClasses: ['person'] }
    expect(highlightPatch(picked, { detection: true }).detectionClasses).toBeUndefined()
    expect(highlightPatch(picked, { detection: false }).detectionClasses).toEqual([])
  })

  it('the label vocabulary comes from the detector macro labels', () => {
    expect(HIGHLIGHT_DETECTION_CLASSES).toEqual(expect.arrayContaining(['person', 'vehicle', 'animal', 'face', 'plate']))
  })

  it('round-trips through the persisted settings document', () => {
    const doc = { ...resetSettingsEntry(), highlight: { ...fresh(), motion: false, audioDb: -42, detectionClasses: ['vehicle'] } }
    const back = parseSettings(JSON.stringify(doc)).highlight
    expect(back).toMatchObject({ motion: false, audioDb: -42, detectionClasses: ['vehicle'] })
  })
})

describe('the one-time fold of the per-camera highlight', () => {
  // A marker no default produces: if the fold drops it, the field was lost.
  const legacy = { motion: false, audio: 'level' as const, audioDb: -42, detectionHoldSec: 8, detection: true, detectionClasses: ['person'] }

  it('keeps the camera values in the global document and stamps it', () => {
    const next = foldLegacyHighlight(fresh(), [legacy], false)
    expect(next).toMatchObject({ motion: false, audio: 'level', audioDb: -42, detectionHoldSec: 8, detectionClasses: ['person'], rev: 1 })
  })

  it('a second run does not overwrite — the stamped document comes back untouched', () => {
    const once = foldLegacyHighlight(fresh(), [legacy], false)
    const edited = { ...once, audioDb: -10 }
    expect(foldLegacyHighlight(edited, [{ audioDb: -99 }], true)).toBe(edited)
  })

  it('detection on with no class meant ANY class: the selection says so', () => {
    expect(foldLegacyHighlight(fresh(), [{ detection: true, detectionClasses: [] }], false).detectionClasses).toEqual(
      HIGHLIGHT_DETECTION_CLASSES,
    )
  })

  it('detection off leaves no selection, whatever classes the camera kept', () => {
    expect(foldLegacyHighlight(fresh(), [{ detection: false, detectionClasses: ['person'] }], false).detectionClasses).toEqual([])
  })

  it('a master-off border starts all-off', () => {
    expect(foldLegacyHighlight(fresh(), [legacy], true)).toMatchObject({ motion: false, audio: 'off', detectionClasses: [] })
  })

  it('no stored camera highlight: defaults, stamped', () => {
    expect(foldLegacyHighlight(fresh(), [], false)).toEqual({ ...fresh(), rev: 1 })
  })

  it('adopts the most common stored highlight', () => {
    const a = { audioDb: -20 }
    const b = { audioDb: -50 }
    expect(mostCommonLegacy([a, b, b])).toEqual(b)
  })

  it('reads the highlight blobs out of a raw camera-prefs document', () => {
    const raw = { byId: { 9: { highlight: { audioDb: -42 } }, 3: { localName: 'x' }, 5: { highlight: { motion: false } } } }
    expect(legacyHighlightsOf(raw)).toEqual([{ motion: false }, { audioDb: -42 }])
    expect(legacyHighlightsOf(null)).toEqual([])
  })
})
