import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

/**
 * The SINGLE-camera player recovers from a freeze on its own.
 *
 * `use-stall-watchdog` exists because a connected stream whose frames stopped
 * advancing is not an errored stream, and every other recovery path in this
 * bundle keys off an error — so nothing fires, and the tile stays frozen until
 * a human intervenes. That lesson was learned on the grid and wired into
 * `GridTilePlayer` alone. `?mode=player` — the surface the native app opens for
 * one camera — never got it: reported 2026-09-20, live view on the hall
 * camera freezing repeatedly with 0.00% loss and the frame counter still
 * advancing, and the operator's only remedy was pause + play, which is the one
 * gesture that rebuilds the session.
 *
 * Pause + play working is precisely what says the session CAN be rebuilt. What
 * was missing is anything that decides to.
 *
 * This is a wiring spec (the page mounts WebRTC, a peer connection and a
 * host bridge, so it cannot be rendered here) — the same idiom as
 * `recorded-mute-wiring`. The watchdog's own behaviour is covered by
 * `embed/src/embed/__tests__/stall-watchdog*.spec.ts`; what this pins is that
 * the single-camera surface is ARMED, and that its recovery goes through the
 * reconnect the host already drives rather than a second hand-rolled path.
 */

const here = path.dirname(fileURLToPath(import.meta.url))
const page = readFileSync(path.join(here, '..', 'EmbedPlayerPage.tsx'), 'utf8')

describe('the single-camera player recovers from a frozen stream by itself', () => {
  it('arms the stall watchdog', () => {
    expect(page).toContain('useStallWatchdog')
  })

  it('gates the watchdog on the player actually believing it is streaming', () => {
    // Without this the watchdog fights the error path over a stream that is
    // legitimately still connecting — the trap the hook's own note records.
    expect(page).toMatch(/playing:\s*playerState === 'playing'/)
  })

  it('recovers through the reconnect the host already drives, not a second path', () => {
    // `reconnectNonce` is the exact path `api.reconnect()` takes, so a
    // self-healing rebuild runs the same code as a manual one.
    expect(page).toMatch(/onRecover:[\s\S]{0,200}setReconnectNonce/)
  })
})
