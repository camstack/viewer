import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { launchCoversViewer } from '../app-launch.js'
import { useAppStore } from '../app-store.js'
import { frameController } from '../frame-controller.js'
import { advanceFrameHistory, frameCanGoBack, startFrameHistory } from '../frame-history.js'

const src = (rel: string): string => readFileSync(join(__dirname, '..', '..', rel), 'utf8')

describe('frame history from the path events', () => {
  it('a new path is a step forward; the same path again changes nothing', () => {
    const h = advanceFrameHistory(advanceFrameHistory(startFrameHistory('/'), '/cameras'), '/cameras')
    expect(h).toEqual(['/', '/cameras'])
    expect(frameCanGoBack(h)).toBe(true)
  })
  it('the previous path coming back is the frame going back', () => {
    const h = advanceFrameHistory(['/', '/cameras'], '/')
    expect(h).toEqual(['/'])
    expect(frameCanGoBack(h)).toBe(false)
  })
  it('a fresh frame starts at its root', () => {
    expect(frameCanGoBack(startFrameHistory('/x'))).toBe(false)
  })
})

describe('the store carries the frame history', () => {
  beforeEach(() => useAppStore.setState({ framePath: null, frameHistory: [] }))
  it('ready starts it, path events extend and shrink it, leaving the app clears it', () => {
    const s = useAppStore.getState()
    s.setFramePath('/', true)
    s.setFramePath('/a')
    expect(useAppStore.getState().frameHistory).toEqual(['/', '/a'])
    s.setFramePath('/')
    expect(useAppStore.getState().frameHistory).toEqual(['/'])
    s.setFramePath('/b')
    useAppStore.getState().open({ appId: null })
    expect(useAppStore.getState().frameHistory).toEqual([])
  })
})

describe('the frame controller', () => {
  it('goes back through the attached frame, and says no when none is mounted', () => {
    expect(frameController.back()).toBe(false)
    const back = vi.fn()
    const release = frameController.attach(back)
    expect(frameController.back()).toBe(true)
    expect(back).toHaveBeenCalledTimes(1)
    release()
    expect(frameController.back()).toBe(false)
  })
})

describe('the top strip', () => {
  const strip = src('apps/AppTopStrip.tsx')
  it('goes back inside the frame first and only then falls back to the Cameras tab', () => {
    expect(strip).toMatch(/frameController\.back\(\)/)
    expect(strip).toMatch(/frameCanGoBack/)
    expect(strip).toMatch(/backOrCameras\(router\)/)
  })
  it('puts Back to the right of the menu button', () => {
    expect(strip.indexOf('testID="app-strip-menu"')).toBeGreaterThan(-1)
    expect(strip.indexOf('testID="app-strip-back"')).toBeGreaterThan(strip.indexOf('testID="app-strip-menu"'))
  })
  it('both frames register their back with the controller', () => {
    expect(src('apps/AppFrame.tsx')).toMatch(/frameController\.attach/)
    expect(src('apps/AppFrame.web.tsx')).toMatch(/frameController\.attach/)
  })
})

describe('boot does not paint the Viewer before the designated app', () => {
  it('covers the Viewer while the settings are unread or name an embedded app, until settled', () => {
    expect(launchCoversViewer({ hydrated: false, settled: false, preference: 'last', lastApp: null })).toBe(true)
    expect(launchCoversViewer({ hydrated: true, settled: false, preference: 'last', lastApp: 'admin' })).toBe(true)
    expect(launchCoversViewer({ hydrated: true, settled: false, preference: 'admin', lastApp: null })).toBe(true)
    expect(launchCoversViewer({ hydrated: true, settled: true, preference: 'admin', lastApp: null })).toBe(false)
  })
  it('a Viewer launch is never covered once the settings are read', () => {
    expect(launchCoversViewer({ hydrated: true, settled: false, preference: 'last', lastApp: null })).toBe(false)
  })
  it('the app store is hydrated by the prefs warmup, before the first render', () => {
    expect(src('app/prefs-warmup.ts')).toMatch(/useAppStore\.getState\(\)\.hydrate\(\)/)
  })
  it('AppHost renders the loader from the launch rule', () => {
    const host = src('apps/AppHost.tsx')
    expect(host).toMatch(/launchCoversViewer\(/)
    expect(host).toMatch(/testID="launch-loader"/)
  })
})
