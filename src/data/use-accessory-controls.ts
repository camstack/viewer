/**
 * Accessory cap status hooks + a shared mutation runner.
 *
 * Each hook reads one cap's `getStatus({ deviceId })` via `useCapStatus` and
 * narrows the payload with a local type guard (no `any` — `unknown` in, typed
 * out). Shapes mirror the server `*StatusSchema`s in
 * `camstack-server/packages/types/src/capabilities/*.cap.ts`:
 *   - switch          → { on, lastChangedAt }
 *   - brightness      → { percentage(0..100), lastChangedAt }
 *   - lock-control    → { state: 'locked'|'unlocked'|'locking'|'unlocking'|'jammed', … }
 *   - cover           → { state, position|null, tiltPosition|null, … }
 *   - alarm-panel     → { state, availableModes, requiresCode, … }
 *   - temperature-sensor → { celsius, unit?, precision? }
 *   - humidity-sensor    → { percent, unit?, precision? }
 *   - numeric-sensor     → { value, unit?, precision? }
 *   - enum-sensor        → { value, format? }
 *   - ambient-light-sensor → { lux, unit? }
 *
 * The camelCase `capKey` passed to `useCapStatus` is the tRPC client router key
 * (`lockControl`, `alarmPanel`, `temperatureSensor`…), distinct from the
 * kebab-case `features` name the registry keys on.
 */
import { useCallback, useState } from 'react'
import { type UseQueryResult } from '@tanstack/react-query'
import { useConnection } from '../connection/ConnectionProvider.js'
import { useCapStatus } from './use-cap-status.js'
import { NcLocalizedError, ncNotConnectedError } from './nc-errors.js'
import { useNcErrorText } from '../components/notifications/use-nc-error-text.js'

// ── status shapes (UI subset of the server *StatusSchema) ────────────────────

export interface SwitchStatus {
  readonly on: boolean
}
export interface MotionTriggerStatus {
  readonly enabled: boolean
}
export interface BrightnessStatus {
  readonly percentage: number
}
export type LockState = 'locked' | 'unlocked' | 'locking' | 'unlocking' | 'jammed'
export interface LockStatus {
  readonly state: LockState
}
export type CoverState = 'open' | 'opening' | 'closing' | 'closed' | 'stopped'
export interface CoverStatus {
  readonly state: CoverState
  readonly position: number | null
}
export type AlarmArmMode = 'home' | 'away' | 'night' | 'vacation' | 'custom_bypass'
export type AlarmState =
  | 'disarmed'
  | 'armed_home'
  | 'armed_away'
  | 'armed_night'
  | 'armed_vacation'
  | 'armed_custom_bypass'
  | 'arming'
  | 'disarming'
  | 'pending'
  | 'triggered'
export interface AlarmStatus {
  readonly state: AlarmState
  readonly availableModes: readonly AlarmArmMode[]
  readonly requiresCode: boolean
}
export type HvacMode = 'off' | 'heat' | 'cool' | 'auto' | 'heat_cool' | 'fan_only' | 'dry'
export interface ClimateStatus {
  readonly mode: HvacMode
  readonly availableModes: readonly HvacMode[]
  readonly fanMode: string
  readonly availableFanModes: readonly string[]
  readonly preset: string
  readonly availablePresets: readonly string[]
  readonly target: number | null
  readonly targetLow: number | null
  readonly targetHigh: number | null
  readonly targetHumidity: number | null
  readonly currentTemp: number | null
  /** Current measured relative humidity (0..100), read-only. Null when the
   *  thermostat exposes no humidity reading (no `climate-humidity` feature). */
  readonly currentHumidity: number | null
  readonly swingVertical: boolean | null
  readonly swingHorizontal: boolean | null
}
export type FanDirection = 'forward' | 'reverse'
export interface FanStatus {
  readonly percentage: number | null
  readonly percentageStep?: number
  readonly preset: string
  readonly availablePresets: readonly string[]
  readonly direction: FanDirection | null
  readonly oscillating: boolean | null
}
/** Unified read-only sensor value: a number plus its display unit, or a raw
 *  enum string. Each sensor cap maps onto this for the read-only row. */
