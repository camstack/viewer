import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Platform } from 'react-native'
import { ServerStore, type ServerConfig, type SessionCredentials } from '../connection/server-store.js'
import {
  dropPreviousHubCache,
  listServerSessions,
  switchToServer,
  type SavedServer,
  type SwitchOutcome,
} from '../connection/server-switch.js'
import { secureKvStore } from './kv-secure-storage.js'
import { log } from '../lib/logger.js'
import { clearHubSession } from '../auth/hub-session-exchange.js'
import {
  endpointsToCandidates,
  isIpv6Url,
  type DiscoveredEndpoint,
} from '../connection/endpoint-discovery.js'
import { markBoot } from '../connection/boot-timeline.js'
import { asyncKvStore } from './kv-async-storage.js'
import { isJwtExpired } from '../auth/session-token.js'
import { freshenStoredSession } from '../auth/freshen-session.js'
import { logoutFromHub, type LogoutOutcome } from '../auth/hub-logout.js'
import type { RenewOutcome } from '../auth/refresh-session.js'
import { createSessionRenewer, type SessionRenewer } from '../auth/session-renewer.js'
import { PER_SESSION_QUERY_PREFIXES, sessionIdentity } from './session-key.js'
import { customServerName, fetchServerName } from '../connection/server-name.js'
import { useSessionNotice } from '../auth/session-notice-store.js'
import { useSessionRenewal, type AttachSystem, type RenewReason } from './use-session-renewal.js'
import { deviceTargetsFor, forgetDeviceForServer, noteDeviceRefreshAnswer, signInWithDeviceCertificate } from '../device-cert/device-sign-in.js'
import { deviceCertDeps } from '../device-cert/deps.js'
import { setAutoLogin } from '../device-cert/device-session.js'
import { switchToCertificateSession, type SwitchOutcome as CertSwitchOutcome } from '../device-cert/switch-session.js'

/** How long a plain sign-out waits for the hub to end the session before it
 *  signs out locally anyway — a hub that cannot be reached must never keep
 *  the operator signed in. */
const LOGOUT_WAIT_MS = 5_000

