import { describe, it, expect } from 'vitest'
import { buildVersionRows, describeRunningBundle } from '../version-info.js'

/**
 * The regression these guard is the 2026-07-30 report: the app displayed
 * 1.0.199 while the published bundle was 1.0.203. One string could not say
 * whether the update had failed to arrive or had arrived under a stale label.
 */
describe('describeRunningBundle', () => {
  it('says `embedded` when running the bundle inside the binary', () => {
    expect(
      describeRunningBundle({ isEmbeddedLaunch: true, updateId: 'aa644d9b-1dec-4426', updatesEnabled: true }),
    ).toBe('embedded')
  })

  it('names the running update by id and publish time when it is an OTA', () => {
    expect(
      describeRunningBundle({
        isEmbeddedLaunch: false,
        updateId: 'aa644d9b-1dec-4426-83e7-a0f34b1424d1',
        updateCreatedAt: new Date(2026, 6, 30, 14, 49),
        updatesEnabled: true,
      }),
    ).toBe('aa644d9b · 2026-07-30 14:49')
  })

  it('does NOT infer the running bundle from version strings', () => {
    // The incident: config version stale at 1.0.199 while an OTA of 1.0.203
    // is live. Identical strings must not make this read as `embedded`.
    expect(
      describeRunningBundle({
        configVersion: '1.0.199',
        runtimeVersion: '1.0.199',
        isEmbeddedLaunch: false,
        updateId: 'deadbeef-0000',
        updatesEnabled: true,
      }),
    ).toBe('deadbeef')
  })

  it('reads as `dev` when updates are disabled, instead of claiming embedded', () => {
    expect(describeRunningBundle({ updatesEnabled: false, isEmbeddedLaunch: true })).toBe('dev')
  })

  it('degrades to a dash when there is no update id at all', () => {
    expect(describeRunningBundle({ isEmbeddedLaunch: false, updatesEnabled: true })).toBe('—')
  })

  it('falls back to the bare id when the publish date is unusable', () => {
    expect(
      describeRunningBundle({
        isEmbeddedLaunch: false,
        updateId: 'abcdef12-3456',
        updateCreatedAt: new Date(Number.NaN),
        updatesEnabled: true,
      }),
    ).toBe('abcdef12')
  })
})

describe('buildVersionRows', () => {
  it('reports app, build, runtime and update as INDEPENDENT facts', () => {
    const rows = buildVersionRows({
      configVersion: '1.0.199',
      nativeBuildNumber: '14',
      runtimeVersion: '1.0.171',
      updateId: 'aa644d9b-1dec-4426-83e7-a0f34b1424d1',
      updateCreatedAt: new Date(2026, 6, 30, 14, 49),
      isEmbeddedLaunch: false,
      updatesEnabled: true,
    })

    expect(rows.map((r) => [r.id, r.value])).toEqual([
      ['app', '1.0.199'],
      ['build', '14'],
      ['runtime', '1.0.171'],
      ['update', 'aa644d9b · 2026-07-30 14:49'],
    ])
  })

  it('renders a dash for every value it does not have, never an empty row', () => {
    const rows = buildVersionRows({ updatesEnabled: true, isEmbeddedLaunch: true })
    expect(rows.map((r) => r.value)).toEqual(['—', '—', '—', 'embedded'])
  })
})

describe('the native-only facts are not shown where there is no native binary', () => {
  /**
   * The operator, looking at the Electron Viewer's Settings on macOS:
   *
   * > *"build, runtime e build in esecuzione non devono essere mostrati per il
   * > viewer electron, solo su build native no?"*
   *
   * He is right, and the screenshot is the argument: four rows in a row, every
   * one of them reading `—`. `build` is a native binary's build number,
   * `runtime` is the OTA compatibility pin, and `update` says WHICH bundle the
   * updater launched. The Electron shell has no native binary, no OTA channel
   * and no updater — so all three are not "unknown", they do not EXIST there,
   * and an em dash claims the first when the truth is the second. That is the
   * absent-vs-not-yet-known defect wearing a settings row.
   *
   * `app` stays: the bundle's declared version is a real fact everywhere, and
   * it is the one that answered his actual question (1.0.514, four OTAs behind
   * what the hub serves).
   */
  it('keeps only the app version off a native binary', () => {
    const rows = buildVersionRows({ configVersion: '1.0.514', nativeBinary: false })
    expect(rows.map((r) => r.id)).toEqual(['app'])
    expect(rows[0]?.value).toBe('1.0.514')
  })

  it('keeps all four on a native binary', () => {
    const rows = buildVersionRows({
      configVersion: '1.0.514',
      nativeBuildNumber: '42',
      runtimeVersion: '1.0.0',
      isEmbeddedLaunch: true,
      nativeBinary: true,
    })
    expect(rows.map((r) => r.id)).toEqual(['app', 'build', 'runtime', 'update'])
  })

  it('defaults to the native shape when nothing says otherwise', () => {
    // Absent must not silently hide rows on the platform that needs them: a
    // caller that forgets the flag is a phone showing one row, which is the
    // 2026-07-30 incident this whole module exists to prevent, reintroduced.
    expect(buildVersionRows({ configVersion: '1.0.514' }).map((r) => r.id)).toEqual([
      'app',
      'build',
      'runtime',
      'update',
    ])
  })
})
