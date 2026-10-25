import type { DiscoveredEndpoint } from './endpoint-discovery.js'
import { sameHubOrigin } from './hub-origin.js'

/** Minimal KV surface — satisfied by `@react-native-async-storage/async-storage`
 *  in the app and by an in-memory mock in tests. */
export interface KvStore {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
  removeItem(key: string): Promise<void>
}

export interface ServerConfig {
  readonly id: string
  readonly label: string
  readonly serverUrl: string
  /** The hub's own server name (D861), kept ONLY when the operator set one;
   *  absent means the host label. Refreshed on connect. */
  readonly name?: string
  /** Epoch ms of the last time this server was made active. Absent on a
   *  server saved before the switcher existed. */
  readonly lastUsedAt?: number
}

/** What happened to the pre-switcher single token on boot. */
export type LegacyTokenMigration = 'none' | 'migrated' | 'dropped'

const K_SERVERS = 'v2.servers'
const K_ACTIVE = 'v2.activeServerId'
/** The ONE global token every server shared before per-server credentials.
 *  Read once by {@link ServerStore.migrateLegacyToken}, then deleted. */
const K_LEGACY_TOKEN = 'v2.token'
/** Last URL the operator ATTEMPTED (written on sign-in taps, before any
 *  redirect/outcome) — so an aborted hub sign-in still prefills next time. */
const K_LAST_URL = 'v2.lastServerUrl'
/** Per-server cache of the hub's last-known connection endpoints (LAN-first
 *  candidates). Keyed by server id so each hub keeps its own. */
const K_ENDPOINTS = (serverId: string): string => `v2.endpoints.${serverId}`
const K_PINNED_ROUTE = (serverId: string): string => `v2.pinnedRoute.${serverId}`
/** Per-server session token, in the SECRETS store. */
const K_TOKEN = (serverId: string): string => `v2.token.${secretKeySafe(serverId)}`
/** Per-server refresh token (D812), in the SECRETS store. A password-grade
 *  secret: never in the plain kv, never logged. */
const K_REFRESH = (serverId: string): string => `v2.refresh.${secretKeySafe(serverId)}`

/** One server's credentials: the access token, and the refresh token a
 *  refreshing session (D812) renews with — `null` for a session without one. */
export interface SessionCredentials {
  readonly token: string
  readonly refreshToken: string | null
}

/**
 * A server id (a URL) as a key the native secure store accepts: it allows only
 * `[A-Za-z0-9._-]`. Every other character — and `_` itself, so the mapping
 * stays injective — becomes `_` plus four hex digits.
 */
export function secretKeySafe(id: string): string {
  let out = ''
  // Per UTF-16 unit, so every escape is exactly `_` + four hex digits.
  for (let i = 0; i < id.length; i++) {
    const ch = id.charAt(i)
    out += /^[A-Za-z0-9.-]$/.test(ch) ? ch : `_${id.charCodeAt(i).toString(16).padStart(4, '0')}`
  }
  return out
}

export interface ServerStoreOptions {
  /** Where tokens live. The secure store on native; defaults to `kv`. */
  readonly secrets?: KvStore
  /** Clock for `lastUsedAt`. */
  readonly now?: () => number
}

/** Persists the list of known camstack servers, which one is active, and one
 *  auth token PER server. Tokens go through the injected secrets store (the
 *  platform secure store on native); everything else through `kv`. */
export class ServerStore {
  private readonly secrets: KvStore
  private readonly now: () => number

  constructor(
    private readonly kv: KvStore,
    options: ServerStoreOptions = {},
  ) {
    this.secrets = options.secrets ?? kv
    this.now = options.now ?? Date.now
  }

  async getServers(): Promise<ServerConfig[]> {
    const raw = await this.kv.getItem(K_SERVERS)
    if (!raw) return []
    try {
      const parsed: unknown = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed.filter(isServerConfig) : []
    } catch {
      return []
    }
  }

