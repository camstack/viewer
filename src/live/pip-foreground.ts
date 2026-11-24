/**
 * What a return to the foreground does while the video may still be in system
 * PiP. Pure, so the gate is testable without a WebView.
 *
 * The failure it prevents: the operator returns by tapping the app icon with
 * PiP still up, and the host used to rebuild the peer on the SAME `<video>`
 * that WebKit was still presenting in the PiP window. The restore to inline
 * landed on a swapped element mid-transition and the app took no touch.
 * Rule: never touch the stream while the page is presenting PiP — ask the page
 * to leave PiP, and rebuild only afterwards, and only if the stream needs it.
 */

/** PiP exit settles on the page's `inline` report; give the compositor a beat. */
export const PIP_RESTORE_SETTLE_MS = 500
/** The `inline` report never came (page gone, element replaced): stop waiting. */
export const PIP_RESTORE_FALLBACK_MS = 5000

export const PIP_MODE_ACTIVE = 'picture-in-picture'

export type ForegroundAction =
  /** Not a return from background — nothing to do. */
  | 'none'
  /** Peer may be dead: rebuild it now. */
  | 'reconnect'
  /** Page is presenting PiP: ask it to leave, rebuild only after `inline`. */
  | 'exit-pip-then-reconnect'

export interface ForegroundInput {
  readonly backgrounded: boolean
  readonly lastPipMode: string | null
}

export function decideForeground(input: ForegroundInput): ForegroundAction {
  if (!input.backgrounded) return 'none'
  return input.lastPipMode === PIP_MODE_ACTIVE ? 'exit-pip-then-reconnect' : 'reconnect'
}

/**
 * After the PiP window closed: does the peer need rebuilding? Assumption, not
 * yet proven on a device: PiP keeps the page's media alive in the background,
 * so a stream that is still `playing` was never suspended and a rebuild would
 * only re-stall it. Anything else is rebuilt.
 */
export function needsReconnectAfterPipExit(playerState: string): boolean {
  return playerState !== 'playing'
}

/** Ask WebKit to bring the video back inline. Guarded, ES5, ends truthy. */
export const PIP_EXIT_SCRIPT: string =
  `(function(){var v=document.querySelector('video');` +
  `if(v&&typeof v.webkitSetPresentationMode==='function'&&v.webkitPresentationMode==='picture-in-picture'){` +
  `try{v.webkitSetPresentationMode('inline');}catch(e){}}` +
  `else if(document.pictureInPictureElement&&document.exitPictureInPicture){` +
  `try{document.exitPictureInPicture();}catch(e){}}})(); true;`
