/**
 * Browser Fullscreen API hook (web). On native this is a harmless no-op (the
 * native fullscreen path uses ScreenOrientation elsewhere). Attach `ref` to the
 * container you want to fill; call `toggle()` from the fullscreen button —
 * but ask `mode` first, once, up front ({@link decideWebFullscreenMode}).
 *
 * On a phone the native button FORCES landscape and a second press restores
 * what was there before. The web does the same where it can: fullscreen, then
 * `screen.orientation.lock('landscape')`; a second press (or leaving
 * fullscreen any other way — Esc, the back gesture) unlocks and exits. Where
 * landscape cannot be forced the answer depends on the device:
 *
 *  - a DESKTOP (fine pointer) keeps plain fullscreen — orientation means
 *    nothing on a monitor;
 *  - a TOUCH device (iPhone/iPad Safari, an installed iOS PWA, any browser
 *    without `orientation.lock`) gets NO button: a fullscreen that stays
 *    portrait is not what the button promises, and on iPhone there is no
 *    fullscreen API at all.
 *
 * Decided by feature detection, never by catching a failed press, and logged
 * once per session.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Platform, type View } from 'react-native'
import { log } from '../lib/logger.js'

/**
 * What the fullscreen button does on this web client.
 *
 *  - `lock-landscape` — browser fullscreen + landscape lock (Android Chrome).
 *  - `plain`          — browser fullscreen, orientation untouched (desktop).
 *  - `app-fill`       — no browser API on a desktop (an iframe without
 *                       `allowfullscreen`): the screen's own `fill` layout.
 *  - `hidden`         — a touch device that cannot force landscape: no button.
 */
export type WebFullscreenMode = 'lock-landscape' | 'plain' | 'app-fill' | 'hidden'

/** What the decision reads, detected once from the running browser. */
export interface WebFullscreenEnv {
  /** `document.fullscreenEnabled === true`. */
  readonly fullscreenEnabled: boolean
  /** `typeof screen.orientation.lock === 'function'`. */
  readonly orientationLock: boolean
  /** The PRIMARY pointer is coarse (`(pointer: coarse)`): a touch device. */
  readonly coarsePointer: boolean
}

export interface WebFullscreenDecision {
  readonly mode: WebFullscreenMode
  readonly reason: string
}

/** The one decision. Pure: the caller detects, this decides. */
export function decideWebFullscreenMode(env: WebFullscreenEnv): WebFullscreenDecision {
  if (!env.coarsePointer) {
    return env.fullscreenEnabled
      ? { mode: 'plain', reason: 'desktop: fullscreen without an orientation lock' }
      : { mode: 'app-fill', reason: 'desktop without the fullscreen API: the app fill layout' }
  }
  if (!env.fullscreenEnabled) {
    return { mode: 'hidden', reason: 'touch device without the fullscreen API (iPhone Safari / iOS PWA)' }
  }
  if (!env.orientationLock) {
    return { mode: 'hidden', reason: 'touch device that cannot lock landscape (no screen.orientation.lock)' }
  }
  return { mode: 'lock-landscape', reason: 'touch device: fullscreen + landscape lock' }
}

/** Whether the button is shown at all in a mode. */
export function webFullscreenButtonShown(mode: WebFullscreenMode): boolean {
  return mode !== 'hidden'
}

/** Whether a mode goes through the BROWSER API (vs the app's own `fill`). */
export function usesBrowserFullscreen(mode: WebFullscreenMode): boolean {
  return mode === 'lock-landscape' || mode === 'plain'
}

/** The one property of `document` the support check reads. */
export interface FullscreenCapableDocument {
  readonly fullscreenEnabled?: boolean
}

/**
 * Whether the Fullscreen API is usable in this document. `fullscreenEnabled`
 * is `undefined` where the API does not exist (iPhone Safari) and `false`
 * where it exists but is forbidden (an iframe without `allowfullscreen`);
 * only an explicit `true` means a request can succeed.
 */
export function isWebFullscreenSupported(doc: FullscreenCapableDocument | null | undefined): boolean {
  return doc?.fullscreenEnabled === true
}

/** The slice of `ScreenOrientation` the controller drives. */
export interface OrientationLocker {
  readonly lock?: (orientation: 'landscape') => Promise<void>
  readonly unlock?: () => void
}

/** The slice of `document` the controller drives. */
export interface FullscreenDocument {
  readonly fullscreenElement: object | null
  readonly exitFullscreen: () => Promise<void>
}