  /** Insert or replace by id, keeping the stored `lastUsedAt` when the
   *  incoming record does not carry one. */
  async upsertServer(server: ServerConfig): Promise<void> {
    const servers = await this.getServers()
    const existing = servers.find((s) => s.id === server.id)
    const withStamp: ServerConfig =
      server.lastUsedAt === undefined && existing?.lastUsedAt !== undefined
        ? { ...server, lastUsedAt: existing.lastUsedAt }
        : server
    const merged: ServerConfig =
      withStamp.name === undefined && existing?.name !== undefined ? { ...withStamp, name: existing.name } : withStamp
    const next = [...servers.filter((s) => s.id !== server.id), merged]
    await this.kv.setItem(K_SERVERS, JSON.stringify(next))
  }

  /** Set (or clear, with `null`) the hub's custom name on a saved server. */
  async setServerName(id: string, name: string | null): Promise<void> {
    const servers = await this.getServers()
    const next = servers.map((s) => {
      if (s.id !== id) return s
      const { name: _previous, ...rest } = s
      return name === null ? rest : { ...rest, name }
    })
    await this.kv.setItem(K_SERVERS, JSON.stringify(next))
  }

  /** Make `id` the active server and stamp its `lastUsedAt`. */
  async setActive(id: string): Promise<void> {
    await this.kv.setItem(K_ACTIVE, id)
    const servers = await this.getServers()
    const stamp = this.now()
    const next = servers.map((s) => (s.id === id ? { ...s, lastUsedAt: stamp } : s))
    await this.kv.setItem(K_SERVERS, JSON.stringify(next))
  }

  async getActiveServerId(): Promise<string | null> {
    return this.kv.getItem(K_ACTIVE)
  }

  async getActiveServer(): Promise<ServerConfig | null> {
    const id = await this.kv.getItem(K_ACTIVE)
    if (!id) return null
    const servers = await this.getServers()
    return servers.find((s) => s.id === id) ?? null
  }

  /** The saved server whose URL is the same hub origin as `url`, if any. */
  async findServerByOrigin(url: string): Promise<ServerConfig | null> {
    const servers = await this.getServers()
    return servers.find((s) => sameHubOrigin(s.serverUrl, url)) ?? null
  }

  /**
   * Forget a server entirely: its entry, its token, its endpoint cache and its
   * pinned route. Removing the ACTIVE server leaves no server active.
   */
  async removeServer(id: string): Promise<void> {
    const servers = await this.getServers()
    const removed = servers.find((s) => s.id === id)
    await this.kv.setItem(K_SERVERS, JSON.stringify(servers.filter((s) => s.id !== id)))
    await this.secrets.removeItem(K_TOKEN(id))
    await this.secrets.removeItem(K_REFRESH(id))
    await this.kv.removeItem(K_ENDPOINTS(id))
    await this.kv.removeItem(K_PINNED_ROUTE(id))
    if ((await this.kv.getItem(K_ACTIVE)) === id) await this.kv.removeItem(K_ACTIVE)
    if (removed !== undefined && (await this.kv.getItem(K_LAST_URL)) === removed.serverUrl) {
      await this.kv.removeItem(K_LAST_URL)
    }
  }

  /** Remember a sign-in ATTEMPT's URL (called on tap, before redirects). */
  async setLastServerUrl(url: string): Promise<void> {
    await this.kv.setItem(K_LAST_URL, url)
  }

  /**
   * The last server URL the operator used — survives sign-out (only the
   * token is dropped) so the login screen can prefill it instead of an
   * empty field. Priority: last explicit attempt → active server → the
   * most recently saved one.
   */
  async getLastServerUrl(): Promise<string | null> {
    const attempted = await this.kv.getItem(K_LAST_URL)
    if (attempted) return attempted
    const active = await this.getActiveServer()
    if (active) return active.serverUrl
    const servers = await this.getServers()
    const last = servers[servers.length - 1]
    return last?.serverUrl ?? null
  }

