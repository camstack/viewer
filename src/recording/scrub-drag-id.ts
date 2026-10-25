/**
 * Per-gesture scrub drag id.
 *
 * The app's own `commitScrub`/`playback:intent`/`playback:ready` lines carry
 * the PHONE's clock; the hub's `scrub-feeder:*`/`recorded:seek-*` lines carry
 * the HUB's — the two cannot be ordered against each other (2026-08-26: two
 * commits reached `playback:intent` with no matching `playback:ready`, and the
 * cause stayed unproven for exactly this reason). This id is the join key
 * instead: minted once when a drag BEGINS, carried unchanged through every
 * line the gesture produces — including its commit — on both the `scrubStart`/
 * `scrubCommit` wire messages (optional there; see `control-protocol.ts` on the
 * hub) and the local diagnostic log lines that never touch the wire at all.
 *
 * A monotonic counter, not `Math.random()`: this id only has to disambiguate
 * gestures within ONE client session's own log stream — the hub already tags
 * every line with `sessionId`/`deviceId` for cross-session disambiguation — and
 * a counter keeps generation fully deterministic (two calls in a row are
 * trivially provably different, no clock or RNG to mock in a test).
 */
let dragCounter = 0

export function generateDragId(): string {
  dragCounter += 1
  return `drag-${dragCounter}`
}
