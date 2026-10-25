import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

/**
 * A `playClip` that arrives before the control channel is open must be HELD,
 * and asserted on the channel's own `open` — not dropped.
 *
 * ## The failure, from the operator's own session (2026-09-22, device 3628)
 *
 * ```
 * 16:09:03.067  live:state connecting              ← a new player coming up
 * 16:09:03.068  pointer move with no open session  {what: playClip}
 * 16:09:03.068  playClip arrived
 * 16:09:03.068  mount→playing                      ← the LIVE reaches playing
 * 16:09:03.069  player torn down — WKWebView released
 * 16:09:03.069  playClip NOT sent — no open session
 * ```
 *
 * Four milliseconds, and the clip is gone. The operator saw the live edge.
 *
 * ## Why the host could not have prevented it
 *
 * `clip-assert-on-player.ts` re-asserts a held clip whenever a PLAYER is there
 * to hear it, keyed on `playerState`. That is the VIDEO track: it reaches
 * `playing` when frames flow. `playClip` rides the DATA CHANNEL, which is
 * negotiated separately and opens later — and `onControlChannel` fires right
 * after `createDataChannel`, BEFORE the offer, so the session exists with a
 * `connecting` channel and `isOpen()` is false. Two authorities on "is it
 * ready", and the one the host asks is not the one that knows.
 *
 * `withSession` neither queues nor retries, by design — a stale seek replayed
 * later would move the pointer somewhere the operator has left. But a clip is
 * a STATE, not an event (the same argument `clip-assert-on-player.ts` makes),
 * so the LAST one is held and re-asserted. Never a queue.
 *
 * This is a structural spec because the page is a WebRTC component: what is
 * pinned is that the wire exists and that the drop cannot come back silently.
 */

const here = path.dirname(fileURLToPath(import.meta.url))
const source = readFileSync(path.join(here, '..', 'EmbedPlayerPage.tsx'), 'utf8')

describe('a clip is held until the control channel can carry it', () => {
  it('listens for the channel `open` edge', () => {
    // The whole fix. `onControlChannel` is the CREATION edge — the channel is
    // `connecting` there — so without this listener the held clip is asserted
    // exactly once, too early, and stays held for ever.
    // Named, not just any open listener: the initial-SEEK path a few lines
    // below already had one, so a bare `addEventListener('open'` check passes
    // with this fix removed. (That seek path is also where the correct shape
    // was sitting all along — fire now if open, else on `open`, once.)
    expect(source).toContain("channel.addEventListener('open', assertWaitingClip)")
  })

  it('HOLDS a playClip it could not send, rather than only logging it', () => {
    // The mechanism, not the absence of a phrase: the old wording still
    // appears in the comment that quotes the operator's log, and asserting on
    // prose would fail for the wrong reason.
    expect(source).toContain('pendingClipRef.current = sent')
    // And the line it emits now says it is WAITING, which is a different
    // promise to whoever reads the logs than "not sent".
    expect(source).toContain('playClip HELD — no open session yet')
  })

  it('FORGETS the held clip when the operator leaves it', () => {
    // A pending assert that fired after `goLive` would drag the pointer back
    // into a file the operator has already left.
    const goLive = source.slice(source.indexOf('goLive: () => {'))
    expect(goLive.slice(0, 400)).toContain('pendingClipRef.current = null')
  })

  it('keeps ONE held clip, never a queue', () => {
    // A clip on the pointer is a state. Replaying an older one would put the
    // pointer somewhere the operator has already moved past.
    expect(source).not.toMatch(/pendingClip\w*\.current\.push\(/)
    expect(source).not.toMatch(/pendingClip\w*:\s*\w+\[\]/)
  })

  it('asserts the deep-link clip on the same edge, not only at creation', () => {
    // `initialClipRef` had the identical bug and its own dead-end log line
    // ("NOT opened — no session yet") with nothing to retry it.
    expect(source).toContain('assertWaitingClip')
    expect(source).toContain('initialClipRef.current = null')
  })
})
