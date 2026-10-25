/**
 * Extended accessory cap-status hooks — the "full parity" device controls
 * ported from admin-ui's HeroRegistry: media-player, vacuum, lawn-mower,
 * pet-feeder, humidifier, water-heater, update, weather, image and the generic
 * `control` (HA input_number / input_select / input_text / input_datetime).
 *
 * Each hook reads one cap's auto-injected `getStatus({ deviceId })` via the
 * shared `useCapStatus` and narrows the payload with a local type guard (no
 * `any`). Shapes mirror the server `*StatusSchema`s in
 * `camstack-server/packages/types/src/capabilities/*.cap.ts` — only the fields
 * the compact row renders are narrowed.
 *
 * The core controls' hooks (switch/lock/cover/…) live in
 * `use-accessory-controls.ts`; this file extends that set to keep each file
 * focused. Mutations go through the same `useCapMutator` exported there.
 */
import { type UseQueryResult } from '@tanstack/react-query'
import { useCapStatus } from './use-cap-status.js'

// ── narrowing helpers ─────────────────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}
function numOrNull(v: unknown): v is number | null {
  return v === null || typeof v === 'number'
}
function strOrNull(v: unknown): v is string | null {
  return v === null || typeof v === 'string'
}

// ── media-player ───────────────────────────────────────────────────────────────

export type MediaPlayerState = 'off' | 'on' | 'idle' | 'playing' | 'paused' | 'buffering' | 'standby'
export interface MediaPlayerStatus {
  readonly state: MediaPlayerState
}
const MEDIA_STATES: readonly MediaPlayerState[] = ['off', 'on', 'idle', 'playing', 'paused', 'buffering', 'standby']
function isMediaPlayerStatus(v: unknown): v is MediaPlayerStatus {
  return isRecord(v) && typeof v.state === 'string' && (MEDIA_STATES as readonly string[]).includes(v.state)
}
export function useMediaPlayerStatus(deviceId: number, enabled: boolean): UseQueryResult<MediaPlayerStatus | null> {
  return useCapStatus('mediaPlayer', deviceId, isMediaPlayerStatus, enabled)
}

// ── vacuum ─────────────────────────────────────────────────────────────────────

export type VacuumState = 'idle' | 'cleaning' | 'paused' | 'returning' | 'docked' | 'drying' | 'error'
export interface VacuumStatus {
  readonly state: VacuumState
  readonly batteryLevel: number | null
}
const VACUUM_STATES: readonly VacuumState[] = ['idle', 'cleaning', 'paused', 'returning', 'docked', 'drying', 'error']
function isVacuumStatus(v: unknown): v is VacuumStatus {
  return isRecord(v) && typeof v.state === 'string' && (VACUUM_STATES as readonly string[]).includes(v.state) && numOrNull(v.batteryLevel)
}
export function useVacuumStatus(deviceId: number, enabled: boolean): UseQueryResult<VacuumStatus | null> {
  return useCapStatus('vacuumControl', deviceId, isVacuumStatus, enabled)
}

// ── lawn-mower ──────────────────────────────────────────────────────────────────

export type LawnMowerActivity = 'idle' | 'mowing' | 'paused' | 'docked' | 'error'
export interface LawnMowerStatus {
  readonly activity: LawnMowerActivity
  readonly batteryLevel: number | null
}
const MOWER_ACTIVITIES: readonly LawnMowerActivity[] = ['idle', 'mowing', 'paused', 'docked', 'error']
function isLawnMowerStatus(v: unknown): v is LawnMowerStatus {
  return isRecord(v) && typeof v.activity === 'string' && (MOWER_ACTIVITIES as readonly string[]).includes(v.activity) && numOrNull(v.batteryLevel)
}
export function useLawnMowerStatus(deviceId: number, enabled: boolean): UseQueryResult<LawnMowerStatus | null> {
  return useCapStatus('lawnMowerControl', deviceId, isLawnMowerStatus, enabled)
}

// ── pet-feeder ──────────────────────────────────────────────────────────────────

export interface PetFeederStatus {
  readonly feeding: boolean
  readonly foodLevel: number | null
  readonly lowFood: boolean
}
function isPetFeederStatus(v: unknown): v is PetFeederStatus {
  return isRecord(v) && typeof v.feeding === 'boolean' && numOrNull(v.foodLevel) && typeof v.lowFood === 'boolean'
}
export function usePetFeederStatus(deviceId: number, enabled: boolean): UseQueryResult<PetFeederStatus | null> {
  return useCapStatus('petFeeder', deviceId, isPetFeederStatus, enabled)
}

// ── humidifier ──────────────────────────────────────────────────────────────────

export interface HumidifierStatus {
  readonly on: boolean
  readonly currentHumidity: number | null
  readonly targetHumidity: number | null
  readonly mode: string | null
  readonly availableModes: readonly string[]
  readonly action: string | null
  readonly minHumidity: number | null
  readonly maxHumidity: number | null
}
function isHumidifierStatus(v: unknown): v is HumidifierStatus {
  return (
    isRecord(v) && typeof v.on === 'boolean' &&
    numOrNull(v.currentHumidity) && numOrNull(v.targetHumidity) &&
    strOrNull(v.mode) && Array.isArray(v.availableModes) &&
    v.availableModes.every((mode) => typeof mode === 'string') &&
    strOrNull(v.action) && numOrNull(v.minHumidity) && numOrNull(v.maxHumidity)
  )
}
export function useHumidifierStatus(deviceId: number, enabled: boolean): UseQueryResult<HumidifierStatus | null> {
  return useCapStatus('humidifier', deviceId, isHumidifierStatus, enabled)
}