export interface SensorValue {
  readonly kind: 'number' | 'enum'
  readonly value: number | string
  readonly unit?: string
  readonly precision?: number
}

// ── guards ───────────────────────────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}
function isSwitchStatus(v: unknown): v is SwitchStatus {
  return isRecord(v) && typeof v.on === 'boolean'
}
function isMotionTriggerStatus(v: unknown): v is MotionTriggerStatus {
  return isRecord(v) && typeof v.enabled === 'boolean'
}
function isBrightnessStatus(v: unknown): v is BrightnessStatus {
  return isRecord(v) && typeof v.percentage === 'number'
}
const LOCK_STATES: readonly LockState[] = ['locked', 'unlocked', 'locking', 'unlocking', 'jammed']
function isLockStatus(v: unknown): v is LockStatus {
  return isRecord(v) && typeof v.state === 'string' && (LOCK_STATES as readonly string[]).includes(v.state)
}
const COVER_STATES: readonly CoverState[] = ['open', 'opening', 'closing', 'closed', 'stopped']
function isCoverStatus(v: unknown): v is CoverStatus {
  if (!isRecord(v) || typeof v.state !== 'string') return false
  if (!(COVER_STATES as readonly string[]).includes(v.state)) return false
  return v.position === null || typeof v.position === 'number'
}
const ALARM_STATES: readonly AlarmState[] = [
  'disarmed', 'armed_home', 'armed_away', 'armed_night', 'armed_vacation',
  'armed_custom_bypass', 'arming', 'disarming', 'pending', 'triggered',
]
const ALARM_MODES: readonly AlarmArmMode[] = ['home', 'away', 'night', 'vacation', 'custom_bypass']
function isAlarmStatus(v: unknown): v is AlarmStatus {
  if (!isRecord(v) || typeof v.state !== 'string') return false
  if (!(ALARM_STATES as readonly string[]).includes(v.state)) return false
  if (typeof v.requiresCode !== 'boolean') return false
  if (!Array.isArray(v.availableModes)) return false
  return v.availableModes.every((m) => typeof m === 'string' && (ALARM_MODES as readonly string[]).includes(m))
}

const HVAC_MODES: readonly HvacMode[] = ['off', 'heat', 'cool', 'auto', 'heat_cool', 'fan_only', 'dry']
function isHvacMode(v: unknown): v is HvacMode {
  return typeof v === 'string' && (HVAC_MODES as readonly string[]).includes(v)
}
function isNumOrNull(v: unknown): v is number | null {
  return v === null || typeof v === 'number'
}
function isClimateStatus(v: unknown): v is ClimateStatus {
  if (!isRecord(v) || !isHvacMode(v.mode)) return false
  if (!Array.isArray(v.availableModes) || !v.availableModes.every(isHvacMode)) return false
  if (typeof v.fanMode !== 'string' || !Array.isArray(v.availableFanModes)) return false
  if (!v.availableFanModes.every((mode) => typeof mode === 'string')) return false
  if (typeof v.preset !== 'string' || !Array.isArray(v.availablePresets)) return false
  if (!v.availablePresets.every((preset) => typeof preset === 'string')) return false
  return (
    isNumOrNull(v.target) &&
    isNumOrNull(v.targetLow) &&
    isNumOrNull(v.targetHigh) &&
    isNumOrNull(v.targetHumidity) &&
    isNumOrNull(v.currentTemp) &&
    isNumOrNull(v.currentHumidity) &&
    (v.swingVertical === null || typeof v.swingVertical === 'boolean') &&
    (v.swingHorizontal === null || typeof v.swingHorizontal === 'boolean')
  )
}
function isFanStatus(v: unknown): v is FanStatus {
  if (!isRecord(v)) return false
  if (!(v.percentage === null || typeof v.percentage === 'number')) return false
  if (!(v.oscillating === null || typeof v.oscillating === 'boolean')) return false
  if (typeof v.preset !== 'string' || !Array.isArray(v.availablePresets)) return false
  if (!v.availablePresets.every((preset) => typeof preset === 'string')) return false
  if (!(v.direction === null || v.direction === 'forward' || v.direction === 'reverse')) return false
  return v.percentageStep === undefined || typeof v.percentageStep === 'number'
}

