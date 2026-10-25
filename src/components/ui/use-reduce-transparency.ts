/**
 * The operator's "reduce transparency" preference, live.
 *
 * iOS: `AccessibilityInfo.isReduceTransparencyEnabled()` plus its change event.
 * Web: the `prefers-reduced-transparency` media query. Android has no such
 * setting (and draws a solid anyway), so it is `false`.
 */
import { useEffect, useState } from 'react'
import { AccessibilityInfo, Platform } from 'react-native'

const WEB_QUERY = '(prefers-reduced-transparency: reduce)'

export function useReduceTransparency(): boolean {
  const [reduced, setReduced] = useState(false)

  useEffect(() => {
    if (Platform.OS === 'ios') {
      let alive = true
      AccessibilityInfo.isReduceTransparencyEnabled?.()
        .then((v) => alive && setReduced(v))
        .catch(() => undefined)
      const sub = AccessibilityInfo.addEventListener('reduceTransparencyChanged', setReduced)
      return () => {
        alive = false
        sub.remove()
      }
    }
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.matchMedia) {
      const mq = window.matchMedia(WEB_QUERY)
      setReduced(mq.matches)
      const onChange = (e: MediaQueryListEvent) => setReduced(e.matches)
      mq.addEventListener('change', onChange)
      return () => mq.removeEventListener('change', onChange)
    }
    return undefined
  }, [])

  return reduced
}
