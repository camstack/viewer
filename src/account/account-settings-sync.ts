/**
 * AccountSettingsSync — keeps this device's copy of the operator's ACCOUNT
 * settings (per user, per hub) in step with the copy the hub keeps.
 *
 * ## The model
 *
 * Each account store keeps a local cache of its document per hub
 * (`<key>@<serverId>`, `store/server-scope.ts`), so the app works offline and
 * starts without waiting for a hub. The engine never owns a value: it reads
 * the stores through {@link AccountSection}s and writes them back through the
 * same sections.
 *
 * Per namespace it remembers, per hub, the last document both sides agreed on
 * (`base`) and that document's `revision`. Everything follows from comparing
 * three documents:
 *
 *   local == base            nothing to send; a newer row is simply adopted
 *   local != base            a local change: pushed after a 2 s quiet period
 *   newer row, local != base the local change is re-applied on top of the row,
 *                            for the touched fields only (`json-patch.ts`) —
 *                            last writer wins per field, not per document
 *
 * A write whose base is stale is answered with the current row: the engine
 * merges as above and retries ONCE; a second conflict waits for the next poll.
 * A failed call (offline) leaves the change in place — `local != base`
 * survives a restart because `base` is persisted — and the next poll pushes it.
 *
 * First contact with a hub (no `base` yet): a row that exists WINS — the
 * account is the authority, and a device signing in must not overwrite it with
 * whatever it cached — and a missing row is seeded from the local cache.
 *
 * Without a port, or with one whose hub cannot keep account settings (an
 * older hub, a credential without `preferences-self` — the port throws
 * `AccountUnavailableError`), the engine is local-only: the stores keep their
 * caches exactly as before and the status says so, and why.
 */
import { log } from '../lib/logger.js'
import {
  ACCOUNT_NAMESPACES,
  isAccountNamespace,
  isAccountUnavailableError,
  type AccountDocument,
  type AccountUnavailableReason,
  type AccountNamespace,
  type AccountRow,
  type AccountSettingsPort,
} from './account-settings-port.js'
import { applyJsonPatch, diffJson, isJsonRecord, jsonEqual } from './json-patch.js'

/** One viewer store's contribution to a namespace document. */
export interface AccountSection {
  readonly namespace: AccountNamespace
  /** The key of this section inside the namespace document. */
  readonly name: string
  /** The hub the store's current value belongs to; `null` while it loads. */
  scope(): string | null
  /** The store's current value, as JSON. */
  read(): unknown
  /** Adopt a value from the account (validated by the store) and cache it. */
  apply(value: unknown): void
  /** Called on every change of the store's value. */
  subscribe(listener: () => void): () => void
  /** The value this device cached for ANOTHER hub; `undefined` when none. */
  readCached(serverId: string): Promise<unknown>
}

/** Where the engine keeps its per-hub bookkeeping. */
export interface AccountSyncStorage {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
}

export type AccountSyncState = 'local-only' | 'syncing' | 'synced' | 'error'

export interface AccountSyncStatus {
  readonly state: AccountSyncState
  /** Epoch ms of the last exchange that left every namespace agreed. */
  readonly lastSyncedAt: number | null
  /** What went wrong, when `state` is `error`. */
  readonly error: string | null
  /**
   * Why a `local-only` engine with a port is local-only: the hub keeps no
   * account settings (`hub`), or this sign-in may not reach them
   * (`credential`). Absent while there is no port at all.
   */
  readonly unavailable?: AccountUnavailableReason
}

export interface AccountSyncDeps {
  /** `null` = local-only (no hub contract yet). */
  readonly port: AccountSettingsPort | null
  readonly sections: readonly AccountSection[]
  readonly storage: AccountSyncStorage
  readonly now?: () => number
  /** Quiet period before a local change is pushed. */
  readonly debounceMs?: number
  readonly onStatus?: (status: AccountSyncStatus) => void
}

export interface AccountSync {
  /** Bind to a hub: load its bookkeeping, then a first exchange. */
  start(serverId: string): Promise<void>
  /** Unbind: pending pushes are dropped (the change stays local, unpushed). */
  stop(): void
  /** Ask the hub what changed, merge it, push what is local. */
  poll(): Promise<void>
  /** Push every namespace with a local change now. */
  flush(): Promise<void>
  /** Replace this hub's account settings with the ones cached for `sourceServerId`. */
  copyFrom(sourceServerId: string): Promise<void>
  status(): AccountSyncStatus
}

export const ACCOUNT_PUSH_DEBOUNCE_MS = 2_000

/** The bookkeeping key of one hub (device level: it describes this install). */
export const ACCOUNT_SYNC_META_KEY = '@camstack/v2/account-sync'

