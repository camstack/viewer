import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { shouldHoldWakeLock } from '../use-screen-wake-lock.web.js'

/**
 * A live picture on screen holds a screen wake lock — on web.
 *
 * Native keeps the screen on through the video/audio session
 * (`UIBackgroundModes: ['audio']`). In a PWA the picture is a muted WebRTC
 * `<video>` inside an iframe, which does not reliably inhibit auto-lock: a
 * camera watched for longer than the auto-lock timeout went dark. iOS 16.4+
 * and Chrome expose `navigator.wakeLock.request('screen')`, and Safari
 * releases the lock itself when the page hides — so the hook must re-request
 * on `visibilitychange`, not only on mount.
 *
 * The gate is pure and tested for real; the hook's wiring (both web hosts
 * mount it, the three lifecycle points, never throwing) is pinned by source
 * assertions because vitest runs `node` here, with no renderer.
 */

const SRC = join(process.cwd(), 'src')
const read = (rel: string): string => readFileSync(join(SRC, rel), 'utf8')

describe('shouldHoldWakeLock', () => {
  it('holds only while mounted, visible and supported', () => {
    expect(shouldHoldWakeLock({ mounted: true, visible: true, supported: true })).toBe(true)
  })

  it('never holds after unmount — the picture is gone', () => {
    expect(shouldHoldWakeLock({ mounted: false, visible: true, supported: true })).toBe(false)
  })

  it('never holds while hidden — a request there is refused by the browser anyway', () => {
    expect(shouldHoldWakeLock({ mounted: true, visible: false, supported: true })).toBe(false)
  })

  it('never holds without the API — older iOS, an insecure origin', () => {
    expect(shouldHoldWakeLock({ mounted: true, visible: true, supported: false })).toBe(false)
  })
})

describe('the web hook', () => {
  const hook = read('live/use-screen-wake-lock.web.ts')

  it('requests a SCREEN lock through the gate', () => {
    expect(hook).toContain("navigator.wakeLock.request('screen')")
    expect(hook).toContain('shouldHoldWakeLock(')
  })

  it('re-requests on visibilitychange — Safari releases the lock when the page hides', () => {
    expect(hook).toContain("document.addEventListener('visibilitychange'")
    expect(hook).toContain("document.removeEventListener('visibilitychange'")
  })

  it('releases on unmount', () => {
    expect(hook).toMatch(/\.release\(\)/)
  })

  it('never throws — a refused lock only means the phone locks as before', () => {
    // `request()` rejects when the document is hidden, the battery is low or
    // the origin is insecure. None of those may take the picture down.
    expect(hook).toMatch(/try \{[\s\S]*navigator\.wakeLock\.request\('screen'\)[\s\S]*\} catch/)
  })
})

describe('the native twin is a no-op', () => {
  it('holds nothing — the video session keeps the screen on', () => {
    const native = read('live/use-screen-wake-lock.ts')
    expect(native).toContain('export function useScreenWakeLock(): void')
    expect(native).not.toContain('wakeLock')
  })
})

describe('both web hosts mount the hook', () => {
  for (const host of ['live/LiveView.web.tsx', 'grid-embed/GridLiveEmbed.web.tsx']) {
    it(`${host} holds the lock while it is on screen`, () => {
      const src = read(host)
      expect(src).toMatch(/import \{ useScreenWakeLock \} from '[./]+(live\/)?use-screen-wake-lock\.js'/)
      expect(src).toContain('useScreenWakeLock()')
    })
  }
})
