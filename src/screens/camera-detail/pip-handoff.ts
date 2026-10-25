/**
 * System Picture-in-Picture, asked of the player in the one order that works.
 *
 * Both legs are asynchronous and neither reports through a return value, which
 * is why the order lives in one place instead of inside the screen:
 *
 *  - From recorded playback the player must return to the live edge FIRST
 *    (`shouldGoLiveBeforePip`), and going live REMOUNTS the embed — PiP asked
 *    of the dying session pictures the playhead, or nothing.
 *  - The request is answered by the PAGE (`pip-request.ts`), never by a timer.
 *
 * What this module deliberately no longer does: NAVIGATE. The swipe used to
 * hand the session to PiP and then leave the screen, and that is what killed
 * the window. Measured on the device on 2026-09-01 (the parking guard spec in
 * `__tests__/` carries the trace): a WKWebView that is
 * not VISIBLE — unmounted or merely parked off screen, WebKit does not
 * distinguish — is throttled within ~7 s, its `<video>` stalls and the PiP
 * window closes on its own. The PiP that survives is the one requested while
 * the operator STAYS on the screen, which is what the PiP disc has always done.
 * So the swipe is now the disc: it starts system PiP and the screen stays.
 *
 * The operator's full wish — "PiP, then the app in the background" — has no
 * second half an app can perform. iOS has no public API that sends an app to
 * the background (`UIApplication.suspend` is private and a review rejection),
 * and `AVPictureInPictureController.canStartPictureInPictureAutomaticallyFromInline`
 * belongs to a native AVPlayerLayer / sample-buffer player, not to a `<video>`
 * inside a WKWebView. The honest sequence is therefore: the swipe (or the disc)
 * starts system PiP, the operator presses Home, and the window is the system's
 * from then on. What keeps the session fed in the background is the audio
 * background mode (`UIBackgroundModes: ["audio"]`, Playback category set by
 * `withAudioSessionControl`), and the operator verified on the device that a
 * window STARTED by the disc does survive the app being backgrounded. What
 * cannot be done is starting one on the way out — see the removal record below.
 *
 * ## Automatic PiP on departure: built, measured, REMOVED (2026-09-13)
 *
 * Do not rebuild it. "Hand the picture to system PiP when the operator closes
 * the app" shipped twice and cannot work from an HTML `<video>` inside a
 * WKWebView. This is settled by Apple's documentation, not by inference.
 *
 * The second attempt armed a page-side handler that fired on
 * `visibilitychange` → `document.hidden` and called
 * `webkitSetPresentationMode('picture-in-picture')`. Two device runs produced
 * the identical trail:
 *
 * ```
 *   live:pip  page left → PiP asked on the way out   {reason: 'asked-webkit'}
 *   live:pip  presentation mode changed              {mode: 'picture-in-picture'}
 *  +176 ms    presentation mode changed              {mode: 'inline'}
 * ```
 *
 * No window ever appeared. Apple's developer-forum thread 819235 ("How to enter
 * Picture-in-Picture on background from inline playback in WKWebView") names
 * all three mechanisms and rules each out for an inline `<video>`:
 *
 *  - `autopictureinpicture` is IGNORED from inline playback (fullscreen only);
 *  - `requestPictureInPicture()` inside a `visibilitychange` handler fails with
 *    "not triggered by user activation";
 *  - `webkitSetPresentationMode('picture-in-picture')` inside a
 *    `visibilitychange` handler FIRES the event and the window never appears —
 *    exactly the 176 ms round trip above.
 *
 * Apple's own guidance is the rule underneath all three: "Only begin PiP
 * playback in response to user interaction and never programmatically."
 *
 * The one API that DOES start PiP automatically from inline playback is
 * `AVPictureInPictureController.canStartPictureInPictureAutomaticallyFromInline`,
 * which belongs to a native `AVPlayerViewController` / sample-buffer player. It
 * is unreachable from a `<video>` in a WKWebView — which is why apps that
 * manage this (Twitch) ship a native player, not a WebView. Reaching it here
 * would mean replacing the embed player with a native one, not a flag.
 *
 * What survives is the PiP disc: user-initiated, measured to work, and verified
 * by the operator to survive backgrounding once the window is up.
 *
 * The ports are injected so the sequence is asserted by value in node — the
 * screen supplies the effects, this file owns the order.
 */
import type { PipStartResult } from '../../live/pip-request.js'
import type { PlaybackMode } from '../../recording/playback-machine.js'
import { shouldGoLiveBeforePip } from './pip-live.js'

/** How the go-live leg ended. `failed` = the player reported an error; there
 *  will be no live session to picture, so PiP is not even attempted. */
export type GoLiveOutcome = 'live' | 'failed'

/** The effects the sequence drives, as the screen implements them. */
export interface PipRequestPorts {
  /** The playback machine's mode AT THE MOMENT OF THE REQUEST. */
  readonly mode: PlaybackMode
  /** Leave recorded playback (remounts the embed). */
  readonly goLive: () => void
  /** Resolves when the remounted player is live AND playing, or failed.
   *  Never resolves on a timer — see `pip-live.ts` for the gate it mirrors. */
  readonly awaitLive: () => Promise<GoLiveOutcome>
  /** Ask the player for system PiP; resolves with the page's own answer. */
  readonly startPip: () => Promise<PipStartResult>
}

/**
 * Put the session into system PiP, going live first when it has to. The
 * screen stays mounted whatever the answer: `unconfirmed` means the request is
 * out and the platform has not replied, and a second swipe on a video already
 * in PiP is answered instantly (`already`).
 */
export async function requestSystemPip(ports: PipRequestPorts): Promise<PipStartResult> {
  if (shouldGoLiveBeforePip(ports.mode)) {
    ports.goLive()
    if ((await ports.awaitLive()) === 'failed') return 'unavailable'
  }
  return ports.startPip()
}
