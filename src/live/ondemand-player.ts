/**
 * ondemand-player — the ON-DEMAND playback overlay's decisions, as pure
 * functions (D483).
 *
 * The operator asked for a second player, opened on demand on a tablet or a
 * wide web window, showing recorded playback from a given instant, with a
 * compact scrub/live timeline — and reachable from two places: the "go to this
 * moment" button in a track detail, and a card in the tablet camera reel.
 *
 * ## What this module is NOT
 *
 * It is not a transport, and it is not a second playback implementation.
 * Everything the overlay needs already exists and is instanced by design:
 *
 *  - `LiveViewProps.initialSeekMs` → `EmbedConfig` →
 *    `embed/src/playback/initial-seek.ts`, which fires `warm(epochMs)` +
 *    `playRecorded(deviceId, epochMs, profile)` the moment the control channel
 *    opens. "A player that opens at an instant" is a shipped path.
 *  - `usePlaybackMachine(sink, isPlayerLive)` is hook-local on purpose — its
 *    own docblock says a store "would leak one camera's playhead into another".
 *    A second overlay is a second instance of machinery built to be instanced.
 *
 * So the only genuinely new decisions are the four below, and they are here
 * because none of them can be asserted against a component's pixels.
 *
 * ## The instant is REQUIRED
 *
 * {@link OnDemandRequest} has no optional `atMs`, and that is the D382
 * discipline in this transport's vocabulary rather than a borrowing of its
 * mechanism. D382's `/preroll-<ms>` governs an RTSP restream dial
 * (`stream-broker/rtsp/restream-intent.ts`) and its consumers are the events
 * recorder, the detection decode worker and muted re-clocked legs — the viewer
 * is not one of them. Under D42 a viewer has ONE media session whose source
 * POINTER moves, so there is no history window to over-ask for. What survives
 * is the rule that made D382 necessary: an unstated ask must not be decided by
 * its own absence. An optional `atMs` would read as "open live" at every call
 * site that forgot it, so it cannot be optional.
 */
import { shouldUseWideDetail, type ViewportInput } from '../hooks/sidebar-rules.js'
import { viewedInstant } from '../recording/viewed-instant.js'

/**
 * The instant an overlay opens at: an epoch, or the LIVE edge, said in so many
 * words.
 *
 * `'live'` is a value and not an absence, so the D382 rule above still holds —
 * every call site states what it wants. What it must never be is wall-clock
 * `Date.now()`: the embed reads any number as `initialSeekMs` and enters
 * RECORDED playback there (`embed/src/playback/initial-seek.ts`), and "now" is
 * past the archive's edge — the hub's feeder snaps it back to the last
 * millisecond of the newest CLOSED segment and then waits for the next one to
 * close. That was the overlay "not starting" until pause → play or several
 * seconds later (operator report on 1.0.588): a live card opening a recorded
 * session parked at the archive head.
 */
export type OnDemandInstant = number | 'live'

/**
 * What both entry points ask for: this camera, at this instant, in the second
 * player. One contract, because the two entry points mean the same thing — the
 * track detail supplies the event's instant, the reel supplies the one the
 * operator is already looking at.
 */
export interface OnDemandRequest {
  readonly deviceId: number
  /** Epoch ms, or `'live'`. REQUIRED — see the module docblock and
   *  {@link OnDemandInstant}. */
  readonly atMs: OnDemandInstant
}

/** A "go to this moment" ask: always a real instant (an event's). */
export interface MomentRequest extends OnDemandRequest {
  readonly atMs: number
}

/** Where a "go to this moment" press lands. */
export type SeekRoute =
  | { readonly kind: 'onDemand'; readonly request: MomentRequest }
  | { readonly kind: 'navigate'; readonly deviceId: number; readonly atMs: number }

/**
 * Is this surface one the operator scoped the overlay to — "schermi medi/grandi
 * come tablet mobile e web"?
 *
 * Delegated to `shouldUseWideDetail`, which already answers exactly that
 * question for the camera theater: a TABLET-PROPORTIONED viewport in landscape,
 * or a web window at least `DETAIL_WIDE_MIN_WIDTH` wide.
 *
 * Note what the first clause means on web, because "web >= 1000pt" is the
 * intuition and it is wrong: there is no device screen to ask, so
 * `isTabletViewport` falls back to the WINDOW, and a landscape browser window
 * whose shorter side is at least `TABLET_MIN_SIDE` qualifies below 1000pt — a
 * 900x800 window gets the overlay. `ondemand-player.spec.ts` pins both clauses
 * so the surprise is recorded rather than rediscovered.
 *
 * Reused rather than re-derived for two reasons. It is the authority the tablet camera reel is ALREADY gated behind
 * (`camera-shelf.ts` is `wide`-only), so one of the two entry points cannot
 * physically exist on a surface this refuses — a second threshold could only
 * ever disagree with that. And its docblock forbids widening it without the
 * operator, after they rejected a landscape-phone split on OTA 1.0.263; a
 * private breakpoint here would be that widening under another name.
 */
export function canOpenOnDemand(input: ViewportInput): boolean {
  return shouldUseWideDetail(input)
}

/**
 * The ONE routing decision behind "go to this moment", shared by all three
 * press sites (`EventsScreen`, `CamerasScreen`, `CameraDetailScreen`).
 *
 * Below the gate the behaviour is byte-for-byte today's: push
 * `/camera/<id>?at=<epoch>`. This change therefore adds a surface and removes
 * none — the button keeps working on every phone, it simply stops replacing the
 * screen (and losing the track detail) where there is room not to.
 */
