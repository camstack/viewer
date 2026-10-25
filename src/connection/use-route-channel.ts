/**
 * useRouteChannel — the route the app is ACTUALLY on, as React state.
 *
 * The controller owns the race and the pin; nothing else knows when either
 * settles. Settings already polls for its row; this hook is the same poll for
 * every surface that must CHANGE behaviour with the channel (recorded
 * playback forced to `low` off the LAN). A listener API on SystemController
 * for one read-only fact would be more surface than the fact is worth.
 */
import { useEffect, useState } from 'react'
import { useConnection } from './ConnectionProvider.js'
import type { RouteChannel } from './route-channel.js'

/** Same cadence as Settings — route changes a handful of times per session. */
const ROUTE_POLL_MS = 2000

/** The channel of the live route (`lan` / `public` / `loopback` / `unknown`). */
export function useRouteChannel(): RouteChannel {
  const { controller, state } = useConnection()
  const [channel, setChannel] = useState<RouteChannel>(() => controller.getRoute().channel)

  useEffect(() => {
    setChannel(controller.getRoute().channel)
    const id = setInterval(() => setChannel(controller.getRoute().channel), ROUTE_POLL_MS)
    return () => clearInterval(id)
  }, [controller, state])

  return channel
}
