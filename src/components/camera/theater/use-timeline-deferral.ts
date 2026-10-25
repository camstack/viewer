import { useEffect, useRef, useState } from 'react'

/**
 * Hold the timeline's heavy fetches until the picture is up — but never hostage
 * to it.
 *
 * `listTracks limit:500` and the three-call activity bundle are the largest
 * requests the camera screen makes, and they travel the SAME WebSocket as the
 * WebRTC signalling (the client has no `httpBatchLink`). Issuing them during
 * negotiation put hundreds of rows in front of the messages that decide how fast
 * the stream appears.
 *
 * The FALLBACK is the part that matters. An offline camera, a broker with no
 * feed, a permission failure — the player never reports playing, and a timeline
 * gated only on it would stay empty forever, turning a stream problem into a
 * "the timeline is broken" report. So the deferral expires on its own.
 */

/** How long to wait for the picture before loading anyway. */
export const TIMELINE_DEFER_MS = 1_200

export function useTimelineDeferral(playerLoading: boolean): boolean {
  const [ready, setReady] = useState(false)
  // Once ready, stay ready: a later reconnect must not re-hide the timeline.
  const readyRef = useRef(false)

  useEffect(() => {
    if (readyRef.current) return
    if (!playerLoading) {
      readyRef.current = true
      setReady(true)
      return
    }
    const timer = setTimeout(() => {
      readyRef.current = true
      setReady(true)
    }, TIMELINE_DEFER_MS)
    return () => clearTimeout(timer)
  }, [playerLoading])

  return ready
}