export interface ServerContextValue {
  /** True until the persisted active server + token have been loaded. */
  readonly loading: boolean
  readonly server: ServerConfig | null
  /** The LIVE access token: renewed in place (D812, about hourly with 2 h
   *  tokens). Read it for a Bearer header; never key a cache on it. */
  readonly token: string | null
  /** The token this session was INSTALLED with — sign-in, switch, cold start.
   *  Unchanged by a silent renewal, so what is keyed on the session (the
   *  transport, per-session caches, a loaded embed) is not rebuilt hourly. */
  readonly sessionToken: string | null
  /** Hub connection endpoints last probed for the active server (LAN, public,
   *  loopback). Drives the Settings "Network" list; updated on every probe. */
  readonly endpoints: readonly DiscoveredEndpoint[]
  /** STABLE-for-the-session candidate base URLs seeded into the connection (from
   *  the last session's persisted endpoints + `serverUrl`). Does NOT change when
   *  `endpoints` is re-probed mid-session — the live controller grows its own set
   *  internally — so the transport is not torn down on every probe. */
  readonly initialCandidates: readonly string[]
  /** Operator-forced route for this hub (`null` = automatic race). Seeded
   *  once per server session so changing it via the controller does not
   *  rebuild the transport. */
  readonly initialPinnedRouteUrl: string | null
  /** Persist a pin for the next cold launch. Does not rebuild the transport. */
  readonly persistPinnedRouteUrl: (url: string | null) => Promise<void>
  /** Persist + display freshly-probed endpoints. Passed to the SystemController. */
  readonly onEndpointsDiscovered: (endpoints: readonly DiscoveredEndpoint[]) => void
  /** Every saved server, with whether it holds a usable token. */
  readonly servers: readonly SavedServer[]
  /** Persist a server as active and store ITS session, then refresh local
   *  state. A different server than the active one drops the previous hub's
   *  cache. */
  save: (server: ServerConfig, session: SessionCredentials) => Promise<void>
  /** Make another saved server active with its own token — no restart, no
   *  sign-out. `needs-login` when that server holds no usable token. */
  switchServer: (serverId: string) => Promise<SwitchOutcome>
  /** Forget a saved server and its token, ending its session on the hub
   *  (best effort). Removing the active one signs out. */
  removeServer: (serverId: string) => Promise<void>
  /**
   * User-initiated sign-out of the ACTIVE server: ends the session on the hub
   * (`auth.logout`), clears its tokens AND, on hub-served web, the shared hub
   * session cookie (single logout). Every other server keeps its own token;
   * the known-server list stays intact.
   *
   * A plain sign-out always signs out here, whatever the hub said.
   * `everywhere` ends every session of the user, and signs out here ONLY when
   * the hub did — `unsupported` / `failed` leave this device signed in, so the
   * screen can say the other devices were not signed out.
   */
  signOut: (options?: { readonly everywhere?: boolean }) => Promise<LogoutOutcome>
  /**
   * After a pairing: open a session with the new certificate, install it, and
   * only then end the current one on the hub. `kept` = the old session is
   * untouched (the certificate sign-in did not happen).
   */
  switchToCertificateSession: () => Promise<CertSwitchOutcome>
  /** Renew the active session now — see `use-session-renewal.ts`. */
  renewSession: (reason: RenewReason) => Promise<RenewOutcome>
  /** The connection lends its live System, so a renewal can update it in place. */
  attachSystem: AttachSystem
  /** Last URL the operator typed/used — login-screen prefill. */
  readonly lastServerUrl: string | null
  /** Remember a sign-in ATTEMPT's URL (call on tap, before any redirect). */
  rememberServerUrl: (url: string) => Promise<void>
}

const ServerContext = createContext<ServerContextValue | null>(null)

/** Single source of truth for the active server + auth token. Loads the
 *  persisted state on mount and exposes `save` / `signOut`. The `ServerStore`
 *  is constructed once (stable identity) over the AsyncStorage KV. */
