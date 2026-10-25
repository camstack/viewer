/**
 * An in-memory {@link AccountSettingsPort}: the hub's contract with a map
 * behind it. The sync engine's specs run against it, and it is the reference
 * for what the real adapter (`hub-account-port.ts`) must answer.
 *
 * `offline` makes every call reject (a hub that cannot be reached), and
 * `writeAsAnotherDevice` stores a row the way a second device signed in as the
 * same user would — the source of every conflict a spec needs.
 */
import type {
  AccountDocument,
  AccountNamespace,
  AccountPutResult,
  AccountRevisions,
  AccountRow,
  AccountSettingsPort,
} from './account-settings-port.js'

export interface MemoryAccountPort extends AccountSettingsPort {
  /** Every call, in order — `get`, `put:<ns>`, `changedSince`. */
  readonly calls: readonly string[]
  /** The row stored for `namespace`, if any. */
  row(namespace: AccountNamespace): AccountRow | undefined
  /** Store `value` as if another device of the same account had written it. */
  writeAsAnotherDevice(namespace: AccountNamespace, value: AccountDocument): AccountRow
  /** While true, every call rejects. */
  setOffline(offline: boolean): void
}

function copy<T>(value: T): T {
  const out: T = JSON.parse(JSON.stringify(value))
  return out
}

export function createMemoryAccountPort(now: () => number = Date.now): MemoryAccountPort {
  const rows = new Map<AccountNamespace, AccountRow>()
  const calls: string[] = []
  let offline = false
  let revision = 0

  const store = (namespace: AccountNamespace, value: AccountDocument): AccountRow => {
    revision += 1
    // A deep copy: the port must never share an object with its caller.
    const row: AccountRow = { namespace, value: copy(value), revision, updatedAt: now() }
    rows.set(namespace, row)
    return row
  }
  const reachable = (call: string): void => {
    calls.push(call)
    if (offline) throw new Error('hub unreachable')
  }

  return {
    calls,
    row: (namespace) => rows.get(namespace),
    writeAsAnotherDevice: store,
    setOffline: (next) => {
      offline = next
    },
    get: async (namespaces) => {
      reachable('get')
      return namespaces.flatMap((ns) => {
        const row = rows.get(ns)
        return row === undefined ? [] : [copy(row)]
      })
    },
    put: async (namespace, value, baseRevision): Promise<AccountPutResult> => {
      reachable(`put:${namespace}`)
      const current = rows.get(namespace)
      const stale = current === undefined ? baseRevision !== null : current.revision !== baseRevision
      if (stale && current !== undefined) return { kind: 'conflict', current: copy(current) }
      return { kind: 'stored', row: copy(store(namespace, value)) }
    },
    changedSince: async (revisions: AccountRevisions) => {
      reachable('changedSince')
      return [...rows.values()]
        .filter((row) => row.revision > (revisions[row.namespace] ?? 0))
        .map((row) => copy(row))
    },
  }
}
