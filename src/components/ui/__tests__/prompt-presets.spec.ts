/**
 * The preset checkboxes on a prompt: what ticking one does to the text the
 * operator ends up sending.
 *
 * The rules under test are all about ONE thing — the note stays a single
 * string. A preset is a canned PHRASE inserted into that string, never a
 * parallel structure the server would have to learn about, so a note written
 * by hand and a note built from checkboxes are the same value on the wire.
 */
import { describe, expect, it } from 'vitest'

import { presetSelected, togglePreset } from '../prompt-presets.js'

const CROP = 'No subject crop'
const LATE = 'Track started late'

describe('togglePreset', () => {
  it('adds the phrase to an empty note', () => {
    expect(togglePreset('', CROP, true)).toBe(CROP)
  })

  it('appends to an existing note without eating it', () => {
    expect(togglePreset('the dog by the gate', CROP, true)).toBe(`the dog by the gate · ${CROP}`)
  })

  it('removes exactly its own phrase and leaves the rest', () => {
    const both = togglePreset(togglePreset('', CROP, true), LATE, true)
    expect(both).toBe(`${CROP} · ${LATE}`)
    expect(togglePreset(both, CROP, false)).toBe(LATE)
    expect(togglePreset(both, LATE, false)).toBe(CROP)
  })

  it('keeps the operator\'s own words when a preset is removed', () => {
    const note = togglePreset('and External hub saw it', CROP, true)
    expect(togglePreset(note, CROP, false)).toBe('and External hub saw it')
  })

  it('never adds the same phrase twice', () => {
    const once = togglePreset('', CROP, true)
    expect(togglePreset(once, CROP, true)).toBe(once)
  })

  it('removing a phrase that is not there changes nothing', () => {
    expect(togglePreset('free text', CROP, false)).toBe('free text')
  })
})

describe('presetSelected', () => {
  it('ticks the boxes an existing note already contains — reopening an edit', () => {
    const note = `${CROP} · the dog by the gate`
    expect(presetSelected(note, CROP)).toBe(true)
    expect(presetSelected(note, LATE)).toBe(false)
  })

  it('does not tick on a partial word match', () => {
    // "No subject cropping issues" is not the preset, and a substring test
    // would tick a box the operator never pressed — then UNTICKING it would
    // cut a hole in their sentence.
    expect(presetSelected('No subject cropping issues', CROP)).toBe(false)
  })

  it('an empty note has nothing ticked', () => {
    expect(presetSelected('', CROP)).toBe(false)
  })
})
