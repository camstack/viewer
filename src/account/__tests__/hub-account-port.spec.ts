/**
 * The hub adapter of the account port against a FAKE tRPC client that keeps
 * rows the way the hub's `preferences.*` router does (`baseRevision`
 * semantics, per-namespace revisions, `changedSince` answering rows it was
 * not asked about) — and the sync engine running over it end to end.
 */
import { describe, expect, it } from 'vitest'
import { AccountUnavailableError } from '../account-settings-port.js'
import { createAccountSettingsSync, type AccountSection, type AccountSyncStorage } from '../account-settings-sync.js'
import { createHubAccountPort, type PreferencesClient } from '../hub-account-port.js'
import { INSTALL_ID_KEY, createInstallIdReader, newInstallId } from '../install-id.js'

interface WireRow {
  namespace: string
  value: Record<string, unknown>
  revision: number
  updatedAt: number
  updatedByDevice: string | null
}

interface FakeHub {
  readonly client: PreferencesClient
  readonly rows: Map<string, WireRow>
  readonly puts: { namespace: string; baseRevision?: number; deviceId?: string }[]
  /** Another device of the same user writes. */
  writeElsewhere(namespace: string, value: Record<string, unknown>): void
  /** Every call rejects with this error. */
  failWith: unknown
}

function trpcError(code: string, message = code): Error {
  return Object.assign(new Error(message), { data: { code } })
}

function fakeHub(): FakeHub {
  const rows = new Map<string, WireRow>()
  const puts: FakeHub['puts'] = []
  let clock = 1_000
  const hub: FakeHub = {
    rows,
    puts,
    failWith: null,
    writeElsewhere: (namespace, value) => {
      const cur = rows.get(namespace)
      rows.set(namespace, { namespace, value, revision: (cur?.revision ?? 0) + 1, updatedAt: ++clock, updatedByDevice: 'other' })
    },
    client: {
      preferences: {
        get: {
          query: async ({ namespaces }) => {
            if (hub.failWith !== null) throw hub.failWith
            return { rows: [...rows.values()].filter((r) => namespaces === undefined || namespaces.includes(r.namespace)) }
          },
        },
        put: {
          mutate: async (input) => {
            if (hub.failWith !== null) throw hub.failWith
            puts.push({ namespace: input.namespace, baseRevision: input.baseRevision, deviceId: input.deviceId })
            const cur = rows.get(input.namespace) ?? null
            if (input.baseRevision !== undefined && (cur?.revision ?? 0) !== input.baseRevision) {
              return { status: 'conflict', current: cur }
            }
            const row: WireRow = {
              namespace: input.namespace,
              value: input.value,
              revision: (cur?.revision ?? 0) + 1,
              updatedAt: ++clock,
              updatedByDevice: input.deviceId ?? null,
            }
            rows.set(input.namespace, row)
            return { status: 'saved', row }
          },
        },
        delete: {
          mutate: async ({ namespace }) => {
            if (hub.failWith !== null) throw hub.failWith
            return { deleted: rows.delete(namespace) }
          },
        },
        changedSince: {
          query: async ({ revisionByNamespace }) => {
            if (hub.failWith !== null) throw hub.failWith
            const changed = [...rows.values()].filter((r) => revisionByNamespace[r.namespace] !== r.revision)
            const deleted = Object.keys(revisionByNamespace).filter((ns) => !rows.has(ns))
            return { rows: changed, deleted }
          },
        },
      },
    },
  }
  return hub
}

function portOver(hub: FakeHub) {
  return createHubAccountPort({ client: () => hub.client, deviceId: async () => 'install-1' })
}

