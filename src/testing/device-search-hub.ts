/**
 * A hub that answers `deviceManager.search` over a fixed fleet, with the
 * hub's own rules where the picker depends on them: `ids` resolves exactly
 * those devices (unknown ones in `missingIds`), `requires` is a binding test
 * (`any` by default), the incompatible ones are counted and listed only on
 * `includeIncompatible`, filters and text narrow, facets count the compatible
 * set, `suggested` is the context device's room. One page, no cursor.
 */
import type { DeviceSearchItem, DeviceSearchResult } from '@camstack/types'

export interface FleetDevice {
  readonly id: number
  readonly name: string
  readonly type: string
  readonly location?: string | null
  readonly integrationId?: string | null
  readonly online?: boolean | null
  /** Caps the device is bound to. */
  readonly caps?: readonly string[]
  /** The values its caps expose (cap, path, label, reading). */
  readonly values?: DeviceSearchItem['values']
}

interface SearchAsk {
  readonly text?: string
  readonly ids?: readonly number[]
  readonly requires?: { readonly caps: readonly string[]; readonly mode?: 'any' | 'all' }
  readonly filters?: {
    readonly locations?: readonly string[]
    readonly integrationIds?: readonly string[]
    readonly types?: readonly string[]
  }
  readonly includeIncompatible?: boolean
  readonly contextDeviceId?: number
}

function isAsk(raw: unknown): raw is SearchAsk {
  return typeof raw === 'object' && raw !== null
}

function compatible(device: FleetDevice, ask: SearchAsk): boolean {
  const need = ask.requires?.caps ?? []
  if (need.length === 0) return true
  const has = new Set(device.caps ?? [])
  return ask.requires?.mode === 'all' ? need.every((c) => has.has(c)) : need.some((c) => has.has(c))
}

function toItem(device: FleetDevice, ask: SearchAsk): DeviceSearchItem {
  const ok = compatible(device, ask)
  const need = new Set(ask.requires?.caps ?? [])
  // The fixture's `type` is a plain string; the hub's is the DeviceType enum.
  const item = {
    id: device.id,
    name: device.name,
    type: device.type,
    location: device.location ?? null,
    integrationId: device.integrationId ?? null,
    integrationLabel: device.integrationId ?? null,
    online: device.online ?? true,
    disabled: false,
    compatible: ok,
    values: ok ? (device.values ?? []).filter((v) => need.has(v.cap)) : [],
  }
  return item as DeviceSearchItem
}

function count(values: readonly string[]): { value: string; count: number }[] {
  const by = new Map<string, number>()
  for (const v of values) by.set(v, (by.get(v) ?? 0) + 1)
  return [...by].map(([value, n]) => ({ value, count: n }))
}

export function deviceSearchAnswer(fleet: readonly FleetDevice[], raw: unknown): DeviceSearchResult {
  const ask: SearchAsk = isAsk(raw) ? raw : {}
  const empty = { locations: [], integrations: [], types: [] }
  if (ask.ids !== undefined) {
    const found = ask.ids.flatMap((id) => fleet.filter((d) => d.id === id))
    return {
      items: found.map((d) => toItem(d, ask)),
      nextCursor: null,
      total: found.length,
      compatibleTotal: found.length,
      fleetTotal: fleet.length,
      hiddenIncompatible: 0,
      facets: empty,
      suggested: [],
      missingIds: ask.ids.filter((id) => !fleet.some((d) => d.id === id)),
    }
  }
  const text = (ask.text ?? '').toLowerCase()
  const f = ask.filters ?? {}
  const narrowed = fleet.filter(
    (d) =>
      (text === '' || d.name.toLowerCase().includes(text)) &&
      (f.types === undefined || f.types.includes(d.type)) &&
      (f.locations === undefined || f.locations.includes(d.location ?? '')) &&
      (f.integrationIds === undefined || f.integrationIds.includes(d.integrationId ?? '')),
  )
  const ok = narrowed.filter((d) => compatible(d, ask))
  const listed = ask.includeIncompatible === true ? narrowed : ok
  const compatibleFleet = fleet.filter((d) => compatible(d, ask))
  const room = fleet.find((d) => d.id === ask.contextDeviceId)?.location ?? null
  return {
    items: listed.map((d) => toItem(d, ask)),
    nextCursor: null,
    total: listed.length,
    compatibleTotal: ok.length,
    fleetTotal: fleet.length,
    hiddenIncompatible: narrowed.length - ok.length,
    facets: {
      locations: count(compatibleFleet.flatMap((d) => (d.location ? [d.location] : []))),
      integrations: count(compatibleFleet.flatMap((d) => (d.integrationId ? [d.integrationId] : []))).map(
        (c) => ({ id: c.value, label: c.value, count: c.count }),
      ),
      types: count(compatibleFleet.map((d) => d.type)),
    },
    suggested:
      room === null
        ? []
        : ok.filter((d) => d.location === room && d.id !== ask.contextDeviceId).map((d) => toItem(d, ask)),
    missingIds: [],
  }
}

/** The hub stub's handler map for a fleet. */
export function deviceSearchHub(fleet: readonly FleetDevice[]): Record<string, unknown> {
  return { 'deviceManager.search': (input?: unknown) => deviceSearchAnswer(fleet, input) }
}

/** The `requires` of every `deviceManager.search` call so far, in order. */
export function searchRequires(
  calls: readonly { readonly path: string; readonly input: unknown }[],
): readonly unknown[] {
  return calls
    .filter((call) => call.path === 'deviceManager.search')
    .map((call) => (isAsk(call.input) ? call.input.requires : undefined))
}