interface NamespaceMeta {
  readonly revision: number | null
  /** The last document both sides agreed on; `null` before first contact. */
  readonly base: AccountDocument | null
}

type Meta = Readonly<Record<AccountNamespace, NamespaceMeta>>

const EMPTY_META: NamespaceMeta = { revision: null, base: null }

function emptyMeta(): Meta {
  return { 'viewer.app': EMPTY_META, 'viewer.cameras': EMPTY_META, 'viewer.grids': EMPTY_META }
}

/** Parse stored bookkeeping; anything unreadable is "never synced". */
export function parseAccountSyncMeta(raw: string | null): Meta {
  const meta = emptyMeta()
  if (raw === null) return meta
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return meta
  }
  if (!isJsonRecord(data)) return meta
  const out: Record<AccountNamespace, NamespaceMeta> = { ...meta }
  for (const [ns, entry] of Object.entries(data)) {
    if (!isAccountNamespace(ns) || !isJsonRecord(entry)) continue
    const revision = typeof entry.revision === 'number' ? entry.revision : null
    const base = isJsonRecord(entry.base) ? entry.base : null
    out[ns] = { revision, base }
  }
  return out
}

function describe(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export function createAccountSettingsSync(deps: AccountSyncDeps): AccountSync {
  const now = deps.now ?? Date.now
  const debounceMs = deps.debounceMs ?? ACCOUNT_PUSH_DEBOUNCE_MS
  const port = deps.port
  let serverId: string | null = null
  let meta: Meta = emptyMeta()
  let status: AccountSyncStatus = {
    state: port === null ? 'local-only' : 'syncing',
    lastSyncedAt: null,
    error: null,
  }
  const timers = new Map<AccountNamespace, ReturnType<typeof setTimeout>>()
  let unsubscribers: (() => void)[] = []

  const setStatus = (next: AccountSyncStatus): void => {
    status = next
    deps.onStatus?.(next)
  }
  const sectionsOf = (ns: AccountNamespace): readonly AccountSection[] =>
    deps.sections.filter((s) => s.namespace === ns)

  /** Every section of `ns` holds the bound hub's value. */
  const ready = (ns: AccountNamespace): boolean =>
    serverId !== null && sectionsOf(ns).every((s) => s.scope() === serverId)

  const collect = (ns: AccountNamespace): AccountDocument => {
    const doc: Record<string, unknown> = {}
    for (const section of sectionsOf(ns)) {
      const value = section.read()
      if (value !== undefined) doc[section.name] = value
    }
    // Through JSON once, so `base` and `local` compare like for like.
    const plain: unknown = JSON.parse(JSON.stringify(doc))
    return isJsonRecord(plain) ? plain : {}
  }

  const applyDoc = (ns: AccountNamespace, doc: AccountDocument): void => {
    for (const section of sectionsOf(ns)) {
      if (doc[section.name] !== undefined) section.apply(doc[section.name])
    }
  }

  const saveMeta = async (): Promise<void> => {
    const id = serverId
    if (id === null || port === null) return
    try {
      await deps.storage.setItem(`${ACCOUNT_SYNC_META_KEY}@${id}`, JSON.stringify(meta))
    } catch (e: unknown) {
      log.warn('prefs', 'account sync bookkeeping write failed', { error: describe(e) })
    }
  }

  const setMeta = (ns: AccountNamespace, next: NamespaceMeta): void => {
    meta = { ...meta, [ns]: next }
  }

  const dirty = (ns: AccountNamespace): boolean => {
    const base = meta[ns].base
    return base === null ? false : !jsonEqual(base, collect(ns))
  }

  const markSynced = (): void => {
    if (ACCOUNT_NAMESPACES.some((ns) => ready(ns) && dirty(ns))) return
    setStatus({ state: 'synced', lastSyncedAt: now(), error: null })
  }

  const fail = (what: string, e: unknown): void => {
    if (isAccountUnavailableError(e)) {
      // Not a failure to retry loudly: the hub (or this credential) has no
      // account settings. The stores keep their caches; the next poll asks again.
      setStatus({ state: 'local-only', lastSyncedAt: status.lastSyncedAt, error: null, unavailable: e.reason })
      return
    }
    log.warn('prefs', `account sync ${what} failed`, { error: describe(e), serverId })
    setStatus({ ...status, state: 'error', error: describe(e) })
  }

  /** Adopt `row`, keeping a local change on top of it (per touched field). */
  const reconcile = (ns: AccountNamespace, row: AccountRow): void => {
    const { base, revision } = meta[ns]
    if (revision !== null && row.revision <= revision) return
    const local = collect(ns)
    if (base === null || jsonEqual(base, local)) {
      applyDoc(ns, row.value)
    } else {
      const merged = applyJsonPatch(row.value, diffJson(base, local))
      applyDoc(ns, isJsonRecord(merged) ? merged : row.value)
    }
    setMeta(ns, { revision: row.revision, base: row.value })
  }

  /** One write, merged and retried once on a stale base. */
  const push = async (ns: AccountNamespace): Promise<void> => {
    if (port === null || serverId === null || !ready(ns)) return
    const boundTo = serverId
    const { base, revision } = meta[ns]
    const local = collect(ns)
    // First contact is decided by `exchange`: never seed a hub we have not asked.
    if (base === null || jsonEqual(base, local)) return
    let result = await port.put(ns, local, revision)
    if (serverId !== boundTo) return
    if (result.kind === 'conflict') {
      reconcile(ns, result.current)
      const merged = collect(ns)
      result = await port.put(ns, merged, result.current.revision)
      if (serverId !== boundTo) return
      if (result.kind === 'conflict') {
        reconcile(ns, result.current)
        await saveMeta()
        throw new Error(`${ns}: the account changed twice while saving`)
      }
    }
    // A change made while the write was in flight stays a change.
    setMeta(ns, { revision: result.row.revision, base: result.row.value })
    await saveMeta()
  }

  const guarded = async (what: string, run: () => Promise<void>): Promise<void> => {
    if (port === null) return
    if (status.state !== 'error' && status.state !== 'local-only') setStatus({ ...status, state: 'syncing' })
    try {
      await run()
      markSynced()
    } catch (e: unknown) {
      fail(what, e)
    }
  }

  const schedule = (ns: AccountNamespace): void => {
    if (port === null) return
    const pending = timers.get(ns)
    if (pending !== undefined) clearTimeout(pending)
    timers.set(
      ns,
      setTimeout(() => {
        timers.delete(ns)
        // A namespace that was still loading at first contact gets it now.
        void (meta[ns].base === null ? guarded('exchange', exchange) : guarded('push', () => push(ns)))
      }, debounceMs),
    )
  }

  const onSectionChange = (ns: AccountNamespace): void => {
    if (port === null || !ready(ns)) return
    const base = meta[ns].base
    if (base === null || !jsonEqual(base, collect(ns))) schedule(ns)
  }

  const teardown = (): void => {
    for (const t of timers.values()) clearTimeout(t)
    timers.clear()
    unsubscribers.forEach((off) => off())
    unsubscribers = []
  }

  const exchange = async (): Promise<void> => {
    if (port === null || serverId === null) return
    const boundTo = serverId
    const unknown = ACCOUNT_NAMESPACES.filter((ns) => meta[ns].revision === null)
    const known = ACCOUNT_NAMESPACES.filter((ns) => meta[ns].revision !== null)
    const rows = [
      ...(unknown.length > 0 ? await port.get(unknown) : []),
      ...(known.length > 0
        ? await port.changedSince(Object.fromEntries(known.map((ns) => [ns, meta[ns].revision ?? 0])))
        : []),
    ]
    if (serverId !== boundTo) return
    for (const row of rows) {
      if (ready(row.namespace)) reconcile(row.namespace, row)
    }
    await saveMeta()
    for (const ns of ACCOUNT_NAMESPACES) {
      if (!ready(ns)) continue
      // A namespace the hub has no row for is seeded from this device's cache.
      if (meta[ns].revision === null && !rows.some((r) => r.namespace === ns)) {
        setMeta(ns, { revision: null, base: {} })
      }
      await push(ns)
    }
  }

  return {
    start: async (id) => {
      if (serverId === id) return
      teardown()
      serverId = id
      meta = emptyMeta()
      if (port !== null) {
        try {
          meta = parseAccountSyncMeta(await deps.storage.getItem(`${ACCOUNT_SYNC_META_KEY}@${id}`))
        } catch (e: unknown) {
          log.warn('prefs', 'account sync bookkeeping read failed', { error: describe(e) })
        }
      }
      if (serverId !== id) return
      unsubscribers = deps.sections.map((section) => section.subscribe(() => onSectionChange(section.namespace)))
      await guarded('first exchange', exchange)
    },
    stop: () => {
      teardown()
      serverId = null
    },
    poll: () => guarded('poll', exchange),
    flush: async () => {
      for (const [ns, t] of timers) {
        clearTimeout(t)
        timers.delete(ns)
      }
      await guarded('push', async () => {
        for (const ns of ACCOUNT_NAMESPACES) await push(ns)
      })
    },
    copyFrom: async (sourceServerId) => {
      if (serverId === null || sourceServerId === serverId) return
      for (const section of deps.sections) {
        const value = await section.readCached(sourceServerId)
        if (value !== undefined) section.apply(value)
      }
      for (const ns of ACCOUNT_NAMESPACES) onSectionChange(ns)
    },
    status: () => status,
  }
}
