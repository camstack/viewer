import { describe, expect, it, vi } from 'vitest'

import {
  createWebFullscreenController,
  decideWebFullscreenMode,
  type FullscreenTarget,
  isWebFullscreenSupported,
  usesBrowserFullscreen,
  webFullscreenButtonShown,
} from '../use-web-fullscreen.js'

/**
 * iPhone Safari — browser and installed PWA alike — has no
 * `Element.requestFullscreen` (iPad has it). The fullscreen disc on the camera
 * screen routed web to the browser API only, so on an iPhone it did nothing,
 * silently, and the only way to a big picture was to rotate the phone.
 *
 * `document.fullscreenEnabled` is the one flag that says whether the API can
 * succeed at all; the screen asks it BEFORE choosing between the browser API
 * and its own `fill` layout. The answer is a plain boolean so a document that
 * omits the property (iPhone) reads as unsupported, never as `undefined`.
 */
describe('isWebFullscreenSupported', () => {
  it('is true when the document says fullscreen is enabled', () => {
    expect(isWebFullscreenSupported({ fullscreenEnabled: true })).toBe(true)
  })

  it('is false when the document says it is disabled (iframe without allowfullscreen)', () => {
    expect(isWebFullscreenSupported({ fullscreenEnabled: false })).toBe(false)
  })

  it('is false when the document has no such property — iPhone Safari', () => {
    expect(isWebFullscreenSupported({})).toBe(false)
  })

  it('is false with no document at all — SSR, native', () => {
    expect(isWebFullscreenSupported(null)).toBe(false)
    expect(isWebFullscreenSupported(undefined)).toBe(false)
  })
})

/**
 * On a phone the native button forces landscape. The web decides UP FRONT,
 * by feature detection, what the same button can honestly do.
 */
describe('decideWebFullscreenMode', () => {
  it('Android Chrome (touch, fullscreen, orientation.lock) → fullscreen + landscape lock', () => {
    const d = decideWebFullscreenMode({ fullscreenEnabled: true, orientationLock: true, coarsePointer: true })
    expect(d.mode).toBe('lock-landscape')
    expect(webFullscreenButtonShown(d.mode)).toBe(true)
    expect(usesBrowserFullscreen(d.mode)).toBe(true)
  })

  it('iPhone Safari / iOS PWA (touch, no fullscreen API) → no button', () => {
    const d = decideWebFullscreenMode({ fullscreenEnabled: false, orientationLock: false, coarsePointer: true })
    expect(d.mode).toBe('hidden')
    expect(webFullscreenButtonShown(d.mode)).toBe(false)
  })

  it('iPad Safari (touch, fullscreen, but no orientation.lock) → no button', () => {
    const d = decideWebFullscreenMode({ fullscreenEnabled: true, orientationLock: false, coarsePointer: true })
    expect(d.mode).toBe('hidden')
  })

  it('desktop → plain fullscreen, even where orientation.lock exists (Chrome has one that refuses)', () => {
    for (const orientationLock of [true, false]) {
      const d = decideWebFullscreenMode({ fullscreenEnabled: true, orientationLock, coarsePointer: false })
      expect(d.mode).toBe('plain')
      expect(usesBrowserFullscreen(d.mode)).toBe(true)
    }
  })

  it('desktop without the API (iframe without allowfullscreen) → the app fill, button kept', () => {
    const d = decideWebFullscreenMode({ fullscreenEnabled: false, orientationLock: false, coarsePointer: false })
    expect(d.mode).toBe('app-fill')
    expect(webFullscreenButtonShown(d.mode)).toBe(true)
    expect(usesBrowserFullscreen(d.mode)).toBe(false)
  })
})

interface FakeDoc {
  fullscreenElement: object | null
  readonly exitFullscreen: () => Promise<void>
}

interface FakeEnv {
  readonly doc: FakeDoc
  readonly orientation: { lock: (o: 'landscape') => Promise<void>; unlock: () => void }
  readonly calls: string[]
  readonly el: FullscreenTarget
}

function fakeEnv(lockResult: 'ok' | 'reject' = 'ok'): FakeEnv {
  const calls: string[] = []
  const doc: FakeDoc = {
    fullscreenElement: null,
    exitFullscreen: () => {
      calls.push('exit')
      doc.fullscreenElement = null
      return Promise.resolve()
    },
  }
  const el: FullscreenTarget = {
    requestFullscreen: () => {
      calls.push('request')
      doc.fullscreenElement = el
      return Promise.resolve()
    },
  }
  const orientation = {
    lock: (o: 'landscape') => {
      calls.push(`lock:${o}`)
      return lockResult === 'ok' ? Promise.resolve() : Promise.reject(new Error('NotSupportedError'))
    },
    unlock: () => {
      calls.push('unlock')
    },
  }
  return { doc, orientation, calls, el }
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

describe('createWebFullscreenController', () => {
  it('enters fullscreen THEN locks landscape; the second press unlocks and exits', async () => {
    const env = fakeEnv()
    const warn = vi.fn()
    const c = createWebFullscreenController({ doc: env.doc, orientation: env.orientation, mode: 'lock-landscape', warn })
    c.toggle(env.el)
    await flush()
    expect(env.calls).toEqual(['request', 'lock:landscape'])
    c.toggle(env.el)
    await flush()
    expect(env.calls).toEqual(['request', 'lock:landscape', 'unlock', 'exit'])
    expect(warn).not.toHaveBeenCalled()
  })

  it('leaving fullscreen any other way (Esc, back) releases the lock', async () => {
    const env = fakeEnv()
    const c = createWebFullscreenController({ doc: env.doc, orientation: env.orientation, mode: 'lock-landscape', warn: vi.fn() })
    c.toggle(env.el)
    await flush()
    env.doc.fullscreenElement = null // the browser left fullscreen
    c.onFullscreenChange()
    expect(env.calls).toEqual(['request', 'lock:landscape', 'unlock'])
    // …and only once.
    c.onFullscreenChange()
    expect(env.calls.filter((x) => x === 'unlock')).toHaveLength(1)
  })

  it('plain mode never touches the orientation', async () => {
    const env = fakeEnv()
    const c = createWebFullscreenController({ doc: env.doc, orientation: env.orientation, mode: 'plain', warn: vi.fn() })
    c.toggle(env.el)
    await flush()
    c.toggle(env.el)
    await flush()
    expect(env.calls).toEqual(['request', 'exit'])
  })

  it('a refused lock is logged, keeps the fullscreen, and leaves nothing to unlock', async () => {
    const env = fakeEnv('reject')
    const warn = vi.fn()
    const c = createWebFullscreenController({ doc: env.doc, orientation: env.orientation, mode: 'lock-landscape', warn })
    c.toggle(env.el)
    await flush()
    expect(warn).toHaveBeenCalledWith('orientation lock refused', { error: 'NotSupportedError' })
    expect(env.doc.fullscreenElement).toBe(env.el)
    c.toggle(env.el)
    await flush()
    expect(env.calls).toEqual(['request', 'lock:landscape', 'exit'])
  })
})
