import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The PiP PARKING experiment is deleted — it answered its question.
 *
 * ## The answer, measured on the device on 2026-09-01 (three identical cycles)
 *
 * ```
 *   .889  system PiP request answered   → active: true
 *   .891  player PARKED off screen — probe armed
 *   .902  swipe handoff settled          → terminal: park
 *  +7,1s  presentation mode changed      → INLINE
 * ```
 *
 * And in the second cycle `inline` (584686) arrived **4,6 s BEFORE**
 * `player torn down` (589304): the PiP did not die of the unmount, it died on
 * its own with the WebView still mounted. Seven seconds is the profile of a
 * throttle, not of a deallocation.
 *
 * So the axis was never "mounted or unmounted", it is **"visible or not"**: a
 * WKWebView parked off screen stays mounted, iOS considers it not visible,
 * WebKit throttles it, the `<video>` stalls and the PiP window closes. Which is
 * also why PiP from the BUTTON works — there the operator stays on the screen
 * and the picture is visible.
 *
 * That verdict retires BOTH the experiment and the hypothesis it was built to
 * test (`docs/2026-09-01-persistent-player-host-design.md` §6.1): a host that
 * keeps the player out of the route cures nothing, because the route was never
 * the cause.
 *
 * ## What this guard does and does not hold shut
 *
 * It fails on the first symbol of the experiment that comes back. It says
 * NOTHING about the swipe — which, since 2026-09-06, asks for system PiP and
 * STAYS on the screen, the verdict above being the reason
 * (`pip-handoff.spec.ts`, `camera-back-cameras.spec.ts` pin that) — and nothing about the
 * instrumentation — `PIP_MODE_WATCH_SCRIPT` and the `live:pip` /
 * `live:lifecycle` scopes STAY, because they are what made the verdict
 * measurable and they are what any future attempt will be read with.
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
    if (full.endsWith('pip-park-is-gone.spec.ts')) continue
    out.push(full)
  }
  return out
}

const FORBIDDEN = [
  'pipPark',
  'pip-park',
  'PARK_OFFSET',
  'parkedStyle',
  'resolveSwipeTerminalEffect',
  'SwipeTerminalEffect',
  'swipeTerminal',
  'playerParked',
  'parkPlayer',
  'parkedNotice',
] as const

describe('the parking experiment is gone from the app', () => {
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

  it('the pure module itself is not importable from anywhere', () => {
    expect(files.some((f) => f.endsWith('camera-detail/pip-park.ts'))).toBe(false)
  })
})

describe('the strings it owned are gone from BOTH locales', () => {
  for (const locale of ['en', 'it']) {
    it(`${locale}.json carries no orphan experiment copy`, () => {
      const raw = readFileSync(join(ROOT, 'locales', `${locale}.json`), 'utf8')
      for (const key of ['pipParkExperiment', 'pipParkedNotice', 'pipParkedResume']) {
        expect(raw, key).not.toContain(key)
      }
    })
  }
})

/**
 * The instrumentation is the OPPOSITE of dead code: it is the only reason this
 * question got an answer instead of a guess. Asserted as loudly as the deletion
 * so a later "clean up the PiP logging" sweep has to argue with a test.
 */
describe('the diagnostic trail STAYS', () => {
  const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8')

  it('the page-side presentation-mode watcher is still injected', () => {
    expect(read('src/live/pip-request.ts')).toContain('PIP_MODE_WATCH_SCRIPT')
  })

  it('and both scopes still reach the hub without debug mode', () => {
    const logger = read('src/lib/logger.ts')
    expect(logger).toContain("'live:pip'")
    expect(logger).toContain("'live:lifecycle'")
  })
})
