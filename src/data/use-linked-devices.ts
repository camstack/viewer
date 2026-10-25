/**
 * useLinkedDevices — the FULL companion-device set for a camera.
 *
 * Primary source is `deviceManager.getLinkedDevices({ deviceId })` (children
 * ALWAYS included, plus same-location devices in `auto` mode or a manual list
 * in `manual` mode — resolved server-side; the viewer is a pure consumer and
 * never configures the association, that lives in admin-ui).
 *
 * GRACEFUL FALLBACK: the method ships with the next server release train, so
 * an older hub rejects / lacks it. We probe it defensively via `capQuery`
 * (missing router, missing method, and thrown errors all collapse to null) and
 * fall back to TODAY's children source (`deviceManager.getChildren`, mapped
 * with the exact same `toAccessory` narrowing `use-accessories` uses) — the
 * panel keeps working exactly as before until the server answers successfully.
 *
 * The linked payload carries `{ deviceId, name, location, features }` but NOT
 * `type` / `online` (which the accessory-control registry needs), nor `role` /
 * `display.icon` (which the panel's icon precedence reads), so a successful
 * linked read is enriched by joining `deviceManager.listAll` (available on
 * every server) on the device id.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { useConnection } from '../connection/ConnectionProvider.js'
import { capQuery, isRecord } from './cap-query.js'
import { toAccessory, toFeatures, type AccessoryDevice } from './use-accessories.js'
import { RECONCILE_MS } from './reconcile.js'

/** Server-resolved association mode (`DeviceLinkModeSchema`). */
export type LinkedDevicesMode = 'auto' | 'manual'

/** Which source produced the panel data. */
export type LinkedDevicesSource = 'linked' | 'children'

/** One row the DevicesPanel renders — an `AccessoryDevice` (so the existing
 *  accessory-control components apply unchanged) plus the linked-device
 *  `location` caption (null on the children fallback, which has no location). */
export interface LinkedPanelDevice extends AccessoryDevice {
  readonly location: string | null
  /** `DeviceInfo.role`, null when the device has none or the join missed it. */
  readonly role: string | null
  /** `DeviceInfo.display.icon` — the admin's per-device icon override, or null. */
  readonly displayIcon: string | null
}

/** The hook's resolved payload. `mode` is null on the children fallback —
 *  an old server has no association mode to report. */
export interface LinkedDevicesData {
  readonly source: LinkedDevicesSource
  readonly mode: LinkedDevicesMode | null
  readonly devices: readonly LinkedPanelDevice[]
}

/** One entry parsed out of a `getLinkedDevices` payload (pre-enrichment). */
export interface ParsedLinkedEntry {
  readonly deviceId: number
  readonly name: string
  readonly location: string | null
  readonly features: readonly string[]
}

/** A validated `getLinkedDevices` payload. */
export interface ParsedLinkedDevices {
  readonly mode: LinkedDevicesMode
  readonly entries: readonly ParsedLinkedEntry[]
}

/** The `DeviceInfo` fields the enrichment join consumes. */
export interface LinkedDeviceInfoLite {
  readonly id: number
  readonly type: string
  readonly online: boolean
  /** Optional on purpose: a caller that only knows the three base fields (the
   *  older join, a test fixture) still type-checks; absence reads as null. */
  readonly role?: string | null
  readonly displayIcon?: string | null
}

/** Narrow one `listAll` row to the fields the join reads. The listing arrives
 *  as `unknown` because it is asked for through `capQuery` (the `deviceIds`
 *  input is newer than the pinned router types), so a row that is not the
 *  expected shape is DROPPED rather than trusted — the join already degrades a
 *  missing device to a generic online row. */
export function isDeviceInfoLite(value: unknown): value is LinkedDeviceInfoLite {
  if (!isRecord(value)) return false
  return (
    typeof value.id === 'number' &&
    typeof value.type === 'string' &&
    typeof value.online === 'boolean'
  )
}

/** The icon-precedence fields of one `listAll` row: `role` and
 *  `display.icon`. Both absent on a hub that predates them — null, never a
 *  guess. Exported because the local-additions read narrows the same shape. */
