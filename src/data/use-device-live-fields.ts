/**
 * useDeviceLiveFields — the live, readonly values a device publishes, flattened
 * into pickable rows.
 *
 * This is the catalogue behind the overlay's readouts. The operator wanted to
 * pin "the current dB/RMS and similar — sensors linked to the camera, with
 * label and unit exactly as on the UI". TWO server surfaces hold such values,
 * and the catalogue merges both:
 *
 *  1. `deviceManager.getDeviceLiveInfoAggregate` — addon-contributed live
 *     config-UI sections (a camera's pipeline status, for example). Verified
 *     against the live hub on 2026-08-01: for SENSOR devices this returns
 *     `null` — a thermometer's reading is NOT here.
 *  2. The sensor caps' auto-injected `getStatus({ deviceId })` slices —
 *     `temperatureSensor.getStatus` → `{ celsius, unit?, precision? }`, and so
 *     on. This is the SAME source the accessory rows render (see
 *     `use-accessory-controls.ts` `useSensorValue`), so a pinned chip carries
 *     the unit and precision the operator already reads there. Which caps a
 *     device holds comes from `deviceManager.getBindings` (access: view).
 *
 * ## Narrowing
 *
 * The aggregate's `fields` are `z.any()` at the cap boundary (the polymorphic
 * union would be ~14 variants with recursive groups), so the shape is not typed
 * end to end and this module has to do the narrowing itself. Rows that do not
 * carry a key and a scalar value are DROPPED — a group, a button, an editor
 * widget is not something to draw over a picture.
 *
 * ## Cadence
 *
 * Polled at the live cadence only while something is watching (`enabled`), and
 * the same query serves both the picker and the drawn chips: `queryKey` is per
 * device, so N chips from one device cost one request, not N.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { useConnection } from '../connection/ConnectionProvider.js'
import { capQuery, isRecord } from './cap-query.js'
import { RECONCILE_MS } from './reconcile.js'
import { log } from '../lib/logger.js'
import {
  CAP_STATUS_CATALOG,
  capStatusDeviceFieldKey,
  isOsdSourceCap,
} from '../../shared/osd-source-fields.js'

/**
 * Reconcile cadence for live values. The MECHANISM is the shared subscription.
 *
 * This was 5 s, and that was the only way a pinned dB chip ever moved. It did
 * not need to be: every reading here comes from a sensor cap's `getStatus`
 * slice, and a slice write goes through `device-state-mirror.ts`, which emits
 * `device.state-changed` — the category `use-live-invalidation.ts` has been
 * subscribed to since the first migration. The event was already arriving; this
 * query simply was not listening to it.
 *
 * So `['v2','device-live-fields']` joins that map and the interval becomes the
 * D8 backstop for a dropped event, per `reconcile.ts`. A chip now moves when
 * the sensor moves rather than up to five seconds later, and costs one request
 * per five minutes instead of twelve per minute per device on screen.
 */
export const LIVE_FIELDS_POLL_MS = RECONCILE_MS

/** One pickable/drawable live value. */
export interface DeviceLiveField {
  readonly sectionId: string
  readonly sectionTitle: string
  readonly key: string
  readonly label: string
  readonly value: string | number | boolean | null
  readonly unit?: string
  readonly precision?: number
}

function scalarOrNull(v: unknown): string | number | boolean | null {
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v
  return null
}

function parseField(section: Record<string, unknown>, raw: unknown): DeviceLiveField | null {
  if (!isRecord(raw)) return null
  const key = raw.key
  if (typeof key !== 'string' || key.length === 0) return null
  // A field with no scalar value is a widget, not a reading.
  const value = scalarOrNull(raw.value)
  if (value === null) return null
  const sectionId = typeof section.id === 'string' ? section.id : ''
  if (sectionId.length === 0) return null
  const field: {
    sectionId: string
    sectionTitle: string
    key: string
    label: string
    value: string | number | boolean | null
    unit?: string
    precision?: number
  } = {
    sectionId,
    sectionTitle: typeof section.title === 'string' ? section.title : sectionId,
    key,
    label: typeof raw.label === 'string' && raw.label.length > 0 ? raw.label : key,
    value,
  }
  if (typeof raw.unit === 'string' && raw.unit.length > 0) field.unit = raw.unit
  if (typeof raw.precision === 'number' && Number.isFinite(raw.precision)) {
    field.precision = raw.precision
  }
  return field
}