describe('hub account port', () => {
  it('reads only the namespaces this build knows', async () => {
    const hub = fakeHub()
    hub.writeElsewhere('viewer.app', { general: { a: 'MARK-remote' } })
    hub.writeElsewhere('viewer.future', { x: 1 })
    const rows = await portOver(hub).get(['viewer.app', 'viewer.grids'])
    expect(rows).toEqual([expect.objectContaining({ namespace: 'viewer.app', value: { general: { a: 'MARK-remote' } }, revision: 1 })])
  })

  it('a first write is a create (baseRevision 0) and carries the install id', async () => {
    const hub = fakeHub()
    const out = await portOver(hub).put('viewer.app', { general: { a: 'MARK-local' } }, null)
    expect(out).toMatchObject({ kind: 'stored', row: { revision: 1 } })
    expect(hub.puts).toEqual([{ namespace: 'viewer.app', baseRevision: 0, deviceId: 'install-1' }])
    expect(hub.rows.get('viewer.app')?.updatedByDevice).toBe('install-1')
  })

  it('a stale base answers conflict with the current row, and writes nothing', async () => {
    const hub = fakeHub()
    hub.writeElsewhere('viewer.grids', { grids: ['MARK-remote-1'] })
    hub.writeElsewhere('viewer.grids', { grids: ['MARK-remote-2'] })
    const out = await portOver(hub).put('viewer.grids', { grids: ['MARK-local'] }, 1)
    expect(out).toMatchObject({ kind: 'conflict', current: { revision: 2, value: { grids: ['MARK-remote-2'] } } })
    expect(hub.rows.get('viewer.grids')?.value).toEqual({ grids: ['MARK-remote-2'] })
  })

  it('a create that finds a row answers conflict with it', async () => {
    const hub = fakeHub()
    hub.writeElsewhere('viewer.app', { general: { a: 'MARK-remote' } })
    const out = await portOver(hub).put('viewer.app', { general: { a: 'MARK-local' } }, null)
    expect(out).toMatchObject({ kind: 'conflict', current: { revision: 1 } })
  })

  it('a row deleted under the edit is written again as a create', async () => {
    const hub = fakeHub()
    hub.writeElsewhere('viewer.cameras', { prefs: 'MARK-old' })
    hub.rows.delete('viewer.cameras')
    const out = await portOver(hub).put('viewer.cameras', { prefs: 'MARK-local' }, 1)
    expect(out).toMatchObject({ kind: 'stored', row: { revision: 1, value: { prefs: 'MARK-local' } } })
    expect(hub.puts.map((p) => p.baseRevision)).toEqual([1, 0])
  })

  it('changedSince sends only account namespaces and keeps only known rows', async () => {
    const hub = fakeHub()
    hub.writeElsewhere('viewer.app', { v: 1 })
    hub.writeElsewhere('viewer.future', { v: 1 })
    const rows = await portOver(hub).changedSince({ 'viewer.app': 0 })
    expect(rows.map((r) => r.namespace)).toEqual(['viewer.app'])
    expect(await portOver(hub).changedSince({ 'viewer.app': 1 })).toEqual([])
  })

  it('delete reports whether the row existed', async () => {
    const hub = fakeHub()
    hub.writeElsewhere('viewer.app', { v: 1 })
    expect(await portOver(hub).delete('viewer.app')).toBe(true)
    expect(await portOver(hub).delete('viewer.app')).toBe(false)
  })

  it('a malformed row is a failed call, never a value handed to a store', async () => {
    const hub = fakeHub()
    hub.rows.set('viewer.app', { namespace: 'viewer.app', value: { v: 1 }, revision: 0, updatedAt: 1, updatedByDevice: null })
    await expect(portOver(hub).get(['viewer.app'])).rejects.toThrow()
  })

  it.each([
    ['an older hub without the router', trpcError('NOT_FOUND', 'No procedure found on path "preferences.get"'), 'hub'],
    ['a credential without preferences-self', trpcError('FORBIDDEN'), 'credential'],
    ['a hub whose store is not up', trpcError('PRECONDITION_FAILED'), 'hub'],
  ])('%s is unavailable, not a failure', async (_what, error, reason) => {
    const hub = fakeHub()
    hub.failWith = error
    const failure = await portOver(hub).get(['viewer.app']).catch((e: unknown) => e)
    expect(failure).toBeInstanceOf(AccountUnavailableError)
    expect(failure).toMatchObject({ reason })
  })

  it('a network failure stays a plain failure', async () => {
    const hub = fakeHub()
    hub.failWith = new Error('fetch failed')
    const failure = await portOver(hub).get(['viewer.app']).catch((e: unknown) => e)
    expect(failure).not.toBeInstanceOf(AccountUnavailableError)
  })

  it('no connection is a failed call', async () => {
    const port = createHubAccountPort({ client: () => null, deviceId: async () => 'x' })
    await expect(port.get(['viewer.app'])).rejects.toThrow('not connected')
  })
})

function memoryStorage(): AccountSyncStorage & { readonly data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getItem: async (k) => data.get(k) ?? null,
    setItem: async (k, v) => {
      data.set(k, v)
    },
  }
}

function section(value: { current: unknown }): AccountSection {
  return {
    namespace: 'viewer.app',
    name: 'general',
    scope: () => 'hub-a',
    read: () => value.current,
    apply: (next) => {
      value.current = next
    },
    subscribe: () => () => {},
    readCached: async () => undefined,
  }
}

describe('the sync engine over the hub port', () => {
  it('seeds an empty hub, then adopts another device’s write on poll', async () => {
    const hub = fakeHub()
    const value = { current: { theme: 'MARK-local' } }
    const sync = createAccountSettingsSync({ port: portOver(hub), sections: [section(value)], storage: memoryStorage() })
    await sync.start('hub-a')
    expect(hub.rows.get('viewer.app')?.value).toEqual({ general: { theme: 'MARK-local' } })
    expect(sync.status().state).toBe('synced')

    hub.writeElsewhere('viewer.app', { general: { theme: 'MARK-remote' } })
    await sync.poll()
    expect(value.current).toEqual({ theme: 'MARK-remote' })
    sync.stop()
  })

  it('stays local-only, with the reason, on a hub without preferences', async () => {
    const hub = fakeHub()
    hub.failWith = trpcError('NOT_FOUND', 'No procedure found on path "preferences.get"')
    const value = { current: { theme: 'MARK-local' } }
    const sync = createAccountSettingsSync({ port: portOver(hub), sections: [section(value)], storage: memoryStorage() })
    await sync.start('hub-a')
    expect(sync.status()).toMatchObject({ state: 'local-only', unavailable: 'hub', error: null })
    expect(value.current).toEqual({ theme: 'MARK-local' })
    sync.stop()
  })
})

describe('install id', () => {
  it('is created once, persisted, and shared by concurrent first calls', async () => {
    const storage = memoryStorage()
    const read = createInstallIdReader(storage)
    const [a, b] = await Promise.all([read(), read()])
    expect(a).toBe(b)
    expect(storage.data.get(INSTALL_ID_KEY)).toBe(a)
    expect(await createInstallIdReader(storage)()).toBe(a)
  })

  it('fits the hub bound', () => {
    const id = newInstallId(() => 0.999999)
    expect(id.length).toBeLessThanOrEqual(64)
    expect(id).toMatch(/^viewer-[0-9a-f]{24}$/)
  })
})