export function readDeviceIconFields(row: Record<string, unknown>): {
  readonly role: string | null
  readonly displayIcon: string | null
} {
  const display = isRecord(row.display) ? row.display : null
  return {
    role: typeof row.role === 'string' && row.role.length > 0 ? row.role : null,
    displayIcon:
      display !== null && typeof display.icon === 'string' && display.icon.length > 0
        ? display.icon
        : null,
  }
}

/** One `listAll` row → the join's shape, or null when it is not a device row. */
export function toDeviceInfoLite(value: unknown): LinkedDeviceInfoLite | null {
  if (!isRecord(value)) return null
  const { id, type, online } = value
  if (typeof id !== 'number' || typeof type !== 'string' || typeof online !== 'boolean') return null
  return { id, type, online, ...readDeviceIconFields(value) }
}

/** Injected fetchers so the fallback decision is unit-testable without a
 *  tRPC client. The hook wires these to the live connection. */
export interface LinkedDevicesFetchers {
  /** Raw `deviceManager.getLinkedDevices` result; null/garbage on old servers. */
  readonly fetchLinked: () => Promise<unknown>
  /** TODAY's children source, already mapped to `AccessoryDevice` rows. */
  readonly fetchChildren: () => Promise<readonly AccessoryDevice[]>
  /** `deviceManager.listAll` projection used to enrich linked entries.
   *  Takes the ids it is being asked ABOUT — the enrichment is a join onto a
   *  handful of already-resolved linked devices, never a fleet listing. */
  readonly fetchDeviceInfos: (
    deviceIds: readonly number[],
  ) => Promise<readonly LinkedDeviceInfoLite[]>
}

/** Stable empty result so a not-yet-connected query doesn't churn the cache. */
export const EMPTY_LINKED_DEVICES: LinkedDevicesData = {
  source: 'children',
  mode: null,
  devices: [],
}

/** Narrow one raw device entry of a `getLinkedDevices` payload. */
function toParsedEntry(raw: unknown): ParsedLinkedEntry | null {
  if (!isRecord(raw)) return null
  const { deviceId, name, location } = raw
  if (typeof deviceId !== 'number') return null
  return {
    deviceId,
    name: typeof name === 'string' && name.trim() ? name.trim() : `Device #${deviceId}`,
    location: typeof location === 'string' && location.length > 0 ? location : null,
    features: toFeatures(raw.features),
  }
}

/**
 * Validate a raw `getLinkedDevices` response. Returns null for ANY shape that
 * isn't the expected envelope (old server, capQuery's swallowed-error null,
 * wrong mode, missing devices array) — null is the fallback trigger.
 * Malformed individual entries are dropped, a malformed envelope rejects whole.
 */
export function parseLinkedDevices(raw: unknown): ParsedLinkedDevices | null {
  if (!isRecord(raw)) return null
  const { mode, devices } = raw
  if (mode !== 'auto' && mode !== 'manual') return null
  if (!Array.isArray(devices)) return null
  const entries = devices
    .map(toParsedEntry)
    .filter((e): e is ParsedLinkedEntry => e !== null)
  return { mode, entries }
}

/**
 * Join parsed linked entries with `listAll` device infos to recover the
 * `type` (control-registry pick + row icon) and `online` flag the linked
 * payload doesn't carry. A device missing from the join (races between the
 * two reads) degrades to a generic online row so its controls stay usable.
 */
export function enrichLinkedEntries(
  entries: readonly ParsedLinkedEntry[],
  infos: readonly LinkedDeviceInfoLite[],
): LinkedPanelDevice[] {
  const byId = new Map<number, LinkedDeviceInfoLite>(infos.map((i) => [i.id, i]))
  return entries.map((e) => {
    const info = byId.get(e.deviceId)
    return {
      id: e.deviceId,
      name: e.name,
      type: info?.type ?? '',
      online: info?.online ?? true,
      features: e.features,
      location: e.location,
      role: info?.role ?? null,
      displayIcon: info?.displayIcon ?? null,
    }
  })
}

/** Sort rows by display name (locale-aware, case-insensitive, stable input). */
export function sortDevicesByName(
  devices: readonly LinkedPanelDevice[],
): LinkedPanelDevice[] {
  return [...devices].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
  )
}

/** Lift a children-fallback row to a panel row (children carry no location). */
function childToPanelDevice(child: AccessoryDevice): LinkedPanelDevice {
  return { ...child, location: null, role: null, displayIcon: null }
}

