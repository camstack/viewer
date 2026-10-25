import { describe, it, expect } from 'vitest'
import { runInNewContext } from 'node:vm'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  PIP_REQUEST_SCRIPT,
  PIP_MODE_WATCH_SCRIPT,
  parsePipReport,
  parsePipModeReport,
  awaitPipConfirmation,
  PIP_CONFIRM_TIMEOUT_MS,
  type PipStartResult,
} from '../pip-request.js'

/**
 * The injected script is the ONLY thing that can tell the host whether system
 * PiP actually came up: `webkitSetPresentationMode` returns void, and the host
 * has no other view into the page. So it is executed here for real (node:vm
 * with a fake <video>) rather than pattern-matched — a script that posts
 * "active" without waiting for the platform event would pass a grep and ship
 * the defect it exists to prevent (navigate away, no PiP, no player).
 */

interface Listener {
  readonly type: string
  readonly fn: () => void
}

interface FakeVideo {
  webkitPresentationMode?: string
  webkitSetPresentationMode?: (mode: string) => void
  requestPictureInPicture?: () => Promise<unknown>
  addEventListener: (type: string, fn: () => void) => void
  removeEventListener: (type: string, fn: () => void) => void
}

function fakeVideo(over: Partial<FakeVideo>): { video: FakeVideo; listeners: Listener[] } {
  const listeners: Listener[] = []
  const video: FakeVideo = {
    addEventListener: (type, fn) => {
      listeners.push({ type, fn })
    },
    removeEventListener: (type, fn) => {
      const i = listeners.findIndex((l) => l.type === type && l.fn === fn)
      if (i >= 0) listeners.splice(i, 1)
    },
    ...over,
  }
  return { video, listeners }
}

function run(video: FakeVideo | null): string[] {
  const posted: string[] = []
  const sandbox = {
    document: { querySelector: (): FakeVideo | null => video },
    window: { ReactNativeWebView: { postMessage: (m: string): void => void posted.push(m) } },
  }
  runInNewContext(PIP_REQUEST_SCRIPT, sandbox)
  return posted
}

describe('PIP_REQUEST_SCRIPT', () => {
  it('reports UNAVAILABLE at once when the page has no video', () => {
    const posted = run(null)
    expect(posted.map((p) => parsePipReport(p))).toEqual([{ active: false, reason: 'no-video' }])
  })

  it('reports UNAVAILABLE at once when neither PiP API exists', () => {
    const { video } = fakeVideo({})
    const posted = run(video)
    expect(parsePipReport(posted[0] ?? '')).toEqual({ active: false, reason: 'unsupported' })
  })

  it('says NOTHING until iOS reports the presentation change', () => {
    let asked: string | null = null
    const { video, listeners } = fakeVideo({
      webkitPresentationMode: 'inline',
      webkitSetPresentationMode: (mode) => {
        asked = mode
      },
    })
    const posted = run(video)
    expect(asked).toBe('picture-in-picture')
    // The whole point: the request was made, the answer has not arrived.
    expect(posted).toEqual([])

    video.webkitPresentationMode = 'picture-in-picture'
    listeners.filter((l) => l.type === 'webkitpresentationmodechanged').forEach((l) => l.fn())
    expect(parsePipReport(posted[0] ?? '')).toMatchObject({ active: true })
  })

  it('reports the REFUSAL when the presentation change lands back on inline', () => {
    const { video, listeners } = fakeVideo({
      webkitPresentationMode: 'inline',
      webkitSetPresentationMode: () => undefined,
    })
    const posted = run(video)
    listeners.filter((l) => l.type === 'webkitpresentationmodechanged').forEach((l) => l.fn())
    expect(parsePipReport(posted[0] ?? '')).toMatchObject({ active: false })
  })

  it('answers immediately when the video is ALREADY in PiP (a second request)', () => {
    const { video } = fakeVideo({
      webkitPresentationMode: 'picture-in-picture',
      webkitSetPresentationMode: () => undefined,
    })
    expect(parsePipReport(run(video)[0] ?? '')).toMatchObject({ active: true })
  })

  it('resolves the standard API from its promise, both ways', async () => {
    const ok = fakeVideo({ requestPictureInPicture: () => Promise.resolve({}) })
    const okPosted = run(ok.video)
    expect(okPosted).toEqual([])
    await Promise.resolve()
    await Promise.resolve()
    expect(parsePipReport(okPosted[0] ?? '')).toMatchObject({ active: true })

    const no = fakeVideo({ requestPictureInPicture: () => Promise.reject(new Error('denied')) })
    const noPosted = run(no.video)
    await Promise.resolve()
    await Promise.resolve()
    expect(parsePipReport(noPosted[0] ?? '')).toMatchObject({ active: false })
  })

  it('is a complete injectJavaScript payload (ends with the truthy sentinel)', () => {
    expect(PIP_REQUEST_SCRIPT.trimEnd().endsWith('true;')).toBe(true)
  })
})

