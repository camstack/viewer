/**
 * The account-settings sync engine against the in-memory port: debounce,
 * last-writer-wins per touched field on a conflict (one retry), the offline
 * cache, the poll merge, first contact, and local-only mode.
 *
 * Values are MARKED (`MARK-local-…`, `MARK-remote-…`) so a value that ends up
 * on the wrong side is visible in the assertion, not just a count.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ACCOUNT_PUSH_DEBOUNCE_MS,
  createAccountSettingsSync,
  type AccountSection,
  type AccountSync,
  type AccountSyncStatus,
  type AccountSyncStorage,
} from '../account-settings-sync.js'
import { createMemoryAccountPort, type MemoryAccountPort } from '../memory-account-port.js'
import type { AccountNamespace } from '../account-settings-port.js'

const HUB = 'hub-a'

/** A store-like section: a value, a hub scope, change listeners, other hubs' caches. */
interface FakeSection extends AccountSection {
  value: unknown
  scopeId: string | null
  readonly cached: Map<string, unknown>
  /** A LOCAL edit: the value changes and listeners fire, like a zustand set. */
  edit(next: unknown): void
}

function fakeSection(namespace: AccountNamespace, name: string, initial: unknown): FakeSection {
  const listeners = new Set<() => void>()
  const self: FakeSection = {
    namespace,
    name,
    value: initial,
    scopeId: HUB,
    cached: new Map(),
    scope: () => self.scopeId,
    read: () => self.value,
    apply: (v) => self.edit(v),
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    readCached: async (id) => self.cached.get(id),
    edit: (next) => {
      self.value = next
      listeners.forEach((l) => l())
    },
  }
  return self
}

function memoryStorage(): AccountSyncStorage & { readonly map: Map<string, string> } {
  const map = new Map<string, string>()
  return {
    map,
    getItem: async (k) => map.get(k) ?? null,
    setItem: async (k, v) => {
      map.set(k, v)
    },
  }
}

interface Rig {
  readonly port: MemoryAccountPort
  readonly storage: ReturnType<typeof memoryStorage>
  readonly app: FakeSection
  readonly cameras: FakeSection
  readonly grids: FakeSection
  readonly statuses: AccountSyncStatus[]
  sync: AccountSync
  /** A new process on the same disk: fresh engine, same storage and port. */
  restart(): AccountSync
}

function rig(opts: { readonly port?: MemoryAccountPort | null } = {}): Rig {
  const port = opts.port === undefined ? createMemoryAccountPort() : opts.port
  const storage = memoryStorage()
  const app = fakeSection('viewer.app', 'settings', { highlight: { motionColor: 'MARK-local-red' }, clipLoop: true })
  const cameras = fakeSection('viewer.cameras', 'prefs', { byId: {}, order: [] })
  const grids = fakeSection('viewer.grids', 'grids', [])
  const statuses: AccountSyncStatus[] = []
  const make = (): AccountSync =>
    createAccountSettingsSync({
      port,
      sections: [app, cameras, grids],
      storage,
      onStatus: (s) => statuses.push(s),
    })
  const r: Rig = {
    port: port ?? createMemoryAccountPort(),
    storage,
    app,
    cameras,
    grids,
    statuses,
    sync: make(),
    restart: () => {
      r.sync.stop()
      r.sync = make()
      return r.sync
    },
  }
  return r
}

/** Let the pending promise chain settle (the port is async). */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await Promise.resolve()
}

