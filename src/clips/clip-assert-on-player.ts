/**
 * clip-assert-on-player — the clip the stage HOLDS is asserted to the player
 * whenever a player is there to hear it.
 *
 * ## The failure this closes, measured
 *
 * The clip command was fired exactly once, at the tap, and dropped if
 * `liveRef.current` was null. Trace from the operator's session, 2026-09-22:
 *
 * ```
 * 08:13:39  open: port   hasPlayer: false      ← tap dropped
 * 08:13:39  connecting ×3, mount→playing 690ms ← the tap MOUNTED the player
 * 08:13:47  open: port   hasPlayer: true  → playClip → the clip plays
 * 08:13:59  playing → connecting               ← reconnect, the clip is gone
 * 08:14:19  open: port   hasPlayer: false      ← dropped again
 * ```
 *
 * So: tap a clip, the player is born *because of that tap*, and it is born on
 * the LIVE edge. Exactly what the operator reported — *"faccio partire una
 * clip → parte la live"* — and why prev/next appeared to do nothing: they run
 * the same dispatch and it lands in the same hole.
 *
 * `initialClip` was supposed to cover this by carrying the clip into the
 * MOUNT, and it does — when there really is no component yet. But the config
 * is read AT PAGE LOAD only, and `liveRef.current === null` does not mean
 * "not mounted": it also means "mounted this very render, ref not attached
 * yet", and for that case setting `initialClip` changes a payload nobody will
 * read again. One branch, two situations, and the second one is silent.
 *
 * ## The rule
 *
 * A clip on the stage is not an event that happened once; it is a STATE. So it
 * is re-asserted, idempotently, every time the player becomes available — and
 * a reconnect, which drops the clip on the server side too, is exactly such a
 * moment. Fire-once is what makes a dropped command unrecoverable.
 *
 * Pure: no React, no refs, no network.
 */

/** What the stage holds, as far as this rule cares. */
export interface ClipAssertionInput {
  /** The clip the stage is holding, or null when the session owns the frame. */
  readonly heldClipId: string | null
  /** True when there is a player object to command RIGHT NOW. */
  readonly playerPresent: boolean
  /**
   * The player's own connection state. A player that is `connecting` has a ref
   * but no channel yet, and a command sent into it is the same silent drop
   * wearing a different hat.
   */
  readonly playerState: 'connecting' | 'playing' | 'paused' | 'error' | string
  /**
   * The `(clipId, session)` pair already asserted to THIS player instance.
   * Null when nothing has been asserted since the player last came up.
   */
  readonly assertedClipId: string | null
}

/**
 * Should the clip be (re)sent to the player now?
 *
 * False when there is nothing held, when there is no player or it cannot yet
 * listen, and when this very clip has already been asserted to this player.
 * The caller clears `assertedClipId` when the player goes away, which is what
 * makes a reconnect re-assert rather than assume.
 */
export function shouldAssertClip(input: ClipAssertionInput): boolean {
  if (input.heldClipId === null) return false
  if (!input.playerPresent) return false
  // `error` is not a player that can take a command, and `connecting` has no
  // channel. Anything else means the page is up and listening.
  if (input.playerState === 'connecting' || input.playerState === 'error') return false
  return input.assertedClipId !== input.heldClipId
}

/**
 * What the assertion record becomes after a player transition.
 *
 * A player that is gone or failed has forgotten everything it was told, so the
 * record is cleared — keeping it is what would make the re-assert above decide
 * the clip is already playing when the session that heard it no longer exists.
 */
export function assertionAfterPlayerChange(
  previous: string | null,
  playerPresent: boolean,
  playerState: string,
): string | null {
  if (!playerPresent) return null
  if (playerState === 'connecting' || playerState === 'error') return null
  return previous
}