describe('parsePipReport', () => {
  it('ignores every other page→host message', () => {
    expect(parsePipReport('{"type":"state","state":"playing"}')).toBeNull()
    expect(parsePipReport('not json')).toBeNull()
    expect(parsePipReport('{"type":"pip"}')).toBeNull()
  })

  it('keeps the reason when there is one', () => {
    expect(parsePipReport('{"type":"pip","active":false,"reason":"denied"}')).toEqual({
      active: false,
      reason: 'denied',
    })
  })

  it('never collides with the stats reply the same handler sniffs for', () => {
    expect(PIP_REQUEST_SCRIPT).not.toContain('"stats"')
  })
})

describe('PIP_CONFIRM_TIMEOUT_MS', () => {
  it('is a bound on WAITING, generous enough for a cold WebKit PiP window', () => {
    expect(PIP_CONFIRM_TIMEOUT_MS).toBeGreaterThanOrEqual(3000)
  })
})

describe('awaitPipConfirmation', () => {
  function harness() {
    const settled: PipStartResult[] = []
    const confirm = awaitPipConfirmation((r) => void settled.push(r))
    return { settled, confirm }
  }

  it('settles STARTED on the page report, once', () => {
    const h = harness()
    expect(h.confirm.report('{"type":"pip","active":true}')).toBe(true)
    expect(h.settled).toEqual(['started'])
    h.confirm.report('{"type":"pip","active":true}')
    expect(h.settled).toEqual(['started'])
  })

  it('settles UNAVAILABLE when the page says the video did not enter PiP', () => {
    const h = harness()
    h.confirm.report('{"type":"pip","active":false,"reason":"unsupported"}')
    expect(h.settled).toEqual(['unavailable'])
  })

  it('the elapsed bound settles UNCONFIRMED — never started', () => {
    const h = harness()
    h.confirm.expire()
    expect(h.settled).toEqual(['unconfirmed'])
  })

  it('a report that arrives after the bound changes nothing', () => {
    const h = harness()
    h.confirm.expire()
    expect(h.confirm.report('{"type":"pip","active":true}')).toBe(false)
    expect(h.settled).toEqual(['unconfirmed'])
  })

  it('the bound after an answer changes nothing', () => {
    const h = harness()
    h.confirm.report('{"type":"pip","active":true}')
    h.confirm.expire()
    expect(h.settled).toEqual(['started'])
  })

  it('passes every other message through untouched', () => {
    const h = harness()
    expect(h.confirm.report('{"type":"state","state":"playing"}')).toBe(false)
    expect(h.settled).toEqual([])
  })
})

describe('the players wire the confirmation, and never fake it', () => {
  const read = (rel: string): string => readFileSync(join(process.cwd(), rel), 'utf8')
  const webview = read('src/live/LiveViewWebView.tsx')
  const web = read('src/live/LiveView.web.tsx')

  it('the WebView player injects the CONFIRMING script, not an inline request', () => {
    expect(webview).toContain('PIP_REQUEST_SCRIPT')
    // The old fire-and-forget one-liner. Its return would restore a startPip
    // that cannot be waited on.
    expect(webview).not.toContain("v.webkitSetPresentationMode('picture-in-picture');}")
  })

  it('it resolves only from the page report or the elapsed bound', () => {
    expect(webview).toContain('awaitPipConfirmation')
    expect(webview).toContain('confirmation.expire()')
    // No path may hand back 'started' without the page having said so.
    expect(webview).not.toContain("resolve('started')")
  })

  it('no surface is answered at once — a swipe must never hang on it', () => {
    expect(webview).toContain("if (!surface) return Promise.resolve('unavailable')")
  })

  it('web says a definitive no rather than nothing', () => {
    expect(web).toContain("return Promise.resolve('unavailable')")
  })
})


/**
 * The reporter that outlives the request.
 *
 * The operator report this exists for is "the window came up and died". Two
 * causes look identical from the host: the page left PiP, or the host released
 * the WKWebView. Only the first can post a message — so the reporter is run
 * for real here, because one that silently attached nothing would leave the
 * absence of a line meaning nothing at all.
 */