/** Flatten an aggregate payload into rows. Exported for the unit test — the
 *  narrowing is the part that can silently start returning nothing. */
export function parseLiveFields(raw: unknown): readonly DeviceLiveField[] {
  if (!isRecord(raw)) return []
  const sections = raw.sections
  if (!Array.isArray(sections)) return []
  const out: DeviceLiveField[] = []
  for (const s of sections) {
    if (!isRecord(s)) continue
    const fields = s.fields
    if (!Array.isArray(fields)) continue
    for (const f of fields) {
      const parsed = parseField(s, f)
      if (parsed !== null) out.push(parsed)
    }
  }
  return out
}

// ── Sensor cap statuses ──────────────────────────────────────────────────────

/** Section id for cap-status-derived rows. A stored readout addresses its field
 *  as `(sectionId: CAP_STATUS_SECTION_ID, fieldKey: <kebab cap name>)`, so the
 *  existing `OverlayReadoutSource` shape carries these without change. */
export const CAP_STATUS_SECTION_ID = 'cap-status'

/**
 * Legacy export — single-leaf caps only (`valueKey` = the one path). Full
 * catalogue (multi-path climate, weather, …) lives in `shared/osd-source-fields.ts`.
 */
export const CAP_STATUS_FIELDS: Readonly<
  Record<string, { readonly router: string; readonly valueKey: string; readonly label: string; readonly fallbackUnit?: string }>
> = Object.fromEntries(
  Object.entries(CAP_STATUS_CATALOG)
    .filter(([, entry]) => entry.leaves.length === 1)
    .map(([capName, entry]) => {
      const leaf = entry.leaves[0]
      const row: {
        router: string
        valueKey: string
        label: string
        fallbackUnit?: string
      } = { router: entry.router, valueKey: leaf.path, label: leaf.label }
      if (leaf.fallbackUnit !== undefined) row.fallbackUnit = leaf.fallbackUnit
      return [capName, row]
    }),
)

/** The cap names a `deviceManager.getBindings` payload declares. */
export function parseBindingCapNames(raw: unknown): readonly string[] {
  if (!isRecord(raw)) return []
  const entries = raw.entries
  if (!Array.isArray(entries)) return []
  const out: string[] = []
  for (const e of entries) {
    if (isRecord(e) && typeof e.capName === 'string' && e.capName.length > 0) out.push(e.capName)
  }
  return out
}

function capLeafToField(
  capName: string,
  path: string,
  label: string,
  fallbackUnit: string | undefined,
  raw: Record<string, unknown>,
): DeviceLiveField | null {
  const value = scalarOrNull(raw[path])
  if (value === null) return null
  const field: {
    sectionId: string
    sectionTitle: string
    key: string
    label: string
    value: string | number | boolean | null
    unit?: string
    precision?: number
  } = {
    sectionId: CAP_STATUS_SECTION_ID,
    sectionTitle: 'Live',
    key: capStatusDeviceFieldKey(capName, path),
    label,
    value,
  }
  const unit = typeof raw.unit === 'string' && raw.unit.length > 0 ? raw.unit : fallbackUnit
  if (unit !== undefined) field.unit = unit
  if (typeof raw.precision === 'number' && Number.isFinite(raw.precision)) {
    field.precision = raw.precision
  }
  return field
}

