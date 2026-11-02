import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8')

/**
 * The three announcements the operator asked for (2026-09-06), held shut at
 * the source: the OTA gate ASKS before it restarts, the what's-new / native
 * build gate is mounted, Settings offers the notes and the native build row,
 * and the release script publishes the native build for the app to compare.
 */
describe('update announcements', () => {
  it('the update is announced through the Activity, never a modal: the launch modal is gone', () => {
    const root = read('../RootProviders.tsx')
    expect(root).toContain('<AppUpdateActivityBridge />')
    expect(root).not.toContain('OtaUpdateGate')
    expect(existsSync(new URL('../OtaUpdateGate.tsx', import.meta.url))).toBe(false)
    const bridge = read('../AppUpdateActivityBridge.tsx')
    expect(bridge).not.toContain('useConfirm')
    // useUpdates re-renders on every progress tick: it lives in a leaf that renders nothing.
    expect(bridge).toContain('Updates.useUpdates()')
    expect(bridge).toMatch(/return null/)
    expect(bridge).toContain("Platform.OS === 'web'")
  })
  it('the bridge writes only to the activity store, and the activity row restarts through the one door', () => {
    const bridge = read('../AppUpdateActivityBridge.tsx')
    expect(bridge).toContain('setAppUpdate')
    const present = read('../../activity/app-update-activity.ts')
    expect(present).toContain("reloadRuntimeForUpdate('activity')")
  })
  it("the what's new gate is mounted under the dialog and server providers", () => {
    const src = read('../RootProviders.tsx')
    expect(src.indexOf('<ConfirmProvider>')).toBeLessThan(src.indexOf('<WhatsNewGate />'))
    expect(src.indexOf('<ServerProvider>')).toBeLessThan(src.indexOf('<WhatsNewGate />'))
  })
  it('settings offer the notes and the native build', () => {
    const src = read('../../screens/settings/AppSegment.tsx')
    expect(src).toContain("t('v2.updates.whatsNewRow')")
    expect(src).toContain("t('v2.updates.nativeRow')")
    expect(src).toContain('handleOpenNativeRelease')
  })
  it('every restart drains native downloads first — a download landing on a dead runtime was the 1.0.454 (16) segfault', () => {
    for (const rel of ['../../activity/app-update-activity.ts', '../../screens/settings/AppSegment.tsx']) {
      expect(read(rel), rel).not.toContain('Updates.reloadAsync()')
    }
    expect(read('../../activity/app-update-activity.ts')).toContain('reloadRuntimeForUpdate(')
    const reload = read('../../lib/reload-runtime.ts')
    const quiesce = reload.indexOf('runtimeQuiesce.requestQuiesce()')
    const drain = reload.indexOf('runtimeQuiesce.waitForIdle(')
    const restart = reload.lastIndexOf('Updates.reloadAsync()')
    expect(quiesce).toBeGreaterThan(-1)
    expect(quiesce).toBeLessThan(drain)
    expect(drain).toBeLessThan(restart)
    const fs = read('../../data/snapshot-file-system.ts')
    expect(fs).toContain('runtimeQuiesce.admit()')
    expect(fs).toContain('runtimeQuiesce.begin()')
  })
  it('the release script publishes native-release.json and commits it', () => {
    const src = read('../../../scripts/release-ios.js')
    expect(src).toContain('public/native-release.json')
    expect(src).toContain('"public/native-release.json"]')
  })
})
