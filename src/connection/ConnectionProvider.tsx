import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { System } from '@camstack/sdk'
import { SystemController, type SystemControllerConfig } from './system-controller.js'
import type { ConnState } from './recheck-policy.js'
import { OfflineDebouncer } from './offline-debounce.js'

// NOTE: this module is deliberately free of any `react-native` import so the
// data-hook modules that import `useConnection` stay loadable in the node-env
// vitest suite. Auth actions are injected as props (from the (app) layout,
// which owns the ServerProvider) rather than pulled from a context here.

interface ConnectionContextValue {
  controller: SystemController
  state: ConnState
  /** True during the app's INITIAL connect (this controller has never reached
   *  `connected` and the startup grace hasn't expired). Screens render skeleton
   *  placeholders and the root hub-status overlay says at most "connecting" —
   *  a cold launch never flashes "offline" while the first dial races. */
  startingUp: boolean
}

const ConnectionContext = createContext<ConnectionContextValue | null>(null)

/** How long a `disconnected` must PERSIST before we surface it as "offline".
 *  A brief drop is normal and self-heals: the connect-time `switchServerUrl`
 *  race tears the WS down and rebuilds it, and transient network blips
 *  reconnect within a second or two. Debouncing keeps the banner on
 *  "connecting/reconnecting" through those instead of flashing "offline". */
const OFFLINE_GRACE_MS = 3_000

/** How long a cold launch may keep the skeleton "starting up" phase before the
 *  UI falls back to honest connection status. Covers the endpoint-discovery
 *  race + a retry or two; past this, a hub that's genuinely unreachable should
 *  say so instead of shimmering forever. */
const STARTUP_GRACE_MS = 12_000

export interface ConnectionProviderProps {
  config: SystemControllerConfig
  /** Called when the hub rejects the token as UNAUTHORIZED during the
   *  connect-time or resume probe. The host renews the session (and signs out
   *  only when the hub refuses that too). (FIX 1, D812) */
  onUnauthorized?: () => void
  /** Lend the live System to the host, so a session renewal can swap the token
   *  on it in place (no reconnect) — the renewal itself is the host's
   *  (`use-session-renewal.ts`), not this provider's. `null` detaches. */
  attachSystem?: (getSystem: (() => System | null) | null) => void
  children: React.ReactNode
}

export function ConnectionProvider({
  config,
  onUnauthorized,
  attachSystem,
  children,
}: ConnectionProviderProps) {
  const controller = useMemo(() => new SystemController(config), [config])
  const [state, setState] = useState<ConnState>('connecting')

  // Render-time state adjustment (the sanctioned "derive state from a prop
  // change" pattern): a fresh controller — first mount OR a config change,
  // e.g. a new token just persisted by the login handoff — is by definition
  // (re)connecting. Without this reset a `disconnected` latched under the
  // PREVIOUS controller would keep showing "offline" while the new transport
  // dials and connects.
  // Startup phase: true until this controller's FIRST successful connect (or
  // the startup grace expires). Both reset alongside `state` when the
  // controller is re-keyed — a new transport is a fresh cold start.
  const [hasConnectedOnce, setHasConnectedOnce] = useState(false)
  const [startupGraceOver, setStartupGraceOver] = useState(false)

  const [prevController, setPrevController] = useState(controller)
  if (prevController !== controller) {
    setPrevController(controller)
    setState('connecting')
    setHasConnectedOnce(false)
    setStartupGraceOver(false)
  }

  useEffect(() => {
    if (state === 'connected') setHasConnectedOnce(true)
  }, [state])


  useEffect(() => {
    if (hasConnectedOnce) return undefined
    const timer = setTimeout(() => setStartupGraceOver(true), STARTUP_GRACE_MS)
    return () => clearTimeout(timer)
  }, [controller, hasConnectedOnce])

  useEffect(() => {
    if (!attachSystem) return undefined
    attachSystem(() => controller.getSystem())
    return () => attachSystem(null)
  }, [controller, attachSystem])

  // Latest onUnauthorized without re-keying the controller lifecycle on the
  // callback's identity: the host passes an inline arrow, and re-running the
  // effect below on every parent render would dispose + redial the transport
  // each time (each teardown another chance to hit the stale-timer latch the
  // OfflineDebouncer guards against).
  const onUnauthorizedRef = useRef(onUnauthorized)
  useEffect(() => {
    onUnauthorizedRef.current = onUnauthorized
  }, [onUnauthorized])

  useEffect(() => {
    // Debounce `disconnected` (see OfflineDebouncer): show "connecting"
    // immediately, escalate to "offline" only past the grace window.
    const debouncer = new OfflineDebouncer(OFFLINE_GRACE_MS, setState)
    const detach = controller.subscribe({
      onStateChange: (next) => debouncer.handle(next),
      onUnauthorized: () => onUnauthorizedRef.current?.(),
    })
    controller.connect().catch(() => debouncer.handle('disconnected'))
    return () => {
      // Order matters: dispose the debouncer and detach the observers BEFORE
      // disposing the controller — `dispose()` closes the System, whose WS
      // onClose fires a final `'disconnected'` back through `onStateChange`
      // synchronously. Routing that teardown echo (or a late
      // `connect().catch`) into the dead effect's timer machinery used to arm
      // an unclearable grace timer that flipped the NEXT controller's live
      // state to "offline" ~3s after it had connected — the post-login
      // stuck-offline-until-force-close bug.
      debouncer.dispose()
      detach()
      controller.dispose()
    }
  }, [controller])

  const startingUp = !hasConnectedOnce && !startupGraceOver
  const value = useMemo(
    () => ({ controller, state, startingUp }),
    [controller, state, startingUp],
  )
  return <ConnectionContext.Provider value={value}>{children}</ConnectionContext.Provider>
}

export function useConnection(): ConnectionContextValue {
  const ctx = useContext(ConnectionContext)
  if (!ctx) throw new Error('useConnection must be used within ConnectionProvider')
  return ctx
}
