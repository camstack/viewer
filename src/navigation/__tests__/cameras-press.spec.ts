import { describe, expect, it } from 'vitest'
import { resolveCamerasPress } from '../cameras-press.js'

/**
 * "Se sono su una camera e premo cameras devo tornare alla lista; se vado su
 * grid e ripremo camera, vorrei tornare lì."
 *
 * Both halves, and the reason they are not in conflict: leaving a camera for
 * another tab is not finishing with it, but pressing the entry you are already
 * looking at is.
 */
describe('resolveCamerasPress', () => {
  it('takes you OUT of a camera, to the list', () => {
    expect(resolveCamerasPress('/camera/101', 101)).toEqual({ kind: 'list', forget: true })
  })

  it('forgets the camera on the way out, so the next press does not go back in', () => {
    const press = resolveCamerasPress('/camera/101', 101)
    expect(press).toMatchObject({ forget: true })
  })

  it('does nothing when the list is already what you are looking at', () => {
    expect(resolveCamerasPress('/cameras', null)).toEqual({ kind: 'noop' })
  })

  it('returns to the camera you never closed', () => {
    // From Grids, having left camera 101 without backing out of it.
    expect(resolveCamerasPress('/grids', 101)).toEqual({ kind: 'camera', href: '/camera/101' })
  })

  it('goes to the list when nothing is remembered', () => {
    expect(resolveCamerasPress('/grids', null)).toEqual({ kind: 'list', forget: false })
  })

  it('does NOT reopen after the operator left the camera deliberately', () => {
    // The gesture above cleared it, so this is the state that follows.
    expect(resolveCamerasPress('/cameras', null)).toEqual({ kind: 'noop' })
    expect(resolveCamerasPress('/settings', null)).toEqual({ kind: 'list', forget: false })
  })

  it('still takes you out when the remembered camera is a DIFFERENT one', () => {
    expect(resolveCamerasPress('/camera/101', 999)).toEqual({ kind: 'list', forget: true })
  })
})