// ── status hooks ──────────────────────────────────────────────────────────────

export function useSwitchStatus(deviceId: number, enabled: boolean): UseQueryResult<SwitchStatus | null> {
  return useCapStatus('switch', deviceId, isSwitchStatus, enabled)
}
/** Read the `motion-trigger` cap status: `{ enabled }` — whether the accessory
 *  auto-activates on the parent camera's motion. tRPC router key is camelCase
 *  `motionTrigger`. */
export function useMotionTriggerStatus(deviceId: number, enabled: boolean): UseQueryResult<MotionTriggerStatus | null> {
  return useCapStatus('motionTrigger', deviceId, isMotionTriggerStatus, enabled)
}
export function useBrightnessStatus(deviceId: number, enabled: boolean): UseQueryResult<BrightnessStatus | null> {
  return useCapStatus('brightness', deviceId, isBrightnessStatus, enabled)
}
export function useLockStatus(deviceId: number, enabled: boolean): UseQueryResult<LockStatus | null> {
  return useCapStatus('lockControl', deviceId, isLockStatus, enabled)
}
export function useCoverStatus(deviceId: number, enabled: boolean): UseQueryResult<CoverStatus | null> {
  return useCapStatus('cover', deviceId, isCoverStatus, enabled)
}
export function useAlarmStatus(deviceId: number, enabled: boolean): UseQueryResult<AlarmStatus | null> {
  return useCapStatus('alarmPanel', deviceId, isAlarmStatus, enabled)
}
/** Read the `climate-control` cap status (thermostat / A-C). Router key is
 *  camelCase `climateControl`. */
export function useClimateStatus(deviceId: number, enabled: boolean): UseQueryResult<ClimateStatus | null> {
  return useCapStatus('climateControl', deviceId, isClimateStatus, enabled)
}
/** Read the `fan-control` cap status (speed / oscillation). On/off is read
 *  separately via the fan's `switch` cap. Router key is camelCase `fanControl`. */
export function useFanStatus(deviceId: number, enabled: boolean): UseQueryResult<FanStatus | null> {
  return useCapStatus('fanControl', deviceId, isFanStatus, enabled)
}

/** A sensor cap → its `(capKey, field, kind, unit)` mapping for the read-only
 *  value row. Kebab cap name is the lookup key the registry resolves. */
interface SensorMapping {
  readonly capKey: string
  readonly field: string
  readonly fallbackUnit?: string
}
const SENSOR_MAP: Readonly<Record<string, SensorMapping>> = {
  'temperature-sensor': { capKey: 'temperatureSensor', field: 'celsius', fallbackUnit: '°C' },
  'humidity-sensor': { capKey: 'humiditySensor', field: 'percent', fallbackUnit: '%' },
  'ambient-light-sensor': { capKey: 'ambientLightSensor', field: 'lux', fallbackUnit: 'lx' },
  'numeric-sensor': { capKey: 'numericSensor', field: 'value' },
}

/** Read-only value for a sensor `feature`. Maps the typed numeric sensors and
 *  the enum sensor onto the unified `SensorValue`. Returns null when the
 *  feature isn't a known sensor. */
