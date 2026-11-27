/**
 * server-transition — what the app store does when the saved server in use changes.
 *
 * A switch between two servers carries the app on screen to the new one; every
 * transition through "no server" (first connect, a removed server) ends the old
 * session instead, so a removed hub's app never stays on screen.
 */
import { useAppStore } from './app-store.js'

export type ServerTransition = 'none' | 'switch' | 'reset'

export function serverTransitionOf(from: string | null, to: string | null): ServerTransition {
  if (from === to) return 'none'
  return from !== null && to !== null ? 'switch' : 'reset'
}

/** Apply the change of server `from` to `to` to the app store. */
export function applyServerChange(from: string | null, to: string | null): void {
  const store = useAppStore.getState()
  const transition = serverTransitionOf(from, to)
  if (transition === 'none') return
  if (transition === 'switch' && to !== null) {
    store.switchServer(to)
    return
  }
  store.resetSession()
  store.setServerId(to)
}