export function ServerProvider({ children }: { children: React.ReactNode }) {
  const store = useMemo(() => new ServerStore(asyncKvStore, { secrets: secureKvStore }), [])
  // One renewer per store: its single-flight and unsaved-rotation memory must
  // be shared by the boot, a switch, the timer and the 401 handler.
  const renewer = useMemo(
    () =>
      createSessionRenewer({
        vault: store,
        // A refresh bound to a device certificate feeds the revocation counter (D855).
        onDeviceAnswer: (serverId, serverUrl, answer) => noteDeviceRefreshAnswer(serverId, serverUrl, answer),
      }),
    [store],
  )
  const queryClient = useQueryClient()
  const [loading, setLoading] = useState(true)
  const [server, setServer] = useState<ServerConfig | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [sessionToken, setSessionToken] = useState<string | null>(null)
  const [servers, setServers] = useState<readonly SavedServer[]>([])
  // Last URL the operator typed/used — prefills the login screen, survives
  // sign-out AND aborted sign-in attempts (written on tap via rememberServerUrl).
  const [lastServerUrl, setLastServerUrl] = useState<string | null>(null)
  // Probed endpoints for display, and the session-stable seed candidates.
  const [endpoints, setEndpoints] = useState<readonly DiscoveredEndpoint[]>([])
  const [initialCandidates, setInitialCandidates] = useState<readonly string[]>([])
  const [initialPinnedRouteUrl, setInitialPinnedRouteUrl] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        // Before the first token read: the pre-switcher global token moves
        // into the active server's own slot, once.
        await migrateLegacyTokenSafely(store)
        const [activeServer, lastUrl] = await Promise.all([
          store.getActiveServer(),
          store.getLastServerUrl(),
        ])
        const activeToken = activeServer ? await store.getToken(activeServer.id) : null
        // An expired access token is renewed FIRST when a refresh token is
        // kept (D812); without one it must NOT count as "logged in" (it would
        // pass the auth gate and then fail every query with UNAUTHORIZED), and
        // it is cleared from storage too. (FIX 1/6)
        const fresh = activeServer
          ? activeToken
            ? await freshenActive(store, renewer, activeServer, activeToken)
            : // No session kept: a device certificate opens one (D855).
              await signInWithDeviceCertificate(store, activeServer)
          : null
        const saved = await listServerSessions(store, isTokenUsable)
        if (cancelled) return
        setServer(activeServer)
        setToken(fresh)
        setSessionToken(fresh)
        setServers(saved)
        setLastServerUrl(lastUrl)
        // Seed the connection race from the last session's cached endpoints.
        const cached = activeServer ? await store.getEndpoints(activeServer.id) : []
        if (cancelled) return
        setEndpoints(cached)
        setInitialCandidates(
          activeServer ? endpointsToCandidates(cached, activeServer.serverUrl) : [],
        )
        const pinned = activeServer ? await store.getPinnedRouteUrl(activeServer.id) : null
        if (cancelled) return
        // Drop a leftover IPv6 pin only when that URL is no longer a candidate.
        // An operator-enabled IPv6 viewer URL must survive cold launch.
        setInitialPinnedRouteUrl(
          pinned !== null && isIpv6Url(pinned) && !cached.some((e) => e.baseUrl === pinned)
            ? null
            : pinned,
        )
      } finally {
        if (!cancelled) {
          // Everything downstream — the auth gate, the transport, the camera
          // list — waits on this one AsyncStorage read. It is the first link
          // of the boot chain and the only one that is pure local I/O, so it
          // is the control for every network stage measured after it.
          markBoot('serverRestored')
          setLoading(false)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [store, renewer])

  const refreshServers = useCallback(async () => {
    setServers(await listServerSessions(store, isTokenUsable))
  }, [store])

  /** Install `next` + its token as the live session, re-seeding the
   *  connection race from that server's own endpoint cache and pin. */
  const applyActive = useCallback(
    async (next: ServerConfig, nextToken: string) => {
      const cached = await store.getEndpoints(next.id)
      const pinned = await store.getPinnedRouteUrl(next.id)
      setServer(next)
      setToken(nextToken)
      setSessionToken(nextToken)
      setEndpoints(cached)
      setInitialCandidates(endpointsToCandidates(cached, next.serverUrl))
      setInitialPinnedRouteUrl(
        pinned !== null && isIpv6Url(pinned) && !cached.some((e) => e.baseUrl === pinned)
          ? null
          : pinned,
      )
    },
    [store],
  )

  const serverId = server?.id ?? null

  // The hub's own name follows the hub: asked on connect (public query, so it
  // works with any session state) and written next to the saved server. An old
  // hub or an offline one answers null and the stored name is left alone.
  const serverUrlOfActive = server?.serverUrl ?? null
  const signedInNow = token !== null
  useEffect(() => {
    if (serverId === null || serverUrlOfActive === null || !signedInNow) return undefined
    let cancelled = false
    void fetchServerName(serverUrlOfActive).then(async (info) => {
      // No answer = an old hub or offline: the stored name stays. A default name clears it.
      if (cancelled || info === null) return
      const name = customServerName(info)
      const current = (await store.getServers()).find((s) => s.id === serverId)
      if (current === undefined || current.name === (name ?? undefined)) return
      await store.setServerName(serverId, name)
      setServer((prev) => {
        if (prev === null || prev.id !== serverId) return prev
        const { name: _old, ...rest } = prev
        return name === null ? rest : { ...rest, name }
      })
      await refreshServers()
    })
    return () => {
      cancelled = true
    }
  }, [serverId, serverUrlOfActive, signedInNow, store, refreshServers])

  const save = useCallback(
    async (next: ServerConfig, session: SessionCredentials) => {
      // A sign-in to ANOTHER hub is a switch: the previous hub's answers must
      // not render under the new one (see server-switch.ts).
      if (serverId !== null && serverId !== next.id) await dropPreviousHubCache(queryClient)
      await store.upsertServer(next)
      renewer.forget(next.id)
      await store.setSession(next.id, session)
      await store.setActive(next.id)
      const stored = (await store.getActiveServer()) ?? next
      await applyActive(stored, session.token)
      await refreshServers()
    },
    [store, renewer, serverId, queryClient, applyActive, refreshServers],
  )

  const switchServer = useCallback(
    async (targetId: string): Promise<SwitchOutcome> => {
      const outcome = await switchToServer(targetId, {
        store,
        queryCache: queryClient,
        isTokenUsable,
      })
      log.info('server-store', 'Server switch', { status: outcome.status })
      if (outcome.status !== 'switched') {
        await refreshServers()
        return outcome
      }
      const fresh = await freshenActive(store, renewer, outcome.server, outcome.token)
      if (fresh === null) {
        await refreshServers()
        return { status: 'needs-login', serverUrl: outcome.server.serverUrl }
      }
      await applyActive(outcome.server, fresh)
      await refreshServers()
      return { ...outcome, token: fresh }
    },
    [store, renewer, queryClient, applyActive, refreshServers],
  )

  const removeServer = useCallback(
    async (targetId: string) => {
      const wasActive = targetId === serverId
      const target = (await store.getServers()).find((s) => s.id === targetId)
      if (target !== undefined) await endSessionOnHub(store, target, false, LOGOUT_WAIT_MS)
      // A removed hub leaves no live credential behind: revoke if reachable, forget either way.
      if (target !== undefined) await forgetDeviceForServer(store, target)
      if (wasActive) await dropPreviousHubCache(queryClient)
      renewer.forget(targetId)
      await store.removeServer(targetId)
      if (wasActive) {
        setServer(null)
        setToken(null)
        setSessionToken(null)
        setEndpoints([])
        setInitialCandidates([])
        setInitialPinnedRouteUrl(null)
      }
      setLastServerUrl(await store.getLastServerUrl())
      await refreshServers()
    },
    [store, renewer, serverId, queryClient, refreshServers],
  )

  const signOut = useCallback(async (options?: { readonly everywhere?: boolean }): Promise<LogoutOutcome> => {
    const everywhere = options?.everywhere === true
    // The hub first: once the tokens are dropped here nothing can end it.
    const ended = server === null ? 'done' : await endSessionOnHub(store, server, everywhere, everywhere ? null : LOGOUT_WAIT_MS)
    if (everywhere && ended !== 'done') return ended
    // Hub-served web shares the browser session with the admin-ui (the boot
    // bootstrap auto-provisions from the hub cookie). Signing out must be a
    // SINGLE logout: clear that shared cookie too, or the next boot silently
    // re-logs in and this button is a no-op. Best-effort — never blocks the
    // local sign-out.
    const sameOrigin = (a: string, b: string): boolean => {
      try {
        return new URL(a).origin === new URL(b).origin
      } catch {
        return false
      }
    }
    if (
      Platform.OS === 'web' &&
      server !== null &&
      typeof window !== 'undefined' &&
      sameOrigin(server.serverUrl, window.location.origin)
    ) {
      await clearHubSession(window.location.origin)
    }
    if (server !== null) {
      renewer.forget(server.id)
      await store.clearToken(server.id)
      // An explicit sign-out must stick: the certificate stays, but stops
      // signing in on its own until the operator signs in again on purpose.
      await setAutoLogin(deviceCertDeps, server.id, false).catch((err: unknown) => {
        log.warn('device-cert', 'Could not pause certificate sign-in', {
          message: err instanceof Error ? err.message : String(err),
        })
      })
    }
    setToken(null)
    setSessionToken(null)
    await refreshServers()
    return ended
  }, [store, renewer, server, refreshServers])

  const switchToCertificate = useCallback(async (): Promise<CertSwitchOutcome> => {
    if (server === null) return 'kept'
    const targets = await deviceTargetsFor(store, server)
    return switchToCertificateSession({
      targets,
      captureOld: async () => {
        const token = await store.getToken(server.id)
        return token === null ? null : { token, refreshToken: await store.getRefreshToken(server.id) }
      },
      install: (session) => save(server, { token: session.token, refreshToken: session.refreshToken }),
      endOld: (old) =>
        logoutFromHub({ serverUrl: server.serverUrl, token: old.token, refreshToken: old.refreshToken, everywhere: false }),
    })
  }, [store, server, save])

  // The hub ended a session (a refused renewal): clear ONLY the local tokens,
  // never the hub cookie, so the auth gate falls back to login — and a
  // still-valid hub-served web session can silently re-provision. Only while
  // it is still the active server: a refusal resolving after a switch must not
  // sign the new hub out.
  const signedOutByHub = useCallback(
    async (endedServerId: string) => {
      renewer.forget(endedServerId)
      await store.clearToken(endedServerId)
      if (endedServerId !== serverId) return
      // A device certificate signs in again by itself (D855): the session
      // ended, the credential may well stand.
      if (server !== null) {
        const reopened = await signInWithDeviceCertificate(store, server)
        if (reopened !== null) {
          await applyActive(server, reopened)
          await refreshServers()
          return
        }
      }
      // Say WHY the person lands on the login screen, then stop everything
      // that was running for this server: the gate unmounts the players and
      // embeds, and the cache is cancelled and cleared so no poll or
      // subscription answers (or retries) against the dead session.
      useSessionNotice.getState().setEnded(server?.label ?? endedServerId)
      setToken(null)
      setSessionToken(null)
      await dropPreviousHubCache(queryClient)
      await refreshServers()
    },
    [store, renewer, serverId, server, applyActive, refreshServers, queryClient],
  )

  // Silent renewal (D812): the live token changes; `sessionToken` does not, so
  // the transport and the per-session caches are left alone.
  const { renewSession, attachSystem } = useSessionRenewal({
    renewer,
    server,
    token,
    onRenewed: setToken,
    onSignedOut: signedOutByHub,
  })

  // ONE place a session change is seen — derived from the state every sign-in
  // and sign-out path already writes, so no handler can forget it. The caches
  // no key scopes to the session are RESET (to pending, refetched if on
  // screen): another user signing in within their staleTime was served the
  // previous user's targets as answered (re-review N2). The first identity
  // after boot is adopted, not a change.
  const session = sessionIdentity(server?.serverUrl ?? null, sessionToken)
  const adoptedSessionRef = useRef<string | null>(null)
  useEffect(() => {
    if (loading) return
    const previous = adoptedSessionRef.current
    adoptedSessionRef.current = session
    if (previous === null || previous === session) return
    for (const queryKey of PER_SESSION_QUERY_PREFIXES) {
      void queryClient.resetQueries({ queryKey: [...queryKey] })
    }
  }, [loading, session, queryClient])

  // Persist + surface freshly-probed endpoints. Keyed on the active server id so
  // each hub keeps its own cache; identity changes only when the server changes
  // (which is itself a reconnect), so it's stable across mid-session probes.
  const onEndpointsDiscovered = useCallback(
    (next: readonly DiscoveredEndpoint[]) => {
      if (!serverId) return
      void store.setEndpoints(serverId, next)
      setEndpoints(next)
    },
    [store, serverId],
  )

  const persistPinnedRouteUrl = useCallback(
    async (url: string | null) => {
      if (!serverId) return
      await store.setPinnedRouteUrl(serverId, url)
    },
    [store, serverId],
  )

  const rememberServerUrl = useCallback(
    async (url: string) => {
      setLastServerUrl(url)
      await store.setLastServerUrl(url)
    },
    [store],
  )

  const value = useMemo<ServerContextValue>(
    () => ({
      loading,
      server,
      token,
      sessionToken,
      endpoints,
      initialCandidates,
      initialPinnedRouteUrl,
      persistPinnedRouteUrl,
      onEndpointsDiscovered,
      servers,
      save,
      switchServer,
      removeServer,
      signOut,
      switchToCertificateSession: switchToCertificate,
      renewSession,
      attachSystem,
      lastServerUrl,
      rememberServerUrl,
    }),
    [
      loading,
      server,
      token,
      sessionToken,
      endpoints,
      initialCandidates,
      initialPinnedRouteUrl,
      persistPinnedRouteUrl,
      onEndpointsDiscovered,
      servers,
      save,
      switchServer,
      removeServer,
      signOut,
      switchToCertificate,
      renewSession,
      attachSystem,
      lastServerUrl,
      rememberServerUrl,
    ],
  )

  return <ServerContext.Provider value={value}>{children}</ServerContext.Provider>
}