  async getToken(serverId: string): Promise<string | null> {
    return this.secrets.getItem(K_TOKEN(serverId))
  }

  /**
   * Store a whole session. The refresh token goes FIRST: a refresh rotates it
   * and the old one is dead, so a write that fails between the two must lose
   * the (short-lived, re-mintable) access token, never the rotation. A session
   * with no refresh token CLEARS the slot — the previous session's token must
   * never renew this one.
   */
  async setSession(serverId: string, session: SessionCredentials): Promise<void> {
    if (session.refreshToken !== null) {
      await this.secrets.setItem(K_REFRESH(serverId), session.refreshToken)
    } else {
      await this.secrets.removeItem(K_REFRESH(serverId))
    }
    await this.secrets.setItem(K_TOKEN(serverId), session.token)
  }

  async getRefreshToken(serverId: string): Promise<string | null> {
    return this.secrets.getItem(K_REFRESH(serverId))
  }

  /** Sign out of ONE server: its tokens go, every other server keeps its own. */
  async clearToken(serverId: string): Promise<void> {
    await this.secrets.removeItem(K_TOKEN(serverId))
    await this.secrets.removeItem(K_REFRESH(serverId))
  }

  /**
   * One-time move of the pre-switcher global `v2.token` into the active
   * server's slot. Idempotent: once the legacy key is gone this is a no-op.
   *
   * The slot is written BEFORE the legacy key is deleted, so a failed secure
   * write leaves the legacy token in place for the next boot to retry. A slot
   * that already holds a token wins (it is newer than any legacy one), and a
   * legacy token with no active server belongs to nobody and is dropped.
   */
  async migrateLegacyToken(): Promise<LegacyTokenMigration> {
    const legacy = await this.kv.getItem(K_LEGACY_TOKEN)
    if (legacy === null) return 'none'
    const activeId = await this.kv.getItem(K_ACTIVE)
    if (!activeId || legacy.length === 0) {
      await this.kv.removeItem(K_LEGACY_TOKEN)
      return 'dropped'
    }
    const existing = await this.secrets.getItem(K_TOKEN(activeId))
    if (existing === null) await this.secrets.setItem(K_TOKEN(activeId), legacy)
    await this.kv.removeItem(K_LEGACY_TOKEN)
    return existing === null ? 'migrated' : 'dropped'
  }

  /** Last-known hub connection endpoints for a server (LAN-first candidates).
   *  Empty array when none cached or the payload is unreadable. */
  async getEndpoints(serverId: string): Promise<DiscoveredEndpoint[]> {
    const raw = await this.kv.getItem(K_ENDPOINTS(serverId))
    if (!raw) return []
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? (parsed as DiscoveredEndpoint[]) : []
    } catch {
      return []
    }
  }

  /** Persist the freshly-probed hub endpoints for a server. */
  async setEndpoints(serverId: string, endpoints: readonly DiscoveredEndpoint[]): Promise<void> {
    await this.kv.setItem(K_ENDPOINTS(serverId), JSON.stringify(endpoints))
  }

  /** Operator-forced route for this hub; `null` means automatic (race). */
  async getPinnedRouteUrl(serverId: string): Promise<string | null> {
    const raw = await this.kv.getItem(K_PINNED_ROUTE(serverId))
    return raw && raw.length > 0 ? raw : null
  }

  async setPinnedRouteUrl(serverId: string, url: string | null): Promise<void> {
    if (url === null || url === '') {
      await this.kv.removeItem(K_PINNED_ROUTE(serverId))
      return
    }
    await this.kv.setItem(K_PINNED_ROUTE(serverId), url)
  }
}

function isServerConfig(value: unknown): value is ServerConfig {
  if (value === null || typeof value !== 'object') return false
  return (
    'id' in value &&
    typeof value.id === 'string' &&
    'label' in value &&
    typeof value.label === 'string' &&
    'serverUrl' in value &&
    typeof value.serverUrl === 'string'
  )
}
