import { describe, expect, it, vi } from 'vitest'
import { IntegrationInstanceSchema } from '@camstack/types'
import { makeNcClient } from '../notification-center.js'
import { type NcInstanceMethod, NcTargetInstanceSchema } from '../nc-target-instances.js'

const ROW = (id: string, owner: string | null, extra: Record<string, unknown> = {}) => ({
  id,
  name: `Phone ${id}`,
  kind: 'pushover',
  configured: true,
  enabled: true,
  formValues: {
    token: 'x',
    ...(owner === null ? {} : { ownerUserId: owner }),
    ...extra,
  },
})

function clientOver(
  answers: Partial<Record<NcInstanceMethod, unknown | ((input: unknown) => unknown)>>,
  userId: string | null = 'u1',
) {
  const calls: Array<{ method: NcInstanceMethod; input: unknown }> = []
  const client = makeNcClient({
    addonsCustomMutate: vi.fn(),
    sessionUserId: () => Promise.resolve(userId ?? undefined),
    integrationInstances: async (args) => {
      calls.push(args)
      const a = answers[args.method]
      if (a === undefined) throw new Error(`NOT_FOUND: ${args.method}`)
      return typeof a === 'function' ? a(args.input) : a
    },
  })
  return { client, calls }
}

const SEED = {
  id: '',
  name: 'Mine',
  kind: 'pushover',
  addonId: 'notifiers',
  enabled: true,
  config: { token: 'x' },
}

function hasId(input: unknown, id: string): boolean {
  return typeof input === 'object' && input !== null && 'id' in input && input.id === id
}