export function resolveSeekRoute(input: ViewportInput, request: MomentRequest): SeekRoute {
  if (canOpenOnDemand(input)) return { kind: 'onDemand', request }
  return { kind: 'navigate', deviceId: request.deviceId, atMs: request.atMs }
}

/**
 * The instant a REEL card means: "camera B at the moment I am looking at".
 *
 * `activeEpoch` is the primary playback machine's own pointer — the value its
 * indicator is drawn at — so the two pictures are at the same instant by
 * construction rather than by a second query. `null` is that machine's live
 * edge (`PlaybackState.playhead`: "`null` ⟺ live, rendered from wall-clock"),
 * and it answers `'live'` — NEVER wall-clock now, which the embed would open as
 * a recorded seek past the archive's edge (see {@link OnDemandInstant}).
 *
 * Deliberately NOT "camera B live": `addToView` already puts B's live picture
 * on screen beside A, and a second road to the same place is not a use case.
 * And deliberately not "B's last event": that needs a query, can answer with
 * nothing, and would silently mean a different time on every card.
 *
 * Delegates to `recording/viewed-instant.ts`, which is the ONE place that
 * answers "what moment is the operator looking at" — the reel TAP (which swaps
 * the screen) reads the same answer, and applies the opposite rule to the
 * degenerate case. See that module for why the answer is a union and not a
 * `number | null` the two call sites each `?? nowMs` for themselves.
 */
export function resolveReelInstant(activeEpoch: number | null): OnDemandInstant {
  const instant = viewedInstant(activeEpoch)
  return instant.kind === 'at' ? instant.atMs : 'live'
}

/**
 * What a camera CARD's floating-window button asks for: that camera, live.
 *
 * The card shows no playhead, so there is no instant to carry — and the one it
 * used to invent (`Date.now()`) is the recorded seek past the archive's edge
 * {@link OnDemandInstant} describes.
 */
export function liveOnDemandRequest(deviceId: number): OnDemandRequest {
  return { deviceId, atMs: 'live' }
}

/**
 * The `initialSeekMs` the overlay's player is mounted with: the instant, or
 * NOTHING for live — the embed's live path is the absence of a seek, exactly as
 * `?at=` is absent for a live swap (`recording/viewed-instant.ts`, `atParam`).
 */
export function onDemandSeedSeekMs(request: OnDemandRequest): number | undefined {
  return request.atMs === 'live' ? undefined : request.atMs
}

/**
 * Whether the overlay's transport starts BUSY (the ring around its play
 * button) when the player mounts for `request`.
 *
 * The ring is cleared only by the embed's `recState` report, and that is a
 * RECORDED-playback message: a live session never sends one. So a live mount
 * that started busy rang the play button for as long as the window stayed
 * open, over a picture that was already playing. Only a mount with a seed
 * starts busy — its recorded session reports the moment it settles.
 */
export function onDemandStartsLoading(request: OnDemandRequest): boolean {
  return onDemandSeedSeekMs(request) !== undefined
}

/**
 * Keep an open request only while its camera is still one the app lists.
 *
 * The overlay now survives navigation, so navigation no longer closes it and
 * something must: an overlay that outlives its own subject is the next defect.
 * This is the `ReopenLastCameraBridge` rule ("refuses a camera that is gone or
 * disabled") and `resolveCellPanel`'s ("kept only while its camera is still one
 * the shelf could have offered"), at this scope.
 *
 * `undefined` means the camera list has not ANSWERED and the request is KEPT.
 * That is the one place this deliberately does not copy its neighbour:
 * `CameraDetailScreen` calls `resolveCellPanel(cellPanel, (allCameras ?? []).map(…))`,
 * and `?? []` makes a cold cache indistinguishable from an empty hub. For a
 * panel that costs a re-tap; here it would tear down a live media session on
 * every cold start and every transport blip. Not-yet-known is never gone
 * (D315).
 */
export function resolveOnDemandOpen(
  request: OnDemandRequest | null,
  knownCameraIds: readonly number[] | undefined,
): OnDemandRequest | null {
  if (request === null) return null
  if (knownCameraIds === undefined) return request
  return knownCameraIds.includes(request.deviceId) ? request : null
}

/**
 * Drop an open request when the operator ARRIVES on that camera's own screen.
 *
 * The overlay survives navigation by construction, which is what the operator
 * asked for — and it is also why opening camera X full-screen used to leave two
 * pictures of X on one screen, in two media sessions, each with its own
 * transport. One of them is redundant, and the small one is the one the
 * operator did not just ask for.
 *
 * Scoped to the CAMERA and not to navigating: a DIFFERENT camera in the overlay
 * while a camera is open full-screen is the feature itself ("watch B while I
 * look at A"), so only the collision closes anything.
 *
 * An ARRIVAL and not a standing condition, which is the half that is easy to
 * get wrong: `onSwipeToOverlay` opens the overlay on the camera whose screen is
 * still mounted and leaves only afterwards. A rule re-judged on every render
 * would delete that gesture's product in the gap between its two halves.
 */
export function resolveOnDemandOnFocus(
  request: OnDemandRequest | null,
  focusedDeviceId: number,
): OnDemandRequest | null {
  if (request === null) return null
  return request.deviceId === focusedDeviceId ? null : request
}