async function afterDebounce(): Promise<void> {
  await vi.advanceTimersByTimeAsync(ACCOUNT_PUSH_DEBOUNCE_MS + 10)
  await settle()
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('first contact', () => {
  it('an empty account is SEEDED from this device’s cache', async () => {
    const r = rig()
    await r.sync.start(HUB)
    expect(r.port.row('viewer.app')?.value).toEqual({
      settings: { highlight: { motionColor: 'MARK-local-red' }, clipLoop: true },
    })
    expect(r.sync.status().state).toBe('synced')
  })

  it('an existing account row WINS over the cache — a device signing in never overwrites it', async () => {
    const r = rig()
    r.port.writeAsAnotherDevice('viewer.app', { settings: { highlight: { motionColor: 'MARK-remote-blue' } } })
    await r.sync.start(HUB)
    expect(r.app.value).toEqual({ highlight: { motionColor: 'MARK-remote-blue' } })
    expect(r.port.calls.filter((c) => c === 'put:viewer.app')).toEqual([])
  })

  it('a namespace whose store has not loaded this hub yet is left alone', async () => {
    const r = rig()
    r.cameras.scopeId = null
    await r.sync.start(HUB)
    expect(r.port.row('viewer.cameras')).toBeUndefined()
    // …and joins once the store lands on this hub.
    r.cameras.scopeId = HUB
    r.cameras.edit({ byId: { '101': { localName: 'MARK-local-door' } }, order: [] })
    await afterDebounce()
    expect(r.port.row('viewer.cameras')?.value).toEqual({
      prefs: { byId: { '101': { localName: 'MARK-local-door' } }, order: [] },
    })
  })
})

describe('debounce', () => {
  it('a burst of local edits becomes ONE write, after the quiet period', async () => {
    const r = rig()
    await r.sync.start(HUB)
    const before = r.port.calls.filter((c) => c === 'put:viewer.app').length
    for (const color of ['#111111', '#222222', 'MARK-local-final']) {
      r.app.edit({ highlight: { motionColor: color }, clipLoop: true })
      await vi.advanceTimersByTimeAsync(ACCOUNT_PUSH_DEBOUNCE_MS / 4)
    }
    expect(r.port.calls.filter((c) => c === 'put:viewer.app').length).toBe(before)
    await afterDebounce()
    expect(r.port.calls.filter((c) => c === 'put:viewer.app').length).toBe(before + 1)
    expect(r.port.row('viewer.app')?.value).toEqual({
      settings: { highlight: { motionColor: 'MARK-local-final' }, clipLoop: true },
    })
  })

  it('a value applied FROM the account is not written back', async () => {
    const r = rig()
    await r.sync.start(HUB)
    r.port.writeAsAnotherDevice('viewer.app', { settings: { highlight: { motionColor: 'MARK-remote-blue' } } })
    const puts = r.port.calls.filter((c) => c.startsWith('put:')).length
    await r.sync.poll()
    await afterDebounce()
    expect(r.app.value).toEqual({ highlight: { motionColor: 'MARK-remote-blue' } })
    expect(r.port.calls.filter((c) => c.startsWith('put:')).length).toBe(puts)
  })
})

describe('conflict: last writer wins, per touched field, one retry', () => {
  it('the local change is re-applied on top of the newer row; the untouched fields take the row', async () => {
    const r = rig()
    await r.sync.start(HUB)
    // Another device changes clipLoop and the audio colour…
    r.port.writeAsAnotherDevice('viewer.app', {
      settings: { highlight: { motionColor: 'MARK-local-red', audioColor: 'MARK-remote-audio' }, clipLoop: false },
    })
    // …while this one changes the motion colour, without having seen that.
    r.app.edit({ highlight: { motionColor: 'MARK-local-green' }, clipLoop: true })
    await afterDebounce()

    const merged = {
      settings: { highlight: { motionColor: 'MARK-local-green', audioColor: 'MARK-remote-audio' }, clipLoop: false },
    }
    expect(r.port.row('viewer.app')?.value).toEqual(merged)
    expect(r.app.value).toEqual(merged.settings)
    // One rejected write, one retry.
    expect(r.port.calls.filter((c) => c === 'put:viewer.app').slice(-2)).toHaveLength(2)
    expect(r.sync.status().state).toBe('synced')
  })

  it('a local deletion survives the merge', async () => {
    const r = rig()
    r.cameras.value = { byId: { '101': { localName: 'MARK-x' }, '616': { hidden: true } }, order: [] }
    await r.sync.start(HUB)
    r.port.writeAsAnotherDevice('viewer.cameras', {
      prefs: { byId: { '101': { localName: 'MARK-x' }, '616': { hidden: true }, '900': { localName: 'MARK-remote-new' } }, order: [] },
    })
    r.cameras.edit({ byId: { '101': { localName: 'MARK-x' } }, order: [] })
    await afterDebounce()
    expect(r.port.row('viewer.cameras')?.value).toEqual({
      prefs: { byId: { '101': { localName: 'MARK-x' }, '900': { localName: 'MARK-remote-new' } }, order: [] },
    })
  })

  it('a second conflict in a row is NOT retried again — it waits for the next poll', async () => {
    const r = rig()
    await r.sync.start(HUB)
    const realPut = r.port.put
    let racing = 2
    vi.spyOn(r.port, 'put').mockImplementation(async (ns, value, base) => {
      if (racing > 0) {
        racing -= 1
        r.port.writeAsAnotherDevice(ns, { settings: { highlight: { motionColor: `MARK-race-${racing}` } } })
      }
      return realPut(ns, value, base)
    })
    r.app.edit({ highlight: { motionColor: 'MARK-local-mine' }, clipLoop: true })
    await afterDebounce()
    expect(r.sync.status().state).toBe('error')
    // The change is still local and still on top: the next poll gets it in.
    await r.sync.poll()
    expect(r.port.row('viewer.app')?.value).toMatchObject({ settings: { highlight: { motionColor: 'MARK-local-mine' } } })
    expect(r.sync.status().state).toBe('synced')
  })
})

describe('offline: the local cache keeps working', () => {
  it('a change made offline is kept, survives a restart, and goes out on the next poll', async () => {
    const r = rig()
    await r.sync.start(HUB)
    r.port.setOffline(true)
    r.app.edit({ highlight: { motionColor: 'MARK-offline' }, clipLoop: true })
    await afterDebounce()
    expect(r.sync.status()).toMatchObject({ state: 'error', error: 'hub unreachable' })
    expect(r.app.value).toEqual({ highlight: { motionColor: 'MARK-offline' }, clipLoop: true })

    // The app restarts while still offline; the stores keep their cache.
    const again = r.restart()
    await again.start(HUB)
    r.port.setOffline(false)
    await again.poll()
    expect(r.port.row('viewer.app')?.value).toEqual({
      settings: { highlight: { motionColor: 'MARK-offline' }, clipLoop: true },
    })
    expect(again.status().state).toBe('synced')
  })
})

describe('poll merge', () => {
  it('a newer row is adopted when nothing is pending locally', async () => {
    const r = rig()
    await r.sync.start(HUB)
    r.port.writeAsAnotherDevice('viewer.grids', { grids: [{ id: 'g1', name: 'MARK-remote-wall', cameraIds: [1] }] })
    await r.sync.poll()
    expect(r.grids.value).toEqual([{ id: 'g1', name: 'MARK-remote-wall', cameraIds: [1] }])
    expect(r.port.calls).toContain('changedSince')
  })

  it('a pending local change rides on top of the newer row', async () => {
    const r = rig()
    await r.sync.start(HUB)
    r.port.writeAsAnotherDevice('viewer.app', { settings: { highlight: { motionColor: 'MARK-local-red' }, clipLoop: false } })
    r.app.edit({ highlight: { motionColor: 'MARK-local-pending' }, clipLoop: true })
    // The poll lands BEFORE the debounce fires.
    await r.sync.poll()
    expect(r.app.value).toEqual({ highlight: { motionColor: 'MARK-local-pending' }, clipLoop: false })
    expect(r.port.row('viewer.app')?.value).toEqual({
      settings: { highlight: { motionColor: 'MARK-local-pending' }, clipLoop: false },
    })
  })
})

describe('copy from another hub', () => {
  it('applies that hub’s cached sections here, then pushes them', async () => {
    const r = rig()
    r.app.cached.set('hub-b', { highlight: { motionColor: 'MARK-hubB' } })
    await r.sync.start(HUB)
    await r.sync.copyFrom('hub-b')
    expect(r.app.value).toEqual({ highlight: { motionColor: 'MARK-hubB' } })
    // A section hub B has no cache for keeps this hub's value.
    expect(r.cameras.value).toEqual({ byId: {}, order: [] })
    await afterDebounce()
    expect(r.port.row('viewer.app')?.value).toEqual({ settings: { highlight: { motionColor: 'MARK-hubB' } } })
  })
})

describe('local-only (no hub contract yet — phase 1)', () => {
  it('never calls a port, says "local only", and still copies between hubs', async () => {
    const r = rig({ port: null })
    r.app.cached.set('hub-b', { highlight: { motionColor: 'MARK-hubB' } })
    await r.sync.start(HUB)
    r.app.edit({ highlight: { motionColor: 'MARK-local' }, clipLoop: true })
    await afterDebounce()
    await r.sync.poll()
    expect(r.sync.status().state).toBe('local-only')
    expect(r.storage.map.size).toBe(0)
    await r.sync.copyFrom('hub-b')
    expect(r.app.value).toEqual({ highlight: { motionColor: 'MARK-hubB' } })
  })
})
