/**
 * System Picture-in-Picture, asked of the embed page and CONFIRMED by it.
 *
 * The host drives PiP by injecting script into the player WebView, and neither
 * platform API answers the question the caller actually has:
 * `webkitSetPresentationMode()` returns void, and a request that the system
 * refuses (no PiP entitlement, no frames yet, another PiP already up) looks
 * exactly like one that worked. The callers that MUST know are the PiP disc
 * and the downward fling: both keep the screen mounted (leaving it is what
 * closes the window — `screens/camera-detail/pip-handoff.ts`), and the
 * answer is what the `live:pip` trail records against the window's fate.
 *
 * So the page reports back. The platform's own event is the signal:
 * `webkitpresentationmodechanged` on iOS/WebKit, the `requestPictureInPicture()`
 * promise everywhere else. Everything the script can decide by itself (no
 * video, no API) is answered synchronously.
 */

/**
 * What a PiP request came to.
 *
 * `unconfirmed` is NOT a failure: the request was made and the platform never
 * answered within the bound. The caller must treat it as "the session may be
 * moving into PiP" and leave the player mounted — the one thing it must never
 * do is tear the player down on it.
 */
export type PipStartResult = 'started' | 'unavailable' | 'unconfirmed'

/** The page's answer: did the video actually enter PiP, and why not. */
export interface PipReport {
  readonly active: boolean
  /** Diagnostic only ('no-video', 'unsupported', the presentation mode, the
   *  rejection message). Never parsed — logged. */
  readonly reason?: string
}

/**
 * How long the host waits for the page's answer before it stops waiting.
 *
 * This bound decides only when to STOP LISTENING. It never stands in for a
 * confirmation: a request that times out resolves `unconfirmed`, and the caller
 * keeps the player. A timer that assumed success would be the random delay this
 * whole module exists to avoid.
 */
export const PIP_CONFIRM_TIMEOUT_MS = 4000

/**
 * Injected into the player WebView. Asks for PiP and posts exactly ONE
 * `{type:'pip'}` message back — never before the platform has answered.
 *
 * Written as ES5 in one expression because it is evaluated by
 * `injectJavaScript`, which needs a script that ends in a truthy value.
 */
export const PIP_REQUEST_SCRIPT: string =
  `(function(){` +
  `var post=function(active,reason){` +
  `window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(` +
  `JSON.stringify({type:'pip',active:active,reason:reason}));};` +
  `var v=document.querySelector('video');` +
  `if(!v){post(false,'no-video');return;}` +
  `if(typeof v.webkitSetPresentationMode==='function'){` +
  // Already there (a second swipe after an unconfirmed first): answer now.
  `if(v.webkitPresentationMode==='picture-in-picture'){post(true,'already');return;}` +
  `var onChange=function(){` +
  `v.removeEventListener('webkitpresentationmodechanged',onChange);` +
  `post(v.webkitPresentationMode==='picture-in-picture',String(v.webkitPresentationMode));};` +
  `v.addEventListener('webkitpresentationmodechanged',onChange);` +
  `v.webkitSetPresentationMode('picture-in-picture');` +
  `return;}` +
  `if(typeof v.requestPictureInPicture==='function'){` +
  `v.requestPictureInPicture().then(function(){post(true,'promise');},` +
  `function(e){post(false,String((e&&e.message)||e));});` +
  `return;}` +
  `post(false,'unsupported');})(); true;`

/** Narrow an untrusted page→host payload to a PiP report, or null. */
export function parsePipReport(raw: string): PipReport | null {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof data !== 'object' || data === null) return null
  const obj = data as Record<string, unknown>
  if (obj.type !== 'pip' || typeof obj.active !== 'boolean') return null
  const reason = typeof obj.reason === 'string' ? obj.reason : undefined
  return reason === undefined ? { active: obj.active } : { active: obj.active, reason }
}

/** A PiP request in flight: it consumes the page's answer, or the wait bound. */
export interface PipConfirmation {
  /** Feed every page→host message. True when this one WAS the answer. */
  readonly report: (raw: string) => boolean
  /** The wait bound elapsed without an answer. */
  readonly expire: () => void
}

/**
 * Arm a single PiP request. `settle` is called EXACTLY once — by the page's
 * report, or by the bound elapsing, whichever comes first, and never by both.
 *
 * The rule this encodes: an elapsed bound settles `unconfirmed`, never
 * `started`. Nothing but the platform's own answer may say PiP is up.
 */
export function awaitPipConfirmation(settle: (result: PipStartResult) => void): PipConfirmation {
  let done = false
  return {
    report: (raw: string): boolean => {
      if (done) return false
      const parsed = parsePipReport(raw)
      if (parsed === null) return false
      done = true
      settle(parsed.active ? 'started' : 'unavailable')
      return true
    },
    expire: (): void => {
      if (done) return
      done = true
      settle('unconfirmed')
    },
  }
}

/**
 * The page's presentation mode, reported on EVERY change — for as long as the
 * page lives.
 *
 * `awaitPipConfirmation` answers one question once ("did it come up?") and then
 * stops listening. That leaves the opposite question unanswerable, and it is
 * the one an operator report actually asks: the window came up and DIED — who
 * killed it?
 *
 * Two candidates produce the same picture and are told apart only by whether a
 * line exists:
 *  - the PAGE left PiP (the video was replaced, the stream ended, the operator
 *    closed the window) → this reporter posts `inline` while the host is still
 *    alive to receive it;
 *  - the HOST tore the player down (the swipe navigates, the route unmounts,
 *    the WKWebView is released) → the JS context dies first, so NO line is
 *    posted and the player's own teardown line is the last thing in the log.
 *
 * Blind spot, stated rather than discovered later: the listener is attached to
 * ONE `<video>`, so an element the embed REPLACES takes the reporter with it
 * and is silent like an unmount. Re-arm after any deliberate stream swap.
 */
export interface PipModeReport {
  /** `picture-in-picture` | `inline` | `fullscreen` — whatever the platform said. */
  readonly mode: string
}

/**
 * Injected once per `<video>`; idempotent, so re-arming on every PiP request
 * costs nothing and never stacks listeners.
 *
 * ES5, one expression, ends truthy — `injectJavaScript` requires it.
 */
export const PIP_MODE_WATCH_SCRIPT: string =
  `(function(){` +
  `var v=document.querySelector('video');` +
  `if(!v||v.__camstackPipWatch){return;}` +
  `v.__camstackPipWatch=1;` +
  `var post=function(mode){` +
  `window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(` +
  `JSON.stringify({type:'pipmode',mode:String(mode)}));};` +
  `if(typeof v.webkitSetPresentationMode==='function'){` +
  `v.addEventListener('webkitpresentationmodechanged',function(){post(v.webkitPresentationMode);});` +
  `return;}` +
  `v.addEventListener('enterpictureinpicture',function(){post('picture-in-picture');});` +
  `v.addEventListener('leavepictureinpicture',function(){post('inline');});})(); true;`

/** Narrow an untrusted page→host payload to a presentation-mode report, or null. */
export function parsePipModeReport(raw: string): PipModeReport | null {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof data !== 'object' || data === null) return null
  const obj = data as Record<string, unknown>
  if (obj.type !== 'pipmode' || typeof obj.mode !== 'string') return null
  return { mode: obj.mode }
}