export function useSensorValue(feature: string, deviceId: number, enabled: boolean): UseQueryResult<SensorValue | null> {
  const numeric = SENSOR_MAP[feature]
  const isEnum = feature === 'enum-sensor'
  const guard = useCallback(
    (v: unknown): v is SensorValue => {
      if (isEnum) return isRecord(v) && typeof v.value === 'string'
      if (numeric) return isRecord(v) && typeof v[numeric.field] === 'number'
      return false
    },
    [isEnum, numeric],
  )
  // Resolve to the unified SensorValue inside the query via a wrapper guard;
  // useCapStatus narrows to the raw record, then this maps it.
  const capKey = isEnum ? 'enumSensor' : numeric?.capKey ?? ''
  const query = useCapStatus<Record<string, unknown>>(
    capKey,
    deviceId,
    (v): v is Record<string, unknown> => guard(v),
    enabled && capKey.length > 0,
  )
  const raw = query.data
  const mapped: SensorValue | null = raw
    ? isEnum
      ? { kind: 'enum', value: String(raw.value) }
      : {
          kind: 'number',
          value: Number(raw[numeric!.field]),
          unit: typeof raw.unit === 'string' ? raw.unit : numeric!.fallbackUnit,
          precision: typeof raw.precision === 'number' ? raw.precision : undefined,
        }
    : null
  return { ...query, data: mapped } as UseQueryResult<SensorValue | null>
}

// ── mutation runner ───────────────────────────────────────────────────────────

/** A cap mutation invoker bound to the live tRPC client. Resolves the router by
 *  camelCase key and calls `<method>.mutate(args)`. */
export interface CapMutator {
  /** True while a mutation is in-flight — controls disable themselves. */
  readonly pending: boolean
  /**
   * Why the LAST call did not happen, as text a person can read — the hub's
   * refusal verbatim, the app's own failures translated. Null after a call
   * that went through, and while one is in flight.
   */
  readonly error: string | null
  /** Invoke `<capKey>.<method>.mutate({ deviceId, ...args })`. Never rethrows:
   *  a failure lands in `error`; the caller refetches status either way. */
  readonly run: (capKey: string, method: string, args: Record<string, unknown>) => Promise<void>
}

/** The hub has no such router / method — the call was never sent. */
function capUnsupportedError(capKey: string, method: string): NcLocalizedError {
  return new NcLocalizedError('v2.accessories.unsupported', `${capKey}.${method} is not available on this hub`)
}

/**
 * Shared mutation runner for accessory controls. Disables the control while a
 * call is in-flight and surfaces a `pending` flag. The control's status hook
 * refetches after `run` resolves.
 *
 * A failure used to be swallowed ("best-effort"), so a panel that REFUSED to
 * arm looked exactly like a press that did nothing. It is kept now, as text.
 */
export function useCapMutator(deviceId: number): CapMutator {
  const { controller } = useConnection()
  const errorText = useNcErrorText()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = useCallback(
    async (capKey: string, method: string, args: Record<string, unknown>): Promise<void> => {
      setError(null)
      const system = controller.getSystem()
      if (!system) {
        setError(errorText(ncNotConnectedError()))
        return
      }
      const router = (system.trpcClient as Record<string, unknown>)[capKey]
      const fn = resolveMutate(router, method)
      if (!fn) {
        setError(errorText(capUnsupportedError(capKey, method)))
        return
      }
      setPending(true)
      try {
        await fn({ deviceId, ...args })
      } catch (err: unknown) {
        setError(errorText(err instanceof Error ? err : new Error(String(err))))
      } finally {
        setPending(false)
      }
    },
    [controller, deviceId, errorText],
  )
  return { pending, error, run }
}

/** True when a value is a navigable node: a plain object OR a tRPC v11 client
 *  proxy node (a callable `Proxy(noop)` → `typeof === 'function'`, NOT an
 *  object). The old `typeof === 'object'`-only check REJECTED every real client
 *  proxy, so `resolveMutate` returned null and EVERY control was a silent
 *  no-op (siren/switch/lock/… never called the cap). */
function isNode(value: unknown): value is Record<string, unknown> {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
}

/** Resolve `router.<method>.mutate` to a callable, or null. */
export function resolveMutate(
  router: unknown,
  method: string,
): ((input: Record<string, unknown>) => Promise<unknown>) | null {
  if (!isNode(router)) return null
  const proc = router[method]
  if (!isNode(proc)) return null
  const mutate = proc.mutate
  return typeof mutate === 'function'
    ? (mutate as (input: Record<string, unknown>) => Promise<unknown>)
    : null
}
