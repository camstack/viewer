/**
 * OnDemandPlayerHost — the one mount point for the on-demand player (D483).
 *
 * ## Why this is a sibling of the navigator and not of a screen
 *
 * The operator asked for "un overlay mobile ovunque sulla pagina corrente
 * qualunque essa sia e non cambia con la navigazione": the same player, still
 * playing, after a route change. A sibling at a screen's root cannot do that —
 * the screen unmounts and takes the player with it — and for this component
 * that is not a cosmetic loss. The picture is a WKWebView / iframe, so an
 * unmount ENDS the media session and reopening pays a full renegotiation.
 * Surviving navigation is what protects the session.
 *
 * So this mounts in `app/(app)/_layout.tsx`, beside the `<Stack>`, in the
 * company that file already keeps for app-lifetime machinery (`AppPhaseTracer`,
 * `LiveInvalidationBridge`, `ResumeReconcileBridge`, the two
 * `LastCameraBridge` halves). It is the first of those that draws pixels, which
 * is the only thing new about the placement.
 *
 * It must stay INSIDE `ConnectionProvider`: the player needs the live
 * connection for its session and its availability query.
 *
 * ## What closes it
 *
 * Navigation no longer does, so three things do, and nothing else:
 *
 *  1. The close button.
 *  2. Leaving the authenticated group — the layout unmounts with the redirect
 *     to login, and the player goes with it. Nothing to write here.
 *  3. Its camera stops being one the app lists (`resolveOnDemandOpen`),
 *     which is the `ReopenLastCameraBridge` rule at this scope. An overlay that
 *     outlives its own subject is the next defect.
 *  4. The operator ARRIVES on that same camera's own screen
 *     (`resolveOnDemandOnFocus`, fed by `focusOnDemandCamera` from
 *     `CameraDetailScreen`). Two pictures of one camera, in two sessions, on
 *     one screen — and the small one is the one nobody just asked for. Scoped
 *     to the camera, never to navigating: a DIFFERENT camera in the overlay
 *     beside a full-screen one is the feature.
 *
 * Deliberately NOT backgrounding: the primary picture does not close on
 * background either, `battery-stream-gate.ts` already owns what a backgrounded
 * stream costs, and a player that vanished while the operator answered a phone
 * call would be answering a question nobody asked.
 *
 * ## The shape gate is GONE (2026-09-13)
 *
 * This used to refuse to draw below `useWideDetailLayout`, because the operator
 * had scoped the overlay to "schermi medi/grandi come tablet mobile e web" and
 * `ondemand-player.ts` records that widening it needs them — they had rejected
 * a landscape-phone split on OTA 1.0.263. They have now asked for the opposite:
 * the overlay on the phone too, opened by a one-finger fling on the stream and
 * by a button on the cameras list. So the host draws wherever there is a
 * request.
 *
 * What did NOT change is `resolveSeekRoute`: pressing "go to this moment" on a
 * phone still NAVIGATES rather than opening the overlay. That flow was not part
 * of the ask, and replacing a working navigation with an overlay on a small
 * screen is a different decision from adding two explicit ways to summon one.
 * The two questions are now separate — "may the overlay exist here" (always)
 * and "should a seek press open it" (wide only) — which is why the second gate
 * could be deleted without touching the first
 * instead of making the operator find the moment again. Hidden and not
 * unmounted would keep the session alive but is not worth a WebView's memory on
 * a surface that cannot show it, so this one really does unmount — the one
 * place in this design where a session is spent to keep a promise smaller.
 */
import React, { useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import { useCameras } from '../../data/use-cameras.js'
import { useViewportSize } from '../../hooks/use-viewport-size.js'
import { resolveOnDemandOpen } from '../../live/ondemand-player.js'
import { ONDEMAND_OVERLAY_Z } from '../../live/ondemand-geometry.js'
import {
  resolveOnDemandSize,
  useOnDemandPlayerStore,
} from '../../store/ondemand-player-store.js'
import { OnDemandPlayer } from './OnDemandPlayer.js'
import { log } from '../../lib/logger.js'

export function OnDemandPlayerHost(): React.JSX.Element | null {
  // Selector-per-field: this component re-renders on a drag commit, and a
  // whole-store subscription would re-render it on every unrelated write.
  const request = useOnDemandPlayerStore((s) => s.request)
  const prefs = useOnDemandPlayerStore((s) => s.prefs)
  const hydrate = useOnDemandPlayerStore((s) => s.hydrate)
  const close = useOnDemandPlayerStore((s) => s.close)
  const setSize = useOnDemandPlayerStore((s) => s.setSize)
  const setPosition = useOnDemandPlayerStore((s) => s.setPosition)

  const container = useViewportSize()
  // `includeHidden` matches what the layout's own snapshot bridge asks for, so
  // this shares that cache entry rather than starting a second camera list.
  const { data: cameras } = useCameras({ includeHidden: true })

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  // UNDEFINED while the list is in flight — never `?? []`. A cold cache must
  // not read as "the camera is gone" and tear down a live session (D315).
  const known = cameras?.map((c) => c.id)
  const live = resolveOnDemandOpen(request, known)

  useEffect(() => {
    if (request !== null && live === null) {
      log.warn('ondemand', 'closing: the camera is no longer listed', {
        tags: { deviceId: request.deviceId },
      })
      close()
    }
  }, [request, live, close])

  // No shape gate: the operator asked for the overlay on the phone too. The
  // only reason not to draw is having nothing to draw.
  if (live === null) return null

  return (
    <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, styles.root]}>
      <OnDemandPlayer
        request={live}
        container={container}
        size={resolveOnDemandSize(prefs)}
        position={prefs.position}
        onSize={setSize}
        onPosition={setPosition}
        onClose={close}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  /**
   * `box-none` is load-bearing: this fills the window above every route, and
   * without it the whole app would stop receiving touches. Only the panel takes
   * them. The same discipline `LandscapeTimelineOverlay` uses.
   */
  root: { zIndex: ONDEMAND_OVERLAY_Z, elevation: ONDEMAND_OVERLAY_Z },
})