describe('own notification targets through integrationInstances', () => {
  it('lists mine, maps rows to targets and drops rows owned by somebody else', async () => {
    const { client, calls } = clientOver({
      listInstances: [ROW('a', 'u1'), ROW('b', 'u2'), ROW('g', null), { ...ROW('c', 'u1'), enabled: false }],
    })
    const { targets } = await client.listTargets()
    expect(targets.map((t) => t.id)).toEqual(['a', 'c'])
    expect(targets[0]).toEqual({
      id: 'a',
      name: 'Phone a',
      kind: 'pushover',
      addonId: 'notifiers',
      enabled: true,
      config: { token: 'x', ownerUserId: 'u1' },
    })
    expect(targets[1]?.enabled).toBe(false)
    expect(calls).toEqual([{ method: 'listInstances', input: { addonId: 'notifiers', mine: true } }])
  })

  it('creates when the id is not an own row, then sets enabled when it differs', async () => {
    const { client, calls } = clientOver({
      getInstance: (input: unknown) =>
        typeof input === 'object' && input !== null && 'id' in input && input.id === 'new'
          ? ROW('new', 'u1')
          : null,
      createInstance: { id: 'new' },
      setInstanceEnabled: { ok: true },
    })
    const out = await client.upsertTarget({
      id: '',
      name: 'Mine',
      kind: 'pushover',
      addonId: 'notifiers',
      enabled: false,
      config: { token: 'x' },
    })
    expect(out.target.id).toBe('new')
    expect(calls.map((c) => c.method)).toEqual(['createInstance', 'setInstanceEnabled', 'getInstance'])
    expect(calls[0]?.input).toEqual({
      addonId: 'notifiers',
      name: 'Mine',
      kind: 'pushover',
      values: { token: 'x', ownerUserId: 'u1' },
    })
  })

  it('refuses to delete a target somebody else owns', async () => {
    const { client, calls } = clientOver({
      getInstance: ROW('b', 'u2'),
      deleteInstance: { ok: true },
    })
    await expect(client.deleteTarget('b')).rejects.toThrow('target not owned: b')
    expect(calls.some((c) => c.method === 'deleteInstance')).toBe(false)
  })

  it('tests an own target, and says so when the kind has no test', async () => {
    const ok = clientOver({
      getInstance: ROW('a', 'u1'),
      testInstance: { success: false, error: 'bad token' },
    })
    await expect(ok.client.testTarget('a')).resolves.toEqual({
      success: false,
      error: 'bad token',
    })
    const none = clientOver({ getInstance: ROW('a', 'u1') })
    await expect(none.client.testTarget('a')).resolves.toEqual({
      success: false,
      error: 'This kind cannot be tested',
    })
  })

  it('a user that is not known lists nothing and writes nothing', async () => {
    const { client, calls } = clientOver({ listInstances: [ROW('a', 'u1')], getInstance: ROW('a', 'u1') }, null)
    await expect(client.listTargets()).rejects.toThrow('authenticated user required')
    await expect(client.deleteTarget('a')).rejects.toThrow('authenticated user required')
    await expect(client.setTargetEnabled('a', false)).rejects.toThrow('authenticated user required')
    await expect(client.testTarget('a')).rejects.toThrow('authenticated user required')
    await expect(client.upsertTarget(SEED)).rejects.toThrow('authenticated user required')
    expect(calls).toEqual([])
  })

  it('updates an own row in place, and skips setInstanceEnabled when enabled is unchanged', async () => {
    const { client, calls } = clientOver({
      getInstance: ROW('a', 'u1'),
      updateInstance: { ok: true },
      setInstanceEnabled: { ok: true },
    })
    await client.upsertTarget({ ...SEED, id: 'a', name: 'Renamed' })
    expect(calls.map((c) => c.method)).toEqual(['getInstance', 'updateInstance', 'getInstance'])
    expect(calls[1]?.input).toEqual({
      addonId: 'notifiers',
      id: 'a',
      name: 'Renamed',
      values: { token: 'x', ownerUserId: 'u1' },
    })
  })

  it('a FOREIGN id creates a fresh row and never updates it', async () => {
    const { client, calls } = clientOver({
      getInstance: (input: unknown) => (hasId(input, 'b') ? ROW('b', 'u2') : ROW('fresh', 'u1')),
      createInstance: { id: 'fresh' },
      setInstanceEnabled: { ok: true },
    })
    const out = await client.upsertTarget({ ...SEED, id: 'b' })
    expect(out.target.id).toBe('fresh')
    expect(calls.some((c) => c.method === 'updateInstance')).toBe(false)
    expect(calls.some((c) => c.method === 'createInstance')).toBe(true)
  })

  it('switches an own target, and refuses one it does not own', async () => {
    const own = clientOver({ getInstance: ROW('a', 'u1'), setInstanceEnabled: { ok: true } })
    await expect(own.client.setTargetEnabled('a', false)).resolves.toEqual({ success: true })
    expect(own.calls[1]).toEqual({
      method: 'setInstanceEnabled',
      input: { addonId: 'notifiers', id: 'a', enabled: false },
    })
    const foreign = clientOver({ getInstance: ROW('b', 'u2'), setInstanceEnabled: { ok: true } })
    await expect(foreign.client.setTargetEnabled('b', false)).rejects.toThrow('target not owned: b')
    expect(foreign.calls.some((c) => c.method === 'setInstanceEnabled')).toBe(false)
  })

  it('delete and test refuse a GLOBAL row (no owner key)', async () => {
    const { client, calls } = clientOver({
      getInstance: ROW('g', null),
      deleteInstance: { ok: true },
      testInstance: { success: true },
    })
    await expect(client.deleteTarget('g')).rejects.toThrow('target not owned: g')
    await expect(client.testTarget('g')).rejects.toThrow('target not owned: g')
    expect(calls.map((c) => c.method)).toEqual(['getInstance', 'getInstance'])
  })

  it('a test that fails for a reason other than a missing procedure surfaces', async () => {
    const { client } = clientOver({
      getInstance: ROW('a', 'u1'),
      testInstance: () => {
        throw new Error('network request failed: unavailable')
      },
    })
    await expect(client.testTarget('a')).rejects.toThrow('unavailable')
  })

  it('the viewer mirror reads what the published instance schema writes', () => {
    const published = IntegrationInstanceSchema.parse(ROW('a', 'u1'))
    expect(() => NcTargetInstanceSchema.parse(published)).not.toThrow()
  })
})
