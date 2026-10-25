/**
 * What actually leaves the device.
 *
 * The boot timeline, the connection lifecycle trace and the live cold-start
 * timings are all written at `info`. Before this rule, `info` was never queued
 * for the hub outside debug mode — so all three existed only in the on-device
 * ring buffer, and `lifecycle-trace.ts` claimed in prose to be readable from
 * Loki while shipping nothing.
 */
import { describe, it, expect } from 'vitest'
import { shouldShip, trimShipQueue, type LogEntry } from '../logger.js'

describe('shouldShip', () => {
  it('ships faults regardless of scope or verbosity', () => {
    expect(shouldShip('warn', 'anything', false)).toBe(true)
    expect(shouldShip('error', 'anything', false)).toBe(true)
  })

  it('ships the diagnostic scopes at info in NORMAL mode', () => {
    // The point of the fix: no debug-mode switch, no operator action.
    expect(shouldShip('info', 'boot', false)).toBe(true)
    expect(shouldShip('info', 'cold-query', false)).toBe(true)
    expect(shouldShip('info', 'conn:lifecycle', false)).toBe(true)
    expect(shouldShip('info', 'events:feed', false)).toBe(true)
    expect(shouldShip('info', 'events:media', false)).toBe(true)
    expect(shouldShip('info', 'live:cold-start', false)).toBe(true)
    expect(shouldShip('info', 'media:snapshot', false)).toBe(true)
    expect(shouldShip('info', 'embed:playback', false)).toBe(true)
  })

  it('ships the scrub commit line — the app-side half of the dragId join (C1)', () => {
    // playback-machine's `commitScrub` line is the only APP-clock line naming
    // a scrub gesture's dragId; a debug-gated line would leave no trail in a
    // report filed with debug mode off, which is the exact gap this closes.
    expect(shouldShip('info', 'playback:machine', false)).toBe(true)
  })

  it('ships the system-PiP trail and the player teardown that reads against it', () => {
    // The swipe-back handoff navigates on the page's PiP answer, which unmounts
    // the player the window is anchored to. "The window came up and died" is
    // therefore only readable as two timestamps: the answer (`live:pip`) and
    // the release of the WKWebView (`live:lifecycle`). The 2026-09-01 report
    // arrived with debug mode off, so a verbose-gated trail did not exist.
    expect(shouldShip('info', 'live:pip', false)).toBe(true)
    expect(shouldShip('info', 'live:lifecycle', false)).toBe(true)
  })

  it('ships the resume/reconnect reconcile trail', () => {
    // `data/resume-reconcile.ts` logs EVERY decision, including the ones that
    // do nothing — precisely so a "the list was still stale when I came back"
    // report can be read rather than re-derived. None of it left the device,
    // and the second report of that symptom (2026-08-19) arrived with no trail.
    expect(shouldShip('info', 'data:reconcile', false)).toBe(true)
  })

  it('still withholds ordinary info chatter in normal mode', () => {
    // The allowlist is the budget: this pipe is a POST every 4 s to a hub
    // already saturated. Everything noisier belongs at `debug`.
    expect(shouldShip('info', 'live', false)).toBe(false)
    expect(shouldShip('info', 'timeline', false)).toBe(false)
  })

  it('ships everything in debug mode', () => {
    expect(shouldShip('debug', 'live', true)).toBe(true)
    expect(shouldShip('info', 'timeline', true)).toBe(true)
  })
})

describe('trimShipQueue', () => {
  const entry = (id: number, scope: string): LogEntry => ({
    id,
    ts: id,
    level: 'info',
    scope,
    msg: `m${String(id)}`,
  })

  it('drops the oldest ordinary lines when over the cap', () => {
    const queue = [entry(1, 'boot'), entry(2, 'boot'), entry(3, 'boot')]
    expect(trimShipQueue(queue, 2).map((e) => e.id)).toEqual([2, 3])
  })

  it('keeps the launch verdict the cold-query flood would otherwise erase', () => {
    // The real shape: the crash line is the FIRST of the launch, and hundreds
    // of `cold-query` lines follow before shipping is even configured.
    const queue: LogEntry[] = [entry(0, 'crash')]
    for (let i = 1; i <= 500; i += 1) queue.push(entry(i, 'cold-query'))

    const trimmed = trimShipQueue(queue, 400)

    expect(trimmed).toHaveLength(400)
    expect(trimmed.some((e) => e.scope === 'crash')).toBe(true)
    // Still oldest-first eviction for everything else, and still in order.
    expect(trimmed[0]?.id).toBe(0)
    expect(trimmed[trimmed.length - 1]?.id).toBe(500)
  })

  it('leaves a queue under the cap untouched', () => {
    const queue = [entry(1, 'crash'), entry(2, 'boot')]
    expect(trimShipQueue(queue, 10)).toBe(queue)
  })
})
