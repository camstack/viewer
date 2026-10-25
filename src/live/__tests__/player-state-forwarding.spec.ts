import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * One loading state, ONE loader — the toolbar ring (`TransportSpinnerRing`
 * around the playback bar's play button), on every platform.
 *
 * The web host (`LiveView.web.tsx`) took `onPlayerState` in its props type but
 * silently IGNORED it: the embed's `{type:'state'}` reports updated the local
 * cover and went no further. Two visible defects, one cause:
 *
 *   1. the screen's `playerState` stayed at its seed value `'connecting'`
 *      forever on web, so the toolbar ring spun permanently at the live edge;
 *   2. the cover kept drawing its OWN centred spinner — a loader the operator
 *      had already had removed from every other player surface.
 *
 * The iOS host (`LiveViewWebView.tsx`) already does both halves right: it
 * mirrors every state transition up, and its on-video loader is a FALLBACK
 * rendered only when no `onPlayerState` listener exists (a host that listens
 * draws the ring instead). These guards pin the web host to the same contract,
 * and pin the iOS half so it cannot quietly regress to two loaders either.
 *
 * Source assertions because the viewer cannot mount components (vitest runs
 * `node`, no renderer — see `docs/roadmap.md`), in the style of
 * `mute-ownership-wiring.spec.ts`.
 */

const SRC = join(process.cwd(), 'src')
const read = (rel: string): string => readFileSync(join(SRC, rel), 'utf8')

describe('web iframe player — embed state reaches the toolbar ring', () => {
  const src = read('live/LiveView.web.tsx')

  it('every embed state transition is mirrored to the host', () => {
    // The forwarding effect: without it the screen's player status never leaves
    // its 'connecting' seed and the toolbar ring spins forever on web.
    // State and reason travel as ONE object (`PlayerStatus`) — see
    // `stream-error-to-playback-bar.spec.ts` for why they must not be split.
    expect(src).toContain('onPlayerState?.(shownStatus)')
  })

  it('the cover spinner is a fallback for hosts that do NOT listen', () => {
    // A host that takes `onPlayerState` draws the ring around the playback
    // bar's play button; a second spinner on the picture is duplicate
    // furniture. Mirrors the iOS gate exactly.
    expect(src).toContain("shownState === 'connecting' && onPlayerState === undefined")
  })
})

describe('iOS WebView player — the same contract, pinned', () => {
  const src = read('live/LiveViewWebView.tsx')

  it('mirrors every state transition to the host', () => {
    expect(src).toContain('onPlayerState?.(shownStatus)')
  })

  it('keeps its on-video loader fallback-only', () => {
    expect(src).toContain("shownState === 'connecting' && onPlayerState === undefined")
  })
})

/**
 * The first failure is not shown — it is retried.
 *
 * The operator reported an intermittent "Impossibile caricare lo stream live."
 * Measured against the live hub on 2026-08-08, `webrtcSession.createSession`
 * failed 2 of 34 calls (`No broker for stream "614/adaptive"`), and the host
 * painted that instantly while its first automatic recovery was 13-19 s away —
 * the ladder's first step is 16 s ±20 %, sized to avoid racing the embed's
 * inner loop. But the inner loop rebuilds a SESSION, so it only runs from an
 * ICE failure; a signalling failure never creates one, and nothing was racing.
 */
describe('a failure in its first fast retry is presented as connecting', () => {
  for (const host of ['LiveView.web.tsx', 'LiveViewWebView.tsx']) {
    it(`${host} derives what the operator sees from the retry state`, () => {
      const src = readFileSync(join(SRC, 'live', host), 'utf8')
      expect(src).toContain(
        "const shownState = state === 'error' && autoRetry.settling ? 'connecting' : state",
      )
    })

    it(`${host} mirrors the SHOWN status to the host bar, not the raw one`, () => {
      // Otherwise the toolbar draws a danger ring for a failure the picture is
      // deliberately still hiding — two surfaces disagreeing about one stream.
      const src = readFileSync(join(SRC, 'live', host), 'utf8')
      expect(src).toContain('onPlayerState?.(shownStatus)')
      expect(src).not.toContain('onPlayerState?.(status)')
    })
  }

  it('the grace window covers the FIRST attempt only', () => {
    // A second failure is a real one: it must reach the operator immediately,
    // with its reason and its retry control.
    const src = readFileSync(join(SRC, 'live', 'use-host-auto-retry.ts'), 'utf8')
    expect(src).toContain('setSettling(action.attempt === 0)')
  })

  it('settling is cleared on every exit from the failure', () => {
    // A stuck `settling` would hide a real, permanent error behind a spinner —
    // strictly worse than the card it replaced.
    const src = readFileSync(join(SRC, 'live', 'use-host-auto-retry.ts'), 'utf8')
    const clears = src.match(/setSettling\(false\)/g) ?? []
    expect(clears.length).toBeGreaterThanOrEqual(5)
  })
})

/**
 * The recorded tier the player is REALLY on reaches the bar's badge on both
 * platforms.
 *
 * `servedProfile` was forwarded by the iOS host and silently dropped by the
 * web one: the web handler had its own hand-written checks for `position` and
 * `recState`, and the message went through `coerceRecordingHostMessage` only
 * for `clipDuration`. A tier badge that says High on iOS and nothing on web
 * for the same seek is the two-platform drift `recording-messages.ts` exists
 * to prevent.
 */
describe('servedProfile reaches the host on both platforms', () => {
  it('the web host forwards it through the shared validator', () => {
    const src = read('live/LiveView.web.tsx')
    expect(src).toContain("if (rec.type === 'servedProfile') {")
    expect(src).toContain('onServedProfile?.({ profile: rec.profile, requested: rec.requested })')
  })

  it('the iOS host forwards it', () => {
    const src = read('live/LiveViewWebView.tsx')
    expect(src).toContain('onServedProfile?.({ profile: rec.profile, requested: rec.requested })')
  })
})
