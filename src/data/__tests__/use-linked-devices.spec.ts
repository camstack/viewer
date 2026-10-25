import { describe, it, expect } from 'vitest'
import {
  parseLinkedDevices,
  enrichLinkedEntries,
  sortDevicesByName,
  resolveLinkedDevicesData,
  type LinkedDevicesFetchers,
  type LinkedDeviceInfoLite,
  type LinkedPanelDevice,
} from '../use-linked-devices.js'
import type { AccessoryDevice } from '../use-accessories.js'

const LINKED_PAYLOAD = {
  mode: 'auto',
  devices: [
    { deviceId: 5, name: 'Siren', location: null, features: ['switch'] },
    { deviceId: 9, name: 'Desk lamp', location: 'Studio', features: ['switch', 'brightness'] },
  ],
}

const INFOS: readonly LinkedDeviceInfoLite[] = [
  { id: 5, type: 'siren', online: true },
  { id: 9, type: 'light', online: false },
]

const CHILDREN: readonly AccessoryDevice[] = [
  { id: 5, name: 'Siren', type: 'siren', online: true, features: ['switch'] },
]

describe('parseLinkedDevices', () => {
  it('parses a well-formed getLinkedDevices payload', () => {
    const parsed = parseLinkedDevices(LINKED_PAYLOAD)
    expect(parsed).not.toBeNull()
    expect(parsed?.mode).toBe('auto')
    expect(parsed?.entries).toEqual([
      { deviceId: 5, name: 'Siren', location: null, features: ['switch'] },
      { deviceId: 9, name: 'Desk lamp', location: 'Studio', features: ['switch', 'brightness'] },
    ])
  })

  it('parses manual mode', () => {
    expect(parseLinkedDevices({ mode: 'manual', devices: [] })?.mode).toBe('manual')
  })

  it('rejects malformed envelopes (the fallback trigger)', () => {
    expect(parseLinkedDevices(null)).toBeNull() // capQuery's swallowed-error result
    expect(parseLinkedDevices(undefined)).toBeNull()
    expect(parseLinkedDevices({})).toBeNull()
    expect(parseLinkedDevices({ mode: 'weird', devices: [] })).toBeNull()
    expect(parseLinkedDevices({ mode: 'auto' })).toBeNull() // missing devices
    expect(parseLinkedDevices({ mode: 'auto', devices: 'nope' })).toBeNull()
    expect(parseLinkedDevices([])).toBeNull()
  })

  it('drops malformed entries but keeps the valid ones', () => {
    const parsed = parseLinkedDevices({
      mode: 'auto',
      devices: [
        null,
        { deviceId: 'not-a-number', name: 'x' },
        { deviceId: 7, name: 'OK', location: null, features: [] },
      ],
    })
    expect(parsed?.entries).toHaveLength(1)
    expect(parsed?.entries[0]?.deviceId).toBe(7)
  })

  it('defaults a blank name and a non-string location', () => {
    const parsed = parseLinkedDevices({
      mode: 'auto',
      devices: [{ deviceId: 3, name: '  ', location: 42, features: 'nope' }],
    })
    expect(parsed?.entries[0]).toEqual({
      deviceId: 3,
      name: 'Device #3',
      location: null,
      features: [],
    })
  })
})

describe('enrichLinkedEntries', () => {
  const parsed = parseLinkedDevices(LINKED_PAYLOAD)
  const entries = parsed?.entries ?? []

  it('joins type + online from device infos by id', () => {
    const rows = enrichLinkedEntries(entries, INFOS)
    expect(rows).toEqual([
      {
        id: 5,
        name: 'Siren',
        type: 'siren',
        online: true,
        features: ['switch'],
        location: null,
        role: null,
        displayIcon: null,
      },
      {
        id: 9,
        name: 'Desk lamp',
        type: 'light',
        online: false,
        features: ['switch', 'brightness'],
        location: 'Studio',
        role: null,
        displayIcon: null,
      },
    ])
  })

  it('degrades an un-joined device to a generic online row (controls stay usable)', () => {
    const rows = enrichLinkedEntries(entries, [])
    expect(rows[0]?.type).toBe('')
    expect(rows[0]?.online).toBe(true)
  })
})

describe('sortDevicesByName', () => {
  it('sorts case-insensitively by name without mutating the input', () => {
    const input: readonly LinkedPanelDevice[] = [
      { id: 1, name: 'zebra', type: '', online: true, features: [], location: null, role: null, displayIcon: null },
      { id: 2, name: 'Alpha', type: '', online: true, features: [], location: null, role: null, displayIcon: null },
      { id: 3, name: 'beta', type: '', online: true, features: [], location: null, role: null, displayIcon: null },
    ]
    const sorted = sortDevicesByName(input)
    expect(sorted.map((d) => d.name)).toEqual(['Alpha', 'beta', 'zebra'])
    expect(input.map((d) => d.name)).toEqual(['zebra', 'Alpha', 'beta'])
  })
})

