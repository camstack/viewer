/**
 * planning#751 — the detection trigger is a label multiselect, and an old
 * stored value maps onto it without loss.
 */
import { describe, expect, it } from 'vitest'
import {
  classesForEditor,
  classesFromEditor,
  matchesDetectionClass,
} from '../highlight-classes.js'
import { HIGHLIGHT_DETECTION_CLASSES as DETECTION_MACRO_CLASSES } from '../highlight-classes.js'
import { withHighlightDefaults } from '../../src/store/grid-store.js'
import { parseCameraPrefs } from '../../src/store/camera-prefs-store.js'

describe('stored detection classes ↔ the multiselect', () => {
  it('"detection on, any class" (stored empty) shows every class ticked', () => {
    expect(classesForEditor([])).toEqual([...DETECTION_MACRO_CLASSES])
  })

  it('a stored subset is shown as is, and written back as is', () => {
    expect(classesForEditor(['person', 'plate'])).toEqual(['person', 'plate'])
    expect(classesFromEditor(['person', 'plate'])).toEqual(['person', 'plate'])
  })

  it('every class ticked is stored as "any", so it survives a round trip', () => {
    expect(classesFromEditor([...DETECTION_MACRO_CLASSES])).toEqual([])
    expect(classesFromEditor(classesForEditor([]))).toEqual([])
  })

  it('all ticked, or the old "any", matches a class outside the list', () => {
    expect(matchesDetectionClass([], 'boat')).toBe(true)
    expect(matchesDetectionClass([...DETECTION_MACRO_CLASSES], 'boat')).toBe(true)
    expect(matchesDetectionClass(['person'], 'boat')).toBe(false)
    expect(matchesDetectionClass(['person'], 'person')).toBe(true)
  })

  it('a marked stored value reaches the editor unchanged (no loss)', () => {
    const prefs = parseCameraPrefs(
      JSON.stringify({
        byId: {
          7: { highlight: { detection: true, detectionClasses: ['vehicle'], detectionHoldSec: 8, audioDb: -42 } },
        },
        order: [],
      }),
    )
    const h = withHighlightDefaults(prefs.byId[7]?.highlight)
    expect(h.detection).toBe(true)
    expect(classesForEditor(h.detectionClasses)).toEqual(['vehicle'])
    expect(h.audioDb).toBe(-42)
  })
})
