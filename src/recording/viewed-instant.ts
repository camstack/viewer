/**
 * viewed-instant — "what moment is the operator looking at", once (D483).
 *
 * Three gestures ask this question and they had started to answer it
 * separately, which is how they drift:
 *
 *   | gesture                        | what it does with the answer          |
 *   | ------------------------------ | ------------------------------------- |
 *   | tap a reel card                | swap the screen to B at that moment   |
 *   | reel card → on-demand player   | open B BESIDE, at that moment         |
 *   | track detail → on-demand player| (its own instant — the event's)       |
 *
 * The first two read this module. The third supplies an instant of its own and
 * needs nothing from here.
 *
 * ## Why a union and not `number | null`
 *
 * Because "live" must stay a STATEMENT all the way to the player. Both
 * consumers open the camera LIVE when the primary is live, and both must not
 * be handed wall-clock `now` instead: the embed reads any instant as a
 * recorded seek, and "now" is past the archive's edge — a recorded feeder, a
 * seek snapped back to the newest closed segment, and a picture that sits at
 * the archive head until the next segment closes.
 *
 * The overlay used to take exactly that `now` (its contract had no way to say
 * live), on the reasoning that "the embed's own live path takes over". It does
 * not: the overlay opened from a live card did not start until pause → play or
 * several seconds later (operator report, viewer 1.0.588). It now says
 * `'live'` (`live/ondemand-player.ts`, `OnDemandInstant`), and the swap says it
 * with the absence of `?at=` ({@link atParam}).
 *
 * Pure, and deliberately NOT a hook: the machine's `selectActiveEpoch` is the
 * input, so every surface reads the same pointer the indicator is drawn at.
 */

/** The moment a player surface is showing. */
export type ViewedInstant =
  | { readonly kind: 'live' }
  | { readonly kind: 'at'; readonly atMs: number }

const LIVE: ViewedInstant = { kind: 'live' }

/**
 * The viewed instant for a playback machine's active epoch.
 *
 * `null` is the machine's live edge — `PlaybackState.playhead`'s own docblock:
 * "`null` ⟺ live (the live edge is rendered from wall-clock now, never from the
 * poller)". Epoch `0` is a real instant and must not be read as absent, which
 * is why this takes `number | null` and tests it explicitly.
 */
export function viewedInstant(activeEpoch: number | null): ViewedInstant {
  return activeEpoch === null ? LIVE : { kind: 'at', atMs: activeEpoch }
}

/**
 * The route query a "switch to this camera" navigation carries — `?at=<epoch>`
 * off the live edge, and NOTHING while live.
 *
 * `?at=` is the vocabulary the app already has for "open this camera at this
 * instant": `EventsScreen` and `CamerasScreen` push it, `CameraDetailScreen`
 * takes it as `initialSeekMs`, and the embed consumes it at load
 * (`embed/src/playback/initial-seek.ts`). So the swap needs no new language,
 * and the empty string for live is what keeps "open live" expressed by the
 * ABSENCE of the param rather than by a value that means almost-live.
 */
export function atParam(instant: ViewedInstant): string {
  return instant.kind === 'at' ? `?at=${Math.round(instant.atMs)}` : ''
}
