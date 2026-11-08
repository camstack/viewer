/**
 * The cap slices the device detail screen reads that no other viewer surface
 * does: `running-state`, `contact`, `power-meter`, `consumables`. Each parser
 * keeps "the hub said nothing usable" (`null`) apart from "the hub said no".
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { useConnection } from '../connection/ConnectionProvider.js'
import { capQuery, isRecord } from './cap-query.js'
import { useCapStatusParsed } from './use-cap-status.js'
import { RECONCILE_MS } from './reconcile.js'
import { toAccessory, type AccessoryDevice } from './use-accessories.js'

export interface RunningStateStatus {
  /** `null` = the hub does not know; never coerced to "idle". */
  readonly running: boolean | null
  /** Epoch ms the current state began. */
  readonly since: number | null
}

export function toRunningState(raw: unknown): RunningStateStatus | null {
  if (!isRecord(raw)) return null
  const { running, since } = raw
  if (running !== null && typeof running !== 'boolean') return null
  return { running, since: typeof since === 'number' && since > 0 ? since : null }
}

export interface ContactStatus {
  readonly entryOpen: boolean
  /** Epoch ms of the last transition; null when never observed. */
  readonly since: number | null
}

export function toContact(raw: unknown): ContactStatus | null {
  if (!isRecord(raw) || typeof raw.entryOpen !== 'boolean') return null
  const at = raw.lastChangedAt
  return { entryOpen: raw.entryOpen, since: typeof at === 'number' && at > 0 ? at : null }
}

export interface PowerMeterStatus {
  /** Instantaneous draw, watts. */
  readonly watts: number
}

export function toPowerMeter(raw: unknown): PowerMeterStatus | null {
  if (!isRecord(raw)) return null
  const { power } = raw
  return typeof power === 'number' && Number.isFinite(power) ? { watts: power } : null
}

export type ConsumableStatusKey = 'ok' | 'low' | 'empty' | 'full' | 'replace'

export interface ConsumableRow {
  readonly key: string
  readonly label: string
  /** 0..100, or null when the provider reports no level. */
  readonly level: number | null
  /** The provider's own verdict, when it gave one. */
  readonly status: ConsumableStatusKey | null
}

function isStatusKey(v: unknown): v is ConsumableStatusKey {
  return v === 'ok' || v === 'low' || v === 'empty' || v === 'full' || v === 'replace'
}

export function toConsumables(raw: unknown): readonly ConsumableRow[] | null {
  if (!isRecord(raw) || !Array.isArray(raw.items)) return null
  const rows: ConsumableRow[] = []
  for (const item of raw.items) {
    if (!isRecord(item) || typeof item.key !== 'string' || typeof item.label !== 'string') continue
    const status = isStatusKey(item.status) ? item.status : null
    rows.push({
      key: item.key,
      label: item.label,
      level: typeof item.level === 'number' && Number.isFinite(item.level) ? item.level : null,
      status,
    })
  }
  return rows
}

/** True when the provider itself says this item needs attention. */
export function consumableNeedsAttention(row: ConsumableRow): boolean {
  return row.status === 'low' || row.status === 'empty' || row.status === 'replace'
}

export function useRunningState(deviceId: number, enabled: boolean): UseQueryResult<RunningStateStatus | null> {
  return useCapStatusParsed('runningState', deviceId, toRunningState, enabled)
}
export function useContactStatus(deviceId: number, enabled: boolean): UseQueryResult<ContactStatus | null> {
  return useCapStatusParsed('contact', deviceId, toContact, enabled)
}
export function usePowerMeter(deviceId: number, enabled: boolean): UseQueryResult<PowerMeterStatus | null> {
  return useCapStatusParsed('powerMeter', deviceId, toPowerMeter, enabled)
}
export function useConsumables(deviceId: number, enabled: boolean): UseQueryResult<readonly ConsumableRow[] | null> {
  return useCapStatusParsed('consumables', deviceId, toConsumables, enabled)
}

/** One device's identity (name, type, online, features) — `null` while unanswered or unreadable. */
export function useDeviceIdentity(deviceId: number): UseQueryResult<AccessoryDevice | null> {
  const { controller, state } = useConnection()
  return useQuery<AccessoryDevice | null>({
    queryKey: ['v2', 'device-identity', deviceId],
    enabled: state === 'connected',
    staleTime: RECONCILE_MS,
    refetchInterval: RECONCILE_MS,
    queryFn: async () => {
      const system = controller.getSystem()
      if (!system) return null
      const raw: unknown = await capQuery(
        system.trpcClient as unknown as Record<string, unknown>,
        'deviceManager',
        'listAll',
        { deviceIds: [deviceId] },
      )
      if (!Array.isArray(raw)) return null
      for (const row of raw) {
        const device = toAccessory(row)
        if (device !== null && device.id === deviceId) return device
      }
      return null
    },
  })
}

/** "12 min", "1 h 5 min", "2 d 3 h" — units are the same in en and it. */
export function formatElapsed(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000)
  if (minutes < 1) return '<1 min'
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return minutes % 60 === 0 ? `${hours} h` : `${hours} h ${minutes % 60} min`
  const days = Math.floor(hours / 24)
  return hours % 24 === 0 ? `${days} d` : `${days} d ${hours % 24} h`
}
