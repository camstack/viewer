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
  userId: string | undefined = 'u1',
) {
  const calls: Array<{ method: NcInstanceMethod; input: unknown }> = []
  const client = makeNcClient({
    addonsCustomMutate: vi.fn(),
    sessionUserId: () => Promise.resolve(userId),
    integrationInstances: async (args) => {
      calls.push(args)
      const a = answers[args.method]
      if (a === undefined) throw new Error(`NOT_FOUND: ${args.method}`)
      return typeof a === 'function' ? a(args.input) : a
    },
  })
  return { client, calls }
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

  it('the viewer mirror reads what the published instance schema writes', () => {
    const published = IntegrationInstanceSchema.parse(ROW('a', 'u1'))
    expect(() => NcTargetInstanceSchema.parse(published)).not.toThrow()
  })
})