// ── water-heater ────────────────────────────────────────────────────────────────

export interface WaterHeaterStatus {
  readonly currentTemp: number | null
  readonly targetTemp: number | null
  readonly operationMode: string | null
  readonly availableModes: readonly string[]
  readonly away: boolean | null
  readonly minTemp: number | null
  readonly maxTemp: number | null
}
function isWaterHeaterStatus(v: unknown): v is WaterHeaterStatus {
  return (
    isRecord(v) && numOrNull(v.currentTemp) && numOrNull(v.targetTemp) &&
    strOrNull(v.operationMode) && Array.isArray(v.availableModes) &&
    v.availableModes.every((mode) => typeof mode === 'string') &&
    (v.away === null || typeof v.away === 'boolean') &&
    numOrNull(v.minTemp) && numOrNull(v.maxTemp)
  )
}
export function useWaterHeaterStatus(deviceId: number, enabled: boolean): UseQueryResult<WaterHeaterStatus | null> {
  return useCapStatus('waterHeater', deviceId, isWaterHeaterStatus, enabled)
}

// ── update ───────────────────────────────────────────────────────────────────────

export interface UpdateStatus {
  readonly currentVersion: string | null
  readonly availableVersion: string | null
  readonly updatable: boolean
  readonly inProgress: boolean
}
function isUpdateStatus(v: unknown): v is UpdateStatus {
  return isRecord(v) && strOrNull(v.currentVersion) && strOrNull(v.availableVersion) && typeof v.updatable === 'boolean' && typeof v.inProgress === 'boolean'
}
export function useUpdateStatus(deviceId: number, enabled: boolean): UseQueryResult<UpdateStatus | null> {
  return useCapStatus('update', deviceId, isUpdateStatus, enabled)
}

// ── weather (read-only) ──────────────────────────────────────────────────────────

export interface WeatherStatus {
  readonly condition: string | null
  readonly temperature: number | null
  readonly temperatureUnit: string | null
}
function isWeatherStatus(v: unknown): v is WeatherStatus {
  return isRecord(v) && strOrNull(v.condition) && numOrNull(v.temperature) && strOrNull(v.temperatureUnit)
}
export function useWeatherStatus(deviceId: number, enabled: boolean): UseQueryResult<WeatherStatus | null> {
  return useCapStatus('weather', deviceId, isWeatherStatus, enabled)
}

// ── image (read-only) ────────────────────────────────────────────────────────────

export interface ImageStatus {
  readonly url: string | null
}
function isImageStatus(v: unknown): v is ImageStatus {
  return isRecord(v) && strOrNull(v.url)
}
export function useImageStatus(deviceId: number, enabled: boolean): UseQueryResult<ImageStatus | null> {
  return useCapStatus('image', deviceId, isImageStatus, enabled)
}

// ── control (HA input_number / input_select / input_text / input_datetime) ───────

export type ControlKind = 'numeric' | 'select' | 'text' | 'datetime'
export interface ControlStatus {
  readonly kind: ControlKind
  readonly value: number | string
  readonly options: readonly string[]
  readonly unit?: string
  readonly min?: number
  readonly max?: number
  readonly step?: number
}
const CONTROL_KINDS: readonly ControlKind[] = ['numeric', 'select', 'text', 'datetime']
function isControlStatus(v: unknown): v is ControlStatus {
  if (!isRecord(v)) return false
  if (typeof v.kind !== 'string' || !(CONTROL_KINDS as readonly string[]).includes(v.kind)) return false
  if (!(typeof v.value === 'number' || typeof v.value === 'string')) return false
  return Array.isArray(v.options) && v.options.every((o) => typeof o === 'string')
}
export function useControlStatus(deviceId: number, enabled: boolean): UseQueryResult<ControlStatus | null> {
  return useCapStatus('control', deviceId, isControlStatus, enabled)
}

// ── event-emitter (read-only: wall switch / remote / scene controller) ───────────

/** One fired event. `data` is free-form and OPTIONAL per the cap — the only key
 *  the row interprets is `channel` (the button index), and only when present. */
export interface EventFireStatus {
  readonly eventType: string
  readonly data: Record<string, unknown> | null
  readonly timestamp: number
  /** Monotonic: two identical presses still differ here. The row's live
   *  highlight keys on this and on nothing else. */
  readonly seq: number
}
export interface EventEmitterStatus {
  /** The device's declared vocabulary, VERBATIM. Empty for a generic source. */
  readonly eventTypes: readonly string[]
  readonly lastEvent: EventFireStatus | null
  readonly eventCountSinceStart: number
}
function isEventFire(v: unknown): v is EventFireStatus {
  return (
    isRecord(v) &&
    typeof v.eventType === 'string' &&
    typeof v.timestamp === 'number' &&
    typeof v.seq === 'number' &&
    (v.data === null || isRecord(v.data))
  )
}
function isEventEmitterStatus(v: unknown): v is EventEmitterStatus {
  if (!isRecord(v)) return false
  if (!Array.isArray(v.eventTypes) || !v.eventTypes.every((t) => typeof t === 'string')) return false
  if (typeof v.eventCountSinceStart !== 'number') return false
  return v.lastEvent === null || isEventFire(v.lastEvent)
}
export function useEventEmitterStatus(deviceId: number, enabled: boolean): UseQueryResult<EventEmitterStatus | null> {
  return useCapStatus('eventEmitter', deviceId, isEventEmitterStatus, enabled)
}
