/**
 * Hold a screen wake lock while a live picture is on screen (web).
 *
 * Native keeps the screen on through the video/audio session. In a PWA the
 * picture is a muted WebRTC `<video>` inside an iframe, which does not
 * reliably inhibit auto-lock — a camera watched for longer than the auto-lock
 * timeout went dark. iOS 16.4+ and Chrome expose
 * `navigator.wakeLock.request('screen')`.
 *
 * Three lifecycle points, all through the pure `shouldHoldWakeLock` gate:
 * request on mount, re-request on `visibilitychange` (Safari releases the
 * lock itself when the page hides, and a request while hidden is refused),
 * release on unmount. Never throws: a refused lock only means the phone locks
 * as it did before, and that must never take the picture down.
 */
import { useEffect } from 'react'
import { log } from '../lib/logger.js'

export interface WakeLockGateInput {
  readonly mounted: boolean
  readonly visible: boolean
  readonly supported: boolean
}

export function shouldHoldWakeLock({ mounted, visible, supported }: WakeLockGateInput): boolean {
  return mounted && visible && supported
}

function wakeLockSupported(): boolean {
  return typeof navigator !== 'undefined' && 'wakeLock' in navigator && navigator.wakeLock !== undefined
}

export function useScreenWakeLock(): void {
  useEffect(() => {
    if (typeof document === 'undefined') return
    const supported = wakeLockSupported()
    if (!supported) return

    let mounted = true
    let requesting = false
    let sentinel: WakeLockSentinel | null = null

    const request = async (): Promise<void> => {
      const visible = document.visibilityState === 'visible'
      if (!shouldHoldWakeLock({ mounted, visible, supported })) return
      // One in flight at a time, and a lock still held is not asked for twice.
      if (requesting || (sentinel !== null && !sentinel.released)) return
      requesting = true
      try {
        const next = await navigator.wakeLock.request('screen')
        if (!mounted) {
          void next.release().catch(() => {})
          return
        }
        sentinel = next
      } catch (err) {
        // Hidden document, low battery, insecure origin: the browser said no.
        // The operator cannot act on it and the picture must not care.
        log.debug('wake-lock', 'Screen wake lock refused', {
          reason: err instanceof Error ? err.message : String(err),
        })
      } finally {
        requesting = false
      }
    }

    const onVisibility = (): void => {
      void request()
    }
    document.addEventListener('visibilitychange', onVisibility)
    void request()

    return () => {
      mounted = false
      document.removeEventListener('visibilitychange', onVisibility)
      const held = sentinel
      sentinel = null
      if (held !== null && !held.released) void held.release().catch(() => {})
    }
  }, [])
}
