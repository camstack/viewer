/**
 * The accessory document rides `CameraPref.accessories`: applied through the
 * store's reducer, stored as absence when empty, and round-tripped by
 * `parseCameraPrefs` — so a saved profile carries it to the next phone.
 */
import { describe, expect, it } from 'vitest'
import {
  cameraAccessoryPrefs,
  parseCameraPrefs,
  resetCameraPrefsEntry,
  updateCameraAccessoriesEntry,
} from '../camera-prefs-store.js'
import {
  EMPTY_ACCESSORY_PREFS,
  addAccessoriesEntry,
  setAccessoryHiddenEntry,
  setAccessoryIconEntry,
  setAccessoryNameEntry,
} from '../../accessories/accessory-prefs.js'

describe('CameraPref.accessories', () => {
  it('a camera never customised reads as the empty document, and stores nothing', () => {
    const prefs = resetCameraPrefsEntry()
    expect(cameraAccessoryPrefs(prefs, 7)).toBe(EMPTY_ACCESSORY_PREFS)
    const same = updateCameraAccessoriesEntry(prefs, 7, (a) => a)
    expect(same.byId[7]).toBeUndefined()
  })

  it('reducers apply to the LATEST stored document, and the field is dropped when emptied', () => {
    let prefs = updateCameraAccessoriesEntry(resetCameraPrefsEntry(), 7, (a) => addAccessoriesEntry(a, [12]))
    prefs = updateCameraAccessoriesEntry(prefs, 7, (a) => setAccessoryNameEntry(a, 12, 'Fountain'))
    expect(cameraAccessoryPrefs(prefs, 7)).toEqual({ added: [12], order: [], byId: { 12: { name: 'Fountain' } } })
    prefs = updateCameraAccessoriesEntry(prefs, 7, () => EMPTY_ACCESSORY_PREFS)
    expect(prefs.byId[7]).toBeUndefined()
  })

  it('round-trips through the persisted JSON next to every other camera pref', () => {
    let prefs = updateCameraAccessoriesEntry(resetCameraPrefsEntry(), 7, (a) => addAccessoriesEntry(a, [12]))
    prefs = updateCameraAccessoriesEntry(prefs, 7, (a) => setAccessoryIconEntry(a, 500, 'flashlight'))
    prefs = updateCameraAccessoriesEntry(prefs, 7, (a) => setAccessoryHiddenEntry(a, 12, true))
    const parsed = parseCameraPrefs(JSON.stringify(prefs))
    expect(parsed).toEqual(prefs)
    expect(cameraAccessoryPrefs(parsed, 7)).toEqual({
      added: [12],
      order: [],
      byId: { 500: { icon: 'flashlight' }, 12: { hidden: true } },
    })
  })

  it('a corrupt accessories field degrades to absence without touching the rest', () => {
    const parsed = parseCameraPrefs(
      JSON.stringify({ byId: { 7: { localName: 'Garden', accessories: 'garbage' } }, order: [] }),
    )
    expect(parsed.byId[7]).toEqual({ localName: 'Garden' })
  })
})
