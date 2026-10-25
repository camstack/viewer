/**
 * "Reopen the last camera": what is remembered, what clears it, and the two
 * edge cases the operator asked to be handled rather than discovered in
 * production.
 */
import { describe, it, expect } from 'vitest'

import {
  cameraRoute,
  lastCameraEffectFor,
  resolveReopenLastCamera,
  type ReopenCandidate,
  type ReopenLastCameraInput,
} from '../last-camera.js'

describe('what a navigation does to the memory', () => {
  it('going to a single stream remembers that camera', () => {
    expect(lastCameraEffectFor('/camera/102')).toEqual({ kind: 'remember', deviceId: 102 })
  })

  it('switching camera remembers the NEW one', () => {
    // The camera switcher does `router.replace('/camera/<id>')` on the same
    // route; the memory follows the picture, not the first arrival.
    expect(lastCameraEffectFor('/camera/5')).toEqual({ kind: 'remember', deviceId: 5 })
  })

  it('every other page KEEPS it — leaving is not finishing', () => {
    // Revised 2026-09-04. This used to assert CLEAR, described as "the whole
    // semantics", and it was: navigating to Grids threw the value away, so
    // pressing Cameras afterwards could never return the operator to the
    // camera they had been watching. Clearing is now a deliberate gesture —
    // backing out, or pressing Cameras while already on a camera — see
    // `cameras-press.ts`.
    for (const path of [
      '/cameras',
      '/events',
      '/grids',
      '/grid/2',
      '/settings',
      '/settings/cameras',
      '/notifications',
      '/',
    ]) {
      expect(lastCameraEffectFor(path), path).toEqual({ kind: 'keep' })
    }
  })

  it('and a camera path this app never produces clears rather than remembering', () => {
    // Remembering an id the launch could not open is worse than remembering
    // nothing: it spends the whole startup budget to arrive at `camera-gone`.
    for (const path of ['/camera/abc', '/camera/', '/camera/1/edit', '/camera/-3', '/camera/0']) {
      expect(lastCameraEffectFor(path), path).toEqual({ kind: 'clear' })
    }
  })

  it('the route it writes is the route the launch opens', () => {
    const effect = lastCameraEffectFor(cameraRoute(42))
    expect(effect).toEqual({ kind: 'remember', deviceId: 42 })
  })
})

const CAMERAS: readonly ReopenCandidate[] = [
  { id: 1, disabled: false },
  { id: 5, disabled: false },
  { id: 9, disabled: true },
]

/** A launch that is ready to reopen camera 5 — each test spoils one thing. */
function ready(patch: Partial<ReopenLastCameraInput> = {}): ReopenLastCameraInput {
  return {
    enabled: true,
    settingsHydrated: true,
    memoryHydrated: true,
    startupDeviceId: 5,
    cameras: CAMERAS,
    pathname: '/cameras',
    ...patch,
  }
}

describe('the launch decision', () => {
  it('reopens the remembered camera when everything lines up', () => {
    expect(resolveReopenLastCamera(ready())).toEqual({ action: 'reopen', deviceId: 5 })
  })

  it('does nothing with the setting off — the default, and the shipped launch', () => {
    expect(resolveReopenLastCamera(ready({ enabled: false }))).toEqual({
      action: 'skip',
      reason: 'setting-off',
    })
  })

  it('does nothing when the last page was not a camera', () => {
    expect(resolveReopenLastCamera(ready({ startupDeviceId: null }))).toEqual({
      action: 'skip',
      reason: 'nothing-remembered',
    })
  })

  // "At most once per launch" is the BRIDGE's job — this rule deliberately has
  // no memory of being asked (see its docblock, and `last-camera-bridge.spec.ts`
  // for the claim itself).

  it('never pulls the operator off a destination they already reached', () => {
    // A notification tap resolves through `pending-deep-link.ts` before this
    // runs; the remembered camera must not then yank them somewhere else.
    expect(resolveReopenLastCamera(ready({ pathname: '/events' }))).toEqual({
      action: 'skip',
      reason: 'left-the-landing-route',
    })
    expect(resolveReopenLastCamera(ready({ pathname: '/camera/9' }))).toEqual({
      action: 'skip',
      reason: 'left-the-landing-route',
    })
  })
})

describe('the two edge cases, handled rather than discovered in production', () => {
  it('a camera that no longer exists degrades to the normal launch', () => {
    expect(resolveReopenLastCamera(ready({ startupDeviceId: 404 }))).toEqual({
      action: 'skip',
      reason: 'camera-gone',
    })
  })

  it('a DISABLED camera degrades to the normal launch', () => {
    // It is in the list, so "gone" would be the wrong answer and opening it
    // would be a player with nothing behind it.
    expect(resolveReopenLastCamera(ready({ startupDeviceId: 9 }))).toEqual({
      action: 'skip',
      reason: 'camera-disabled',
    })
  })

  it('an empty camera list is an ANSWER, and it means gone', () => {
    expect(resolveReopenLastCamera(ready({ cameras: [] }))).toEqual({
      action: 'skip',
      reason: 'camera-gone',
    })
  })
})

describe('unknown is never mistaken for absent', () => {
  it('waits while the camera list has not answered', () => {
    // The distinction that `(data ?? [])` destroys: a hub that is a beat slow
    // must not look like a camera that was deleted.
    expect(resolveReopenLastCamera(ready({ cameras: undefined }))).toEqual({ action: 'wait' })
  })

  it('waits while the settings have not been read off disk', () => {
    // Before hydration the settings ARE the defaults, i.e. the setting reads
    // OFF — indistinguishable from the operator having turned it off.
    expect(resolveReopenLastCamera(ready({ settingsHydrated: false }))).toEqual({ action: 'wait' })
  })

  it('waits while the remembered camera has not been read off disk', () => {
    expect(resolveReopenLastCamera(ready({ memoryHydrated: false }))).toEqual({ action: 'wait' })
  })

  it('but a settled `skip` outranks waiting: the cheap questions come first', () => {
    // With the setting off there is nothing to wait FOR, and a launch that
    // blocked on the camera list to answer a question it did not need would be
    // paying for a feature nobody switched on.
    expect(resolveReopenLastCamera(ready({ enabled: false, cameras: undefined }))).toEqual({
      action: 'skip',
      reason: 'setting-off',
    })
    expect(
      resolveReopenLastCamera(ready({ startupDeviceId: null, cameras: undefined })),
    ).toEqual({ action: 'skip', reason: 'nothing-remembered' })
  })
})