/** The slice of an `Element` the controller asks to go fullscreen. */
export interface FullscreenTarget {
  readonly requestFullscreen?: () => Promise<void>
}

export interface WebFullscreenControllerDeps {
  readonly doc: FullscreenDocument
  readonly orientation: OrientationLocker | null
  readonly mode: WebFullscreenMode
  readonly warn: (msg: string, data: { readonly error: string }) => void
}

export interface WebFullscreenController {
  /** The button: enter (and lock) or unlock and exit. */
  readonly toggle: (el: FullscreenTarget | null) => void
  /** `fullscreenchange`: leaving fullscreen by ANY route releases the lock. */
  readonly onFullscreenChange: () => void
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/**
 * The enter/exit sequence, separated from React so it is testable with fakes.
 * The lock is requested only AFTER fullscreen is granted — Chrome refuses an
 * orientation lock outside fullscreen — and released before or on the exit.
 */
export function createWebFullscreenController(deps: WebFullscreenControllerDeps): WebFullscreenController {
  const { doc, orientation, mode, warn } = deps
  let locked = false

  const unlock = (): void => {
    if (!locked) return
    locked = false
    try {
      orientation?.unlock?.()
    } catch (e: unknown) {
      warn('orientation unlock refused', { error: errorText(e) })
    }
  }

  const lockLandscape = (): void => {
    if (mode !== 'lock-landscape' || orientation?.lock === undefined) return
    orientation.lock('landscape').then(
      () => {
        locked = true
      },
      (e: unknown) => warn('orientation lock refused', { error: errorText(e) }),
    )
  }

  return {
    toggle: (el) => {
      if (doc.fullscreenElement !== null) {
        unlock()
        doc.exitFullscreen().catch((e: unknown) => warn('exit refused', { error: errorText(e) }))
        return
      }
      if (el === null || el.requestFullscreen === undefined) return
      // A refused request (no user activation, a permissions policy) used to
      // be swallowed: the disc did nothing and nothing said why.
      el.requestFullscreen().then(lockLandscape, (e: unknown) =>
        warn('request refused', { error: errorText(e) }),
      )
    },
    onFullscreenChange: () => {
      if (doc.fullscreenElement === null) unlock()
    },
  }
}

function detectEnv(): WebFullscreenEnv {
  const hasDocument = typeof document !== 'undefined'
  const orientation = typeof screen !== 'undefined' ? screen.orientation : undefined
  const coarse =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(pointer: coarse)').matches
      : false
  return {
    fullscreenEnabled: hasDocument && isWebFullscreenSupported(document),
    orientationLock: typeof orientation?.lock === 'function',
    coarsePointer: coarse,
  }
}

let loggedDecision: WebFullscreenMode | null = null

/** Detect, decide, and say so ONCE — the mode cannot change within a session. */
function resolveMode(): WebFullscreenMode {
  if (Platform.OS !== 'web') return 'app-fill'
  const env = detectEnv()
  const decision = decideWebFullscreenMode(env)
  if (loggedDecision !== decision.mode) {
    loggedDecision = decision.mode
    log.info('fullscreen', `web mode: ${decision.mode}`, { reason: decision.reason, ...env })
  }
  return decision.mode
}

export interface WebFullscreen {
  readonly ref: React.RefObject<View | null>
  readonly isFullscreen: boolean
  /** What the button does here — see {@link WebFullscreenMode}. */
  readonly mode: WebFullscreenMode
  /** The browser API is the path (`lock-landscape` or `plain`). */
  readonly supported: boolean
  readonly toggle: () => void
}

export function useWebFullscreen(): WebFullscreen {
  const ref = useRef<View | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [mode] = useState<WebFullscreenMode>(resolveMode)

  const controller = useMemo((): WebFullscreenController | null => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return null
    return createWebFullscreenController({
      doc: document,
      orientation: typeof screen !== 'undefined' ? (screen.orientation ?? null) : null,
      mode,
      warn: (msg, data) => log.warn('fullscreen', msg, data),
    })
  }, [mode])

  useEffect(() => {
    if (controller === null) return
    const onChange = (): void => {
      setIsFullscreen(document.fullscreenElement !== null)
      controller.onFullscreenChange()
    }
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [controller])

  const toggle = useCallback((): void => {
    // A RN `View` ref on the web IS its DOM element.
    const el = ref.current as unknown as Element | null
    controller?.toggle(el)
  }, [controller])

  return { ref, isFullscreen, mode, supported: usesBrowserFullscreen(mode), toggle }
}
