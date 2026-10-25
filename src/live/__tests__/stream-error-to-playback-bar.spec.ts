/**
 * A stream error belongs on the playback bar, not on the picture.
 *
 * The operator's report: "A volte lo stream va in errore. Esce un pulsante
 * sullo stream ma non è cliccabile." The button was real and it was drawn where
 * it could never be pressed — the camera-detail screen lays a full-bleed
 * `GestureDetector` over the video (pinch/pan/tap), and that layer is a LATER
 * sibling than the player, so it takes every touch that lands on the picture.
 * Anything the player draws inside its own box is therefore visible and inert.
 *
 * So the affordance MOVES rather than being repaired in place: the error and
 * its reason travel up the same state chain the loading state already uses
 * (embed → `{type:'state'}` → host → `onPlayerState` → screen → playback bar),
 * and the bar — which is chrome, outside the gesture layer — draws the ring in
 * a danger colour and carries the retry control.
 *
 * A player with NO host listening keeps its own card: a standalone embed or a
 * grid tile has no bar to move it to, and there no gesture layer is in the way.
 *
 * Source guards because this repo's viewer has no renderer (vitest runs
 * `environment: 'node'` over `*.spec.ts` only), and because each assertion is a
 * RULE rather than a pixel.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = join(process.cwd(), 'src')
const read = (...rel: readonly string[]): string => readFileSync(join(SRC, ...rel), 'utf8')

const HOSTS = [
  ['LiveViewWebView.tsx', 'the native host (WebView)'],
  ['LiveView.web.tsx', 'the web host (iframe)'],
] as const

describe('the in-picture error card is gone wherever a host listens', () => {
  for (const [file, what] of HOSTS) {
    it(`${what} draws its error card only when nobody took onPlayerState`, () => {
      const src = read('live', file)
      // The exact shape the connecting spinner already uses in both hosts:
      // a host that listens draws BOTH indicators on its bar.
      expect(src).toContain("shownState === 'error' && onPlayerState === undefined")
    })

    it(`${what} lets touches through to the gesture layer when the host owns the error`, () => {
      const src = read('live', file)
      // The cover claimed the touch stream on 'error' so its (unreachable)
      // retry button could be pressed. With the button gone the cover must
      // stop swallowing pinch/pan/tap.
      expect(src).toContain(
        "coverActive && shownState === 'error' && onPlayerState === undefined ? 'auto' : 'none'",
      )
    })

    it(`${what} forwards the REASON, not just the state`, () => {
      const src = read('live', file)
      // One object, forwarded whole: a reason that arrives separately from the
      // state it explains can be rendered against the wrong state.
      expect(src).toContain('onPlayerState?.(shownStatus)')
      expect(src).toContain('PlayerStatus')
    })

    it(`${what} auto-retries and exposes retry() on the handle`, () => {
      const src = read('live', file)
      expect(src).toContain('useHostAutoRetry(')
      expect(src).toContain('retry: ')
    })
  }
})

describe('the retry loop is observable, per camera', () => {
  const src = read('live', 'use-host-auto-retry.ts')

  it('stamps every line with the camera', () => {
    // A miss rate or a dark camera is ALWAYS asked per-camera ("why is 102
    // worse than 101?"), and a line without the id cannot be grouped. One
    // choke point so a future line cannot forget.
    expect(src).toContain("log[level]('live:retry', msg, { deviceId, ...data })")
    expect(src).not.toMatch(/\blog\.(debug|info|warn|error)\(/)
  })

  it('logs at warn or above — a normal-mode client ships nothing lower', () => {
    // `logger.ts`: outside DEBUG MODE only warn/error reach the hub. A retry
    // loop logged at info is a retry loop nobody can see.
    expect(src).not.toContain("logRetry('debug'")
    expect(src).not.toContain("logRetry('info'")
  })

  it('makes exhaustion an explicit, visible end — never a silent stop', () => {
    expect(src).toContain("action.kind === 'exhausted'")
    expect(src).toContain("logRetry('error'")
  })

  it('the manual control only makes the next attempt SOONER', () => {
    // retryNow resets the budget and fires immediately; it is not the only
    // path to a retry, and it does not disable the loop.
    expect(src).toContain('retryNow')
    expect(src).toContain('attemptsRef.current = 0')
  })
})

describe('the playback bar keeps the STATUS and gives up the report', () => {
  const bar = read('components', 'camera', 'theater', 'TimelinePlaybackBar.tsx')

  it('reuses the loading ring, in a danger colour', () => {
    // Same place, same visual language: the operator already reads this ring
    // as "the transport is busy". Red says "busy failing".
    expect(bar).toContain('faulted ? colors.danger : colors.primary')
  })

  it('takes a BOOLEAN, because the reason is no longer its business', () => {
    // The reason and the retry moved to `TimelineFaultNotice`, the one slot
    // where every failure in the theater is reported. A bar that still accepted
    // the string would invite a second rendering of it.
    expect(bar).toContain('readonly faulted?: boolean')
    expect(bar).not.toContain('onRetryStream')
    expect(bar).not.toContain('readonly fault?: string | null')
  })
})

describe('the screen is the wire between the two', () => {
  const screen = read('screens', 'CameraDetailScreen.tsx')

  it('holds the whole status, reason included', () => {
    expect(screen).toContain('PlayerStatus')
    expect(screen).toContain('onPlayerState={setPlayerStatus}')
  })

  it('hands the picture\'s health down as one binding', () => {
    expect(screen).toContain('streamFault={streamFaultBinding}')
  })

  it('counts a failed RECORDED clip as the same event', () => {
    // `PlaybackMode` has carried 'error' since the machine was written and
    // nothing ever rendered it: a recording that could not be read looked
    // exactly like one that played.
    expect(screen).toContain("playback.state.mode === 'error'")
  })

  it('routes the retry into the player handle', () => {
    expect(screen).toContain('liveRef.current?.retry()')
  })
})
