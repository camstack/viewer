/**
 * server-switch — moving the app from one saved server to another without a
 * restart.
 *
 * What a switch must leave behind is NOTHING of the previous hub: query
 * answers are keyed by camera id and path, not by hub, so camera 101 on hub B
 * would render hub A's 101 until a refetch. The cache is cancelled and
 * emptied BEFORE the new server becomes active, so the first render under the
 * new server already finds it empty. The connection, its WebSocket
 * subscriptions and every player are torn down by the `(app)` layout, which
 * keys the whole connected subtree by server id.
 *
 * The previous server's token is left exactly where it was: switching is not
 * signing out.
 */
import type { ServerConfig, ServerStore } from './server-store.js'
import type { HubLinkServer } from './hub-link.js'

/** The slice of React Query a switch needs (the real `QueryClient` fits). */
export interface SwitchQueryCache {
  cancelQueries(): Promise<void>
  clear(): void
}

export type SwitchOutcome =
  | { readonly status: 'switched'; readonly server: ServerConfig; readonly token: string }
  | { readonly status: 'already-active' }
  | { readonly status: 'unknown-server' }
  /** Saved but holding no valid token: the caller opens the login for it. */
  | { readonly status: 'needs-login'; readonly serverUrl: string }

export interface SwitchDeps {
  readonly store: ServerStore
  readonly queryCache: SwitchQueryCache
  readonly isTokenUsable: (token: string) => boolean
}

/** Drop every answer the previous hub gave. Cancel first, so an in-flight
 *  fetch cannot land its result after the clear. */
export async function dropPreviousHubCache(queryCache: SwitchQueryCache): Promise<void> {
  await queryCache.cancelQueries()
  queryCache.clear()
}

/**
 * Make `serverId` the active server. Reads its OWN token; nothing is written
 * unless the switch can complete. The caller applies the returned server and
 * token to React state.
 */
export async function switchToServer(serverId: string, deps: SwitchDeps): Promise<SwitchOutcome> {
  const activeId = await deps.store.getActiveServerId()
  const servers = await deps.store.getServers()
  const target = servers.find((s) => s.id === serverId)
  if (target === undefined) return { status: 'unknown-server' }
  const token = await deps.store.getToken(serverId)
  if (token === null || !(await hasUsableSession(deps.store, serverId, token, deps.isTokenUsable))) {
    return { status: 'needs-login', serverUrl: target.serverUrl }
  }
  if (activeId === serverId) return { status: 'already-active' }
  await dropPreviousHubCache(deps.queryCache)
  await deps.store.setActive(serverId)
  const active = await deps.store.getActiveServer()
  return { status: 'switched', server: active ?? target, token }
}

/**
 * A stored session is usable while its access token is, OR while it holds a
 * refresh token (D812): a 2 h access token is expired on most cold starts, and
 * the refresh token renews it — only the hub refusing that renewal signs out.
 */
export async function hasUsableSession(
  store: Pick<ServerStore, 'getRefreshToken'>,
  serverId: string,
  token: string,
  isTokenUsable: (token: string) => boolean,
): Promise<boolean> {
  return isTokenUsable(token) || (await store.getRefreshToken(serverId)) !== null
}

/** Every saved server with whether it holds a usable session — the Settings
 *  list and the link decision both read this. */
export async function listServerSessions(
  store: ServerStore,
  isTokenUsable: (token: string) => boolean,
): Promise<readonly SavedServer[]> {
  const servers = await store.getServers()
  const sessions = await Promise.all(
    servers.map(async (server): Promise<SavedServer> => {
      const token = await store.getToken(server.id)
      const signedIn = token !== null && (await hasUsableSession(store, server.id, token, isTokenUsable))
      return { ...server, signedIn }
    }),
  )
  return sessions
}

/** A saved server as the UI lists it. */
export type SavedServer = ServerConfig & HubLinkServer