/**
 * THE fallback decision (pure, fetcher-injected): try `getLinkedDevices`
 * first; any null / malformed / thrown result means "old server" and the
 * children source answers instead — the DEFAULT until the server responds
 * successfully. Only a validated linked payload switches the panel to the
 * linked source (and only then is `listAll` consulted for enrichment).
 */
export async function resolveLinkedDevicesData(
  fetchers: LinkedDevicesFetchers,
): Promise<LinkedDevicesData> {
  const rawLinked = await fetchers.fetchLinked().catch((): unknown => null)
  const parsed = parseLinkedDevices(rawLinked)
  if (parsed === null) {
    const children = await fetchers
      .fetchChildren()
      .catch((): readonly AccessoryDevice[] => [])
    return {
      source: 'children',
      mode: null,
      devices: sortDevicesByName(children.map(childToPanelDevice)),
    }
  }
  const infos = await fetchers
    .fetchDeviceInfos(parsed.entries.map((e) => e.deviceId))
    .catch((): readonly LinkedDeviceInfoLite[] => [])
  return {
    source: 'linked',
    mode: parsed.mode,
    devices: sortDevicesByName(enrichLinkedEntries(parsed.entries, infos)),
  }
}

/** Data changes rarely (association config + device tree). */
const LINKED_DEVICES_STALE_MS = 30_000

/**
 * Linked companion devices for `deviceId`, resolved to sorted display rows.
 * React Query caches with a ~30s stale window and refetches on that cadence.
 */
export function useLinkedDevices(deviceId: number): UseQueryResult<LinkedDevicesData> {
  const { controller, state } = useConnection()
  return useQuery<LinkedDevicesData>({
    queryKey: ['v2', 'linked-devices', deviceId],
    enabled: state === 'connected',
    staleTime: LINKED_DEVICES_STALE_MS,
    refetchInterval: RECONCILE_MS,
    queryFn: async () => {
      const system = controller.getSystem()
      if (!system) return EMPTY_LINKED_DEVICES
      return resolveLinkedDevicesData({
        // Newer than the pinned SDK router types → defensive capQuery (null on
        // missing method / reject), exactly like the other post-pin endpoints.
        fetchLinked: () =>
          capQuery(system.trpcClient as Record<string, unknown>, 'deviceManager', 'getLinkedDevices', {
            deviceId,
          }),
        // TODAY's source, mapped with the same narrowing use-accessories uses.
        fetchChildren: async () => {
          const children = await system.trpcClient.deviceManager.getChildren.query({
            parentDeviceId: deviceId,
          })
          const list: readonly unknown[] = Array.isArray(children) ? children : []
          return list
            .map(toAccessory)
            .filter((a): a is AccessoryDevice => a !== null)
        },
        fetchDeviceInfos: async (linkedIds) => {
          // Three fields are read — `id`, `type`, `online` — for the ~8 ids
          // that were just resolved. Unnarrowed this dragged the whole fleet
          // across to do it: measured on the live hub 2026-08-25, 967 devices
          // = 958 KB unprojected (every device's `config`, camera credentials
          // included) and 433 KB slim, on a query that refetches on the
          // reconcile interval, on a phone.
          //
          // `isCamera` — the OTHER half of the same fix in `use-cameras` and
          // the events embed — deliberately does NOT transfer here. This join
          // enriches LINKED devices: sensors, buttons, lights. Narrowing to
          // cameras would empty it and every accessory row would fall back to
          // `type: ''` + `online: true`, which is a working-looking UI with
          // the wrong controls on it.
          //
          // `deviceIds` is newer than the pinned SDK router types, and a hub
          // that predates it STRIPS the key rather than rejecting it (verified
          // against the live hub: 967 rows came back) — so this is correct in
          // either deploy order, and `enrichLinkedEntries` already tolerates a
          // device missing from the join.
          const all = await capQuery(
            system.trpcClient as Record<string, unknown>,
            'deviceManager',
            'listAll',
            { projection: 'slim', deviceIds: [...linkedIds] },
          )
          const rows: readonly unknown[] = Array.isArray(all) ? all : []
          return rows.flatMap((d) => {
            const info = toDeviceInfoLite(d)
            return info === null ? [] : [info]
          })
        },
      })
    },
  })
}
