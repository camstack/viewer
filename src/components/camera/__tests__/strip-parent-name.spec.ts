import { describe, it, expect } from 'vitest'
import { stripParentName } from '../strip-parent-name.js'

describe('stripParentName', () => {
  /**
   * REGRESSION. The previous implementation did `slice(parentName.length).trim()`,
   * which removes whitespace but NOT the em-dash a provider puts between the
   * container and its child. Ecowitt names children `"<Parent> — <Label>"`, so
   * the linked-devices row rendered a dangling "— gateway". The admin UI has
   * always tried `" — "` before the plain space; the viewer did not.
   */
  it('strips an em-dash separator without leaving the dash behind', () => {
    expect(stripParentName('Ecowitt Gateway — gateway', 'Ecowitt Gateway')).toBe('gateway')
  })

  it('strips a plain-space separator', () => {
    expect(stripParentName('Camera camera Carol Siren', 'Camera camera Carol')).toBe(
      'Siren',
    )
  })

  it('matches the parent case-insensitively — providers capitalise differently', () => {
    expect(stripParentName('CAMERA GARDEN Floodlight', 'Camera garden')).toBe(
      'Floodlight',
    )
  })

  it('returns the name verbatim when it does not carry the prefix', () => {
    expect(stripParentName('Sensore porta', 'Camera front door')).toBe('Sensore porta')
  })

  it('returns the name verbatim when stripping would leave nothing', () => {
    expect(stripParentName('Camera studio', 'Camera studio')).toBe('Camera studio')
  })

  it('returns the name verbatim without a parent name', () => {
    expect(stripParentName('Magicam PIR', undefined)).toBe('Magicam PIR')
    expect(stripParentName('Magicam PIR', '')).toBe('Magicam PIR')
  })

  /**
   * THE REPORTED BUG. The viewer shows a camera under the operator's local
   * rename, while the accessory's name was built server-side from the server
   * name. Passing only the rename matched nothing and the row read
   * "Camera front door Siren" in full.
   */
  it('falls back to the server name when the camera was renamed locally', () => {
    expect(stripParentName('Camera front door Siren', 'Front door', 'Camera front door')).toBe(
      'Siren',
    )
  })

  it('prefers the first candidate that matches', () => {
    expect(stripParentName('Front door Siren', 'Front door', 'Camera front door')).toBe('Siren')
  })

  it('returns the name verbatim when no candidate matches', () => {
    expect(stripParentName('Sirena esterna', 'Front door', 'Camera front door')).toBe(
      'Sirena esterna',
    )
  })

  it('skips undefined candidates instead of giving up on the rest', () => {
    expect(stripParentName('Camera front door Siren', undefined, 'Camera front door')).toBe(
      'Siren',
    )
  })

  it('does not strip a parent that is merely a prefix of a longer word', () => {
    // "Cam" must not turn "Camera esterna" into "era esterna": without a
    // separator after the parent, there is no child boundary to cut on.
    expect(stripParentName('Camera esterna', 'Cam')).toBe('Camera esterna')
  })
})
