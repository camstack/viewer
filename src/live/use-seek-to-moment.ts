/**
 * use-seek-to-moment — "go to this moment", in one place (D483).
 *
 * TWO surfaces press this button and go through here: the track detail opened
 * from the events page (`EventsScreen`) and the one opened from the Cameras
 * reel (`CamerasScreen`). Both used to do the same thing —
 * `router.push('/camera/<id>?at=<epoch>')` — which REPLACES the screen, so the
 * operator lost the track detail they were reading to see the moment it
 * described. That is the defect D483 removes.
 *
 * The theater's OWN cluster seek is deliberately not routed through here. There
 * the operator is already on that camera's screen with its player in front of
 * them, so `TheaterTimeline`'s `onSeek` drives that player through the playback
 * machine and nothing is lost. Opening a second player over the first to show
 * the same camera would be the duplication this whole design avoids.
 *
 * The decision is `resolveSeekRoute`, which is pure and asserted by value; this
 * hook is only its React wiring, so no call site carries a copy of the
 * viewport test or of the navigation it falls back to. Below the gate the
 * behaviour is byte-for-byte what shipped: the button never stops working, it
 * stops replacing the screen where there is room not to.
 */
import { useCallback } from 'react'
import { Platform } from 'react-native'
import { useRouter } from 'expo-router'
import { useViewportSize } from '../hooks/use-viewport-size.js'
import { useScreenMinSide } from '../hooks/use-responsive.js'
import { resolveSeekRoute } from './ondemand-player.js'
import { openOnDemandPlayer } from '../store/ondemand-player-store.js'
import { eventMomentSeekMs } from '../recording/playback-status.js'

/** `(deviceId, epochMs) => void` — open the on-demand player, or navigate. */
export type SeekToMoment = (deviceId: number, epochMs: number) => void

export function useSeekToMoment(): SeekToMoment {
  const router = useRouter()
  const { width, height } = useViewportSize()
  const screenMinSide = useScreenMinSide()
  return useCallback(
    (deviceId: number, epochMs: number) => {
      // Rounded ONCE, here, so the overlay and the `?at=` navigation cannot
      // disagree about the instant by a fraction of a millisecond. Land on
      // the event itself — the operator wants the moment, not a lead-in.
      const atMs = eventMomentSeekMs(epochMs)
      const route = resolveSeekRoute(
        { width, height, screenMinSide, isWeb: Platform.OS === 'web' },
        { deviceId, atMs },
      )
      if (route.kind === 'onDemand') {
        openOnDemandPlayer(route.request)
        return
      }
      router.push(`/camera/${route.deviceId}?at=${route.atMs}`)
    },
    [router, width, height, screenMinSide],
  )
}
