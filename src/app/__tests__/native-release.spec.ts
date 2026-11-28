import { describe, expect, it } from 'vitest'
import {
  compareVersions,
  isNativeRelease,
  nativeReleasePath,
  nativeReleaseState,
  storeUrlFor,
  type NativeRelease,
} from '../native-release.js'

const STORE_APP_ID = '1000000001'

const latest: NativeRelease = {
  version: '1.0.454',
  buildNumber: 16,
  runtimeVersion: '1.0.454',
  channel: 'testflight',
  publishedAt: '2026-09-06T14:41:52Z',
  storeAppId: STORE_APP_ID,
}

describe('nativeReleaseState — is the binary I run in the newest one?', () => {
  it('is unknown without a file or without knowing the running build', () => {
    expect(nativeReleaseState({ version: '1.0.374', buildNumber: 15 }, null)).toBe('unknown')
    expect(nativeReleaseState({ version: null, buildNumber: 15 }, latest)).toBe('unknown')
    expect(nativeReleaseState({ version: '1.0.374', buildNumber: undefined }, latest)).toBe('unknown')
  })
  it('says nothing for a release file that names no store app id (an app not yet listed)', () => {
    const { storeAppId: _omit, ...unlisted } = latest
    expect(nativeReleaseState({ version: '1.0.374', buildNumber: 15 }, unlisted)).toBe('unknown')
    expect(nativeReleaseState({ version: '1.0.374', buildNumber: 15 }, { ...unlisted, channel: 'play' })).toBe('newer-available')
  })
  it('the crashing 1.0.374 (15) sees 1.0.454 (16) as newer', () => {
    expect(nativeReleaseState({ version: '1.0.374', buildNumber: 15 }, latest)).toBe('newer-available')
  })
  it('the build the file names is up to date, whatever OTA version runs on it', () => {
    expect(nativeReleaseState({ version: '1.0.455', buildNumber: 16 }, latest)).toBe('up-to-date')
  })
  it('a higher build number of the same version is newer', () => {
    expect(nativeReleaseState({ version: '1.0.454', buildNumber: 16 }, { ...latest, buildNumber: 17 })).toBe('newer-available')
  })
})

describe('the file and the links', () => {
  it('validates the shape the release script writes', () => {
    expect(isNativeRelease(latest)).toBe(true)
    expect(isNativeRelease({ ...latest, buildNumber: '16' })).toBe(false)
    expect(isNativeRelease(null)).toBe(false)
  })
  it('compares versions numerically', () => {
    expect(compareVersions('1.0.455', '1.0.9')).toBe(1)
    expect(compareVersions('1.0.9', '1.0.455')).toBe(-1)
    expect(compareVersions('1.0.455', '1.0.455')).toBe(0)
  })
  it('opens TestFlight for a TestFlight build, the store otherwise, the market on Android', () => {
    expect(storeUrlFor(latest, 'ios', 'app.dominevo.viewer')).toBe('itms-beta://')
    expect(storeUrlFor({ ...latest, channel: 'appstore' }, 'ios', 'x')).toBe(`itms-apps://apps.apple.com/app/id${STORE_APP_ID}`)
    expect(storeUrlFor(latest, 'android', 'app.dominevo.viewer')).toBe('market://details?id=app.dominevo.viewer')
    expect(storeUrlFor(latest, 'web', 'x')).toBeNull()
  })
  it('is served under the viewer mount', () => {
    expect(nativeReleasePath('https://192.0.2.10:4443/')).toBe('https://192.0.2.10:4443/viewer/dominevo/native-release.json')
  })
})