describe('PIP_MODE_WATCH_SCRIPT', () => {
  function watcher(video: FakeVideo | null): { posted: string[]; inject: () => void } {
    const posted: string[] = []
    const sandbox = {
      document: { querySelector: (): FakeVideo | null => video },
      window: { ReactNativeWebView: { postMessage: (m: string): void => void posted.push(m) } },
    }
    return { posted, inject: (): void => void runInNewContext(PIP_MODE_WATCH_SCRIPT, sandbox) }
  }

  function fire(listeners: readonly Listener[], type: string): void {
    listeners.filter((l) => l.type === type).forEach((l) => l.fn())
  }

  it('reports the EXIT from PiP — the line an unmount can never produce', () => {
    const { video, listeners } = fakeVideo({
      webkitPresentationMode: 'picture-in-picture',
      webkitSetPresentationMode: () => undefined,
    })
    const w = watcher(video)
    w.inject()
    video.webkitPresentationMode = 'inline'
    fire(listeners, 'webkitpresentationmodechanged')
    expect(w.posted.map((m) => parsePipModeReport(m))).toEqual([{ mode: 'inline' }])
  })

  it('reports the ENTRY too, so the two timestamps bracket the window', () => {
    const { video, listeners } = fakeVideo({
      webkitPresentationMode: 'inline',
      webkitSetPresentationMode: () => undefined,
    })
    const w = watcher(video)
    w.inject()
    video.webkitPresentationMode = 'picture-in-picture'
    fire(listeners, 'webkitpresentationmodechanged')
    video.webkitPresentationMode = 'inline'
    fire(listeners, 'webkitpresentationmodechanged')
    expect(w.posted.map((m) => parsePipModeReport(m))).toEqual([
      { mode: 'picture-in-picture' },
      { mode: 'inline' },
    ])
  })

  it('is IDEMPOTENT — a second swipe does not double every later line', () => {
    // It is injected on every PiP request. Stacked listeners would report each
    // change N times and make the log unreadable exactly when it matters.
    const { video, listeners } = fakeVideo({
      webkitPresentationMode: 'inline',
      webkitSetPresentationMode: () => undefined,
    })
    const w = watcher(video)
    w.inject()
    w.inject()
    w.inject()
    expect(listeners.filter((l) => l.type === 'webkitpresentationmodechanged')).toHaveLength(1)
    fire(listeners, 'webkitpresentationmodechanged')
    expect(w.posted).toHaveLength(1)
  })

  it('uses the standard events where WebKit presentation mode does not exist', () => {
    const { video, listeners } = fakeVideo({ requestPictureInPicture: () => Promise.resolve({}) })
    const w = watcher(video)
    w.inject()
    fire(listeners, 'enterpictureinpicture')
    fire(listeners, 'leavepictureinpicture')
    expect(w.posted.map((m) => parsePipModeReport(m))).toEqual([
      { mode: 'picture-in-picture' },
      { mode: 'inline' },
    ])
  })

  it('says nothing, and throws nothing, when the page has no video', () => {
    const w = watcher(null)
    expect(() => w.inject()).not.toThrow()
    expect(w.posted).toEqual([])
  })

  it('is a complete injectJavaScript payload (ends with the truthy sentinel)', () => {
    expect(PIP_MODE_WATCH_SCRIPT.trimEnd().endsWith('true;')).toBe(true)
  })
})

describe('the two page→host channels never read each other', () => {
  it('a mode report is not a confirmation — it must not settle a pending request', () => {
    // `awaitPipConfirmation` settles ONCE. If a later `inline` were parsed as a
    // PiP answer it would resolve the swipe with 'unavailable' and navigate.
    expect(parsePipReport('{"type":"pipmode","mode":"inline"}')).toBeNull()
  })

  it('a confirmation is not a mode report', () => {
    expect(parsePipModeReport('{"type":"pip","active":true}')).toBeNull()
    expect(parsePipModeReport('not json')).toBeNull()
    expect(parsePipModeReport('{"type":"pipmode"}')).toBeNull()
  })
})

describe('the PiP trail is actually written', () => {
  const read = (rel: string): string => readFileSync(join(process.cwd(), rel), 'utf8')
  const webview = read('src/live/LiveViewWebView.tsx')
  const logger = read('src/lib/logger.ts')

  it('the watcher is armed BEFORE the request, or the entry is never reported', () => {
    const armed = webview.indexOf('injectJavaScript(PIP_MODE_WATCH_SCRIPT)')
    const asked = webview.indexOf('injectJavaScript(PIP_REQUEST_SCRIPT)')
    expect(armed).toBeGreaterThan(-1)
    expect(asked).toBeGreaterThan(armed)
  })

  it('the player records its own TEARDOWN, from the cleanup', () => {
    // Written on unmount so it is the last line the player emits. On mount it
    // would prove nothing: the question is when the WKWebView was released.
    expect(webview).toContain(
      "    return () => {\n      log.info('live:lifecycle', 'player torn down — WKWebView released', {",
    )
  })

  it('both scopes leave the device without debug mode', () => {
    // The 2026-09-01 PiP report arrived with debug mode off. A trail that only
    // exists in the on-device ring buffer is not a trail.
    expect(logger).toContain("'live:pip',")
    expect(logger).toContain("'live:lifecycle',")
  })
})