/** Map one cap's `getStatus` payload onto zero or more pickable rows. */
export function capStatusToFields(capName: string, raw: unknown): readonly DeviceLiveField[] {
  const entry = CAP_STATUS_CATALOG[capName]
  if (entry === undefined || !isRecord(raw)) return []
  const out: DeviceLiveField[] = []
  for (const leaf of entry.leaves) {
    const row = capLeafToField(capName, leaf.path, leaf.label, leaf.fallbackUnit, raw)
    if (row !== null) out.push(row)
  }
  return out
}

/** First pickable row for a cap — backward-compatible helper for single-leaf caps. */
export function capStatusToField(capName: string, raw: unknown): DeviceLiveField | null {
  const rows = capStatusToFields(capName, raw)
  return rows.length > 0 ? rows[0] : null
}

/** Read the sensor-cap rows for one device: bindings first, then one
 *  `getStatus` per bound sensor cap. Errors degrade to fewer rows. */
async function fetchCapStatusFields(
  client: Record<string, unknown>,
  deviceId: number,
): Promise<readonly DeviceLiveField[]> {
  const bindings = await capQuery(client, 'deviceManager', 'getBindings', { deviceId })
  const sensorCaps = parseBindingCapNames(bindings).filter((c) => isOsdSourceCap(c))
  if (sensorCaps.length === 0) return []
  const rows = await Promise.all(
    sensorCaps.map(async (capName) => {
      const entry = CAP_STATUS_CATALOG[capName]
      if (entry === undefined) return [] as readonly DeviceLiveField[]
      const status = await capQuery(client, entry.router, 'getStatus', { deviceId })
      return capStatusToFields(capName, status)
    }),
  )
  const out = rows.flat()
  if (out.length === 0) {
    // A device that DECLARES sensor caps but answered no status would silently
    // read as "publishes no live values" in the picker — log the drop.
    log.debug('live-fields', 'sensor caps bound but no status answered', {
      deviceId,
      caps: sensorCaps.join(','),
    })
  }
  return out
}

/**
 * Live fields for one device. Empty on an older hub, a device with no live
 * section, or any error — an absent catalogue shows an empty picker, never a
 * broken panel.
 */
export function useDeviceLiveFields(
  deviceId: number,
  enabled: boolean,
): UseQueryResult<readonly DeviceLiveField[]> {
  const { controller, state } = useConnection()
  return useQuery<readonly DeviceLiveField[]>({
    queryKey: ['v2', 'device-live-fields', deviceId],
    enabled: enabled && state === 'connected',
    // Paired with the interval on purpose: without it the global 5s
    // default makes this stale long before its own cadence, so every
    // remount refetches and the reconcile design does nothing.
    staleTime: LIVE_FIELDS_POLL_MS,
    refetchInterval: LIVE_FIELDS_POLL_MS,
    placeholderData: (previous) => previous,
    queryFn: async () => {
      const system = controller.getSystem()
      if (!system) return []
      const client = system.trpcClient as unknown as Record<string, unknown>
      // Both sources in parallel: the aggregate's config-UI live sections, and
      // the sensor caps' status slices (absent for cameras, the whole catalogue
      // for a thermometer — see the module docblock for the live-hub evidence).
      const [aggregate, capFields] = await Promise.all([
        capQuery(client, 'deviceManager', 'getDeviceLiveInfoAggregate', { deviceId }),
        fetchCapStatusFields(client, deviceId),
      ])
      return [...capFields, ...parseLiveFields(aggregate)]
    },
  })
}

/**
 * Format a live value for a chip.
 *
 * Booleans become the caller's on/off words rather than "true"/"false" — a
 * chip reading `Tamper true` over a camera picture is worse than no chip.
 */
export function formatLiveValue(
  value: string | number | boolean | null,
  opts: { readonly precision?: number; readonly unit?: string; readonly onLabel: string; readonly offLabel: string },
): string {
  if (value === null) return '—'
  if (typeof value === 'boolean') return value ? opts.onLabel : opts.offLabel
  const base =
    typeof value === 'number' && opts.precision !== undefined
      ? value.toFixed(opts.precision)
      : String(value)
  return opts.unit ? `${base} ${opts.unit}` : base
}
