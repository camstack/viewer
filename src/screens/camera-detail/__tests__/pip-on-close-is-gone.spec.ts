import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * AUTOMATIC Picture-in-Picture on app close is deleted — it answered its
 * question, and the answer is that the platform forbids it.
 *
 * ## What was built, twice
 *
 * 1.0.488 asked the HOST to call `startPip()` when `AppState` reported
 * `background`. That is one state too late: the WKWebView is already invisible
 * and WebKit has throttled it (the parking guard spec beside this one carries
 * that trace). So the second attempt moved the ask into the PAGE — a handler
 * armed while the picture was plainly visible, firing for itself on
 * `visibilitychange` → `document.hidden`, which is early enough AND tells a
 * departure apart from a Control Centre pull.
 *
 * ## The measurement, on a real device, twice (2026-09-13)
 *
 * ```
 *   live:pip  page left → PiP asked on the way out  {reason: 'asked-webkit'}
 *   live:pip  presentation mode changed             {mode: 'picture-in-picture'}
 *  +176 ms    presentation mode changed             {mode: 'inline'}
 * ```
 *
 * The event fired and no window ever appeared.
 *
 * ## Why no third attempt exists
 *
 * Apple's developer-forum thread 819235 ("How to enter Picture-in-Picture on
 * background from inline playback in WKWebView") names every mechanism an HTML
 * `<video>` has and rules each one out for INLINE playback:
 *
 *  - `autopictureinpicture` — ignored from inline playback (fullscreen only);
 *  - `requestPictureInPicture()` on `visibilitychange` — fails, "not triggered
 *    by user activation";
 *  - `webkitSetPresentationMode('picture-in-picture')` on `visibilitychange` —
 *    fires the event, the window never appears. Exactly the trail above.
 *
 * The rule underneath all three is Apple's own: "Only begin PiP playback in
 * response to user interaction and never programmatically." The one API that
 * DOES start PiP automatically from inline playback,
 * `AVPictureInPictureController.canStartPictureInPictureAutomaticallyFromInline`,
 * belongs to a native `AVPlayerViewController` — unreachable from a `<video>`
 * in a WKWebView, which is why apps that manage this ship a native player.
 *
 * So the honest shape is the one that is left: the PiP DISC. It is user
 * initiated, it is measured to work, and the operator verified the window it
 * opens survives the app being backgrounded. `pip-handoff.ts` carries the
 * narrative record; this file makes rebuilding the automatism fail a test
 * instead of a device.
 */

const ROOT = process.cwd()

/** Every source file under a directory, ignoring this spec itself. */
function sources(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      out.push(...sources(full))
      continue
    }
    if (!/\.(ts|tsx)$/.test(entry)) continue
    if (full.endsWith('pip-on-close-is-gone.spec.ts')) continue
    out.push(full)
  }
  return out
}

const FORBIDDEN = [
  'pipOnAppClose',
  'armPipOnDeparture',
  'shouldArmPipOnDeparture',
  'pip-on-close',
  'PIP_ARM_ON_DEPARTURE_SCRIPT',
  'PIP_DISARM_ON_DEPARTURE_SCRIPT',
  'parsePipDepartureReport',
  'PipDepartureReport',
  'pipdeparture',
  '__camstackPipOnLeave',
] as const

describe('the PiP-on-close automatism is gone from the app', () => {
  const files = [...sources(join(ROOT, 'src')), ...sources(join(ROOT, 'app'))]

  it('scans a real tree (the guard itself must not go blind)', () => {
    expect(files.length).toBeGreaterThan(500)
  })

  for (const symbol of FORBIDDEN) {
    it(`no file mentions \`${symbol}\``, () => {
      const hits = files.filter((f) => readFileSync(f, 'utf8').includes(symbol))
      expect(hits.map((f) => f.slice(ROOT.length + 1))).toEqual([])
    })
  }

  it('the pure module itself is gone', () => {
    expect(files.some((f) => f.endsWith('camera-detail/pip-on-close.ts'))).toBe(false)
  })
})

describe('the strings it owned are gone from BOTH locales', () => {
  for (const locale of ['en', 'it']) {
    it(`${locale}.json carries no orphan copy`, () => {
      const raw = readFileSync(join(ROOT, 'locales', `${locale}.json`), 'utf8')
      for (const key of ['pipOnAppClose', 'pipOnAppCloseHint']) {
        expect(raw, key).not.toContain(key)
      }
    })
  }
})

/**
 * The DISC stays. It is the opposite of the thing deleted above: a request the
 * operator makes with a finger, which is the only kind WebKit honours.
 */
describe('the user-initiated PiP disc STAYS', () => {
  const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8')

  it('the player still exposes startPip, and the page still answers it', () => {
    expect(read('src/live/live-view-types.ts')).toContain('startPip()')
    expect(read('src/live/pip-request.ts')).toContain('PIP_REQUEST_SCRIPT')
  })

  it('and the reason it is the only shape left is written down', () => {
    const record = read('src/screens/camera-detail/pip-handoff.ts')
    expect(record).toContain('819235')
    expect(record).toContain('never programmatically')
    expect(record).toContain('canStartPictureInPictureAutomaticallyFromInline')
  })
})