/** Fetcher stub factory — counts calls so tests assert WHICH source ran. */
function makeFetchers(overrides: Partial<LinkedDevicesFetchers>): {
  fetchers: LinkedDevicesFetchers
  calls: { linked: number; children: number; infos: number; infoIds: number[][] }
} {
  const calls = { linked: 0, children: 0, infos: 0, infoIds: [] as number[][] }
  const fetchers: LinkedDevicesFetchers = {
    fetchLinked: async () => {
      calls.linked += 1
      return LINKED_PAYLOAD
    },
    fetchChildren: async () => {
      calls.children += 1
      return CHILDREN
    },
    fetchDeviceInfos: async (deviceIds) => {
      calls.infos += 1
      calls.infoIds.push([...deviceIds])
      return INFOS
    },
    ...overrides,
  }
  return { fetchers, calls }
}

describe('resolveLinkedDevicesData — the fallback decision', () => {
  it('uses the linked source when the server answers with a valid payload', async () => {
    const { fetchers, calls } = makeFetchers({})
    const data = await resolveLinkedDevicesData(fetchers)
    expect(data.source).toBe('linked')
    expect(data.mode).toBe('auto')
    // Sorted by name: Desk lamp before Siren.
    expect(data.devices.map((d) => d.id)).toEqual([9, 5])
    expect(calls.children).toBe(0) // fallback never consulted
    expect(calls.infos).toBe(1) // enrichment ran
  })

  it('falls back to the children source when the method is missing (capQuery null)', async () => {
    const { fetchers, calls } = makeFetchers({ fetchLinked: async () => null })
    const data = await resolveLinkedDevicesData(fetchers)
    expect(data.source).toBe('children')
    expect(data.mode).toBeNull()
    expect(data.devices).toEqual([{ ...CHILDREN[0], location: null, role: null, displayIcon: null }])
    expect(calls.infos).toBe(0) // no enrichment on the fallback path
  })

  it('falls back when the linked fetch throws (old server rejects)', async () => {
    const { fetchers } = makeFetchers({
      fetchLinked: async () => {
        throw new Error('NOT_FOUND')
      },
    })
    const data = await resolveLinkedDevicesData(fetchers)
    expect(data.source).toBe('children')
    expect(data.devices).toHaveLength(1)
  })

  it('falls back when the linked payload is malformed', async () => {
    const { fetchers } = makeFetchers({ fetchLinked: async () => ({ mode: 'auto' }) })
    const data = await resolveLinkedDevicesData(fetchers)
    expect(data.source).toBe('children')
  })

  it('returns an empty children list when BOTH sources fail (never throws)', async () => {
    const { fetchers } = makeFetchers({
      fetchLinked: async () => null,
      fetchChildren: async () => {
        throw new Error('boom')
      },
    })
    const data = await resolveLinkedDevicesData(fetchers)
    expect(data).toEqual({ source: 'children', mode: null, devices: [] })
  })

  it('keeps a valid linked answer even when enrichment fails (degraded rows)', async () => {
    const { fetchers } = makeFetchers({
      fetchDeviceInfos: async () => {
        throw new Error('boom')
      },
    })
    const data = await resolveLinkedDevicesData(fetchers)
    expect(data.source).toBe('linked')
    expect(data.devices.every((d) => d.online)).toBe(true)
    expect(data.devices.every((d) => d.type === '')).toBe(true)
  })

  it('linked answer with zero devices is still the linked source (empty state, no fallback)', async () => {
    const { fetchers, calls } = makeFetchers({
      fetchLinked: async () => ({ mode: 'manual', devices: [] }),
    })
    const data = await resolveLinkedDevicesData(fetchers)
    expect(data.source).toBe('linked')
    expect(data.mode).toBe('manual')
    expect(data.devices).toEqual([])
    expect(calls.children).toBe(0)
  })
})

describe('the enrichment join asks about the linked ids, not the fleet', () => {
  /**
   * Measured on the live hub 2026-08-25: unnarrowed, this join answered a
   * question about ~8 devices with 967 rows — 958 KB unprojected, 433 KB slim
   * — on a query that refetches on the reconcile interval, on a phone. The
   * fetcher takes the ids for exactly that reason, so asserting the SHAPE of
   * the answer would miss the whole point; assert what was asked.
   */
  it('passes the resolved linked ids down to the device-info fetcher', async () => {
    const { fetchers, calls } = makeFetchers({})
    await resolveLinkedDevicesData(fetchers)
    expect(calls.infoIds).toEqual([[5, 9]])
  })

  it('asks for nothing when the linked answer is empty — no fleet listing', async () => {
    const { fetchers, calls } = makeFetchers({
      fetchLinked: async () => ({ mode: 'auto', devices: [] }),
    })
    await resolveLinkedDevicesData(fetchers)
    expect(calls.infoIds).toEqual([[]])
  })
})