export function useServer(): ServerContextValue {
  const ctx = useContext(ServerContext)
  if (!ctx) throw new Error('useServer must be used within ServerProvider')
  return ctx
}

function isTokenUsable(token: string): boolean {
  return !isJwtExpired(token)
}

/**
 * The token to install for a stored session about to become active, renewing
 * an expired one first (`freshen-session.ts`); `null` = signed out, and its
 * stored tokens are dropped.
 */
async function freshenActive(
  store: ServerStore,
  renewer: SessionRenewer,
  server: ServerConfig,
  token: string,
): Promise<string | null> {
  const fresh = await freshenStoredSession({
    token,
    hasRefreshToken: (await store.getRefreshToken(server.id)) !== null,
    isTokenUsable,
    renew: () => renewer.renew(server.id, { serverUrl: server.serverUrl, currentToken: token, client: null }),
  })
  if (fresh.status === 'ready') return fresh.token
  renewer.forget(server.id)
  await store.clearToken(server.id)
  // The session is gone, the device certificate may not be (D855).
  return signInWithDeviceCertificate(store, server)
}

/**
 * End a server's session on the hub (`hub-logout.ts`) with whatever it has
 * stored. Bounded by `waitMs` when given: a hub that cannot be reached must
 * not hold a plain sign-out (it counts as `failed`).
 */
async function endSessionOnHub(
  store: ServerStore,
  server: ServerConfig,
  everywhere: boolean,
  waitMs: number | null,
): Promise<LogoutOutcome> {
  const token = await store.getToken(server.id)
  if (token === null) return 'done'
  const ending = logoutFromHub({
    serverUrl: server.serverUrl,
    token,
    refreshToken: await store.getRefreshToken(server.id),
    everywhere,
  })
  if (waitMs === null) return ending
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<LogoutOutcome>((resolve) => {
    timer = setTimeout(() => resolve('failed'), waitMs)
  })
  try {
    const outcome = await Promise.race([ending, timeout])
    if (outcome !== 'done') log.warn('server-store', 'Hub sign-out did not complete', { outcome })
    return outcome
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/** The legacy-token move must never block the boot: a failure leaves the
 *  legacy key for the next launch to retry (see `migrateLegacyToken`). */
async function migrateLegacyTokenSafely(store: ServerStore): Promise<void> {
  try {
    const outcome = await store.migrateLegacyToken()
    if (outcome !== 'none') log.info('server-store', 'Legacy token migration', { outcome })
  } catch (err) {
    log.warn('server-store', 'Legacy token migration failed', {
      message: err instanceof Error ? err.message : String(err),
    })
  }
}
