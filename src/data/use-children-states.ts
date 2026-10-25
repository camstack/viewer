/**
 * useCameraChildrenStates — per-device state of a camera's child accessories
 * for the cameras-list card. Instead of a category roll-up, it returns ONE
 * entry per child carrying its kind (for icon selection), its on/off state, and
 * its motion-trigger counterpart (if any) — so the card shows an icon per
 * device, plus a separate motion icon for on-motion children.
 *
 * One React Query per camera: it pulls the children via
 * `deviceManager.getChildren`, then for each controllable child reads the
 * relevant cap status DIRECTLY through the tRPC client (not via the per-cap
 * hooks — those can't run in a loop). Cached + periodically refetched;
 * gracefully omits children with no readable status.
 *
 * ## Cancellation
 *
 * This is the widest fan-out in the app — 1 + 2N calls per camera on ONE tRPC
 * WebSocket — and it used to ignore React Query's abort signal entirely. When
 * the invalidation bridge abandoned a refetch and started another, the
 * abandoned fan-out kept issuing calls and kept the socket busy. The signal is
 * now both PASSED to every call and CHECKED between them; see
 * {@link CapQueryOptions} for which of those two actually bites on `wsLink`.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { useConnection } from '../connection/ConnectionProvider.js'
import { RECONCILE_MS } from './reconcile.js'

/** Visual kind of a child accessory — drives the icon shown on the card. */
export type ChildDeviceKind = 'light' | 'switch' | 'siren' | 'other'

/** Per-child state for the card: an on/off output and/or a motion-trigger. A
 *  single child can be BOTH (e.g. a light that's also an on-motion switch) — it
 *  then renders two icons (the kind icon + a motion icon). */
export interface ChildDeviceState {
  readonly id: number
  readonly name: string
  readonly kind: ChildDeviceKind
  /** Exposes an on/off output (the `switch` cap). */
  readonly hasSwitch: boolean
  /** Current on/off state (false when `hasSwitch` is false). */
  readonly on: boolean
  /** Has the `motion-trigger` cap (on-motion switch). */
  readonly hasMotion: boolean
  /** Motion trigger currently armed (false when `hasMotion` is false). */
  readonly motionOn: boolean
}

/** Per-device child states, ordered as returned by the hub. */
export type CameraChildrenStates = readonly ChildDeviceState[]

const EMPTY: CameraChildrenStates = []


/** Map a hub device `type` to a visual kind for icon selection. */
function toKind(type: unknown): ChildDeviceKind {
  if (type === 'light') return 'light'
  if (type === 'siren') return 'siren'
  if (type === 'switch') return 'switch'
  return 'other'
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

/**
 * The subset of tRPC v11's `TRPCRequestOptions` this file passes.
 *
 * ⚠️ Honoured by `httpLink` (it forwards `op.signal` to `fetch`), NOT by
 * `wsLink` — which is what the app actually runs (`@camstack/sdk` builds one
 * `wsLink` over a single socket). Passing it is correct and free, but it is
 * NOT the mechanism that stops the work here: {@link throwIfAborted} is. Do not
 * read this argument as "cancellation is handled".
 */
export interface CapQueryOptions {
  readonly signal?: AbortSignal
}

/** A cancelled query is an ERROR, never a result. */
export class ChildrenStatesAbortedError extends Error {
  constructor() {
    super('children-states query aborted')
    this.name = 'ChildrenStatesAbortedError'
  }
}

/**
 * Bail out of the fan-out the moment React Query has abandoned this query.
 *
 * Rejecting matters as much as stopping: every call below swallows errors to
 * `null`/`EMPTY` so one unreadable accessory cannot blank the card. Without
 * this the abort would look exactly like "the hub answered nothing", and a
 * DEGRADED result would be written into the cache as if it were the truth.
 */
function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw new ChildrenStatesAbortedError()
}

/** Read a child cap's `getStatus({ deviceId })` defensively (null on any error). */
async function readStatus(
  client: Record<string, unknown>,
  capKey: string,
  deviceId: number,
  signal: AbortSignal | undefined,
): Promise<Record<string, unknown> | null> {
  throwIfAborted(signal)
  const router = client[capKey]
  if (!isRecord(router)) return null
  const status = (router as { getStatus?: unknown }).getStatus
  if (!isRecord(status) || typeof (status as { query?: unknown }).query !== 'function') return null
  try {
    const raw = await (
      status as {
        query: (i: { deviceId: number }, opts?: CapQueryOptions) => Promise<unknown>
      }
    ).query({ deviceId }, { signal })
    return isRecord(raw) ? raw : null
  } catch {
    // An abort must not be laundered into "no status" by this catch.
    throwIfAborted(signal)
    return null
  }
}

/**
 * The whole query body, extracted from the hook so it can be exercised without
 * a renderer (same shape as `resolveLinkedDevicesData` in `use-linked-devices`).
 *
 * @param client   tRPC proxy client cast as Record.
 * @param cameraId Parent device whose children are read.
 * @param signal   React Query's abort signal. Threaded into every call AND
 *                 checked between them — see {@link throwIfAborted}.
 */
export async function resolveChildrenStates(
  client: Record<string, unknown>,
  cameraId: number,
  signal: AbortSignal | undefined,
): Promise<CameraChildrenStates> {
  let children: unknown
  try {
    children = await (
      client.deviceManager as {
        getChildren: {
          query: (i: { parentDeviceId: number }, opts?: CapQueryOptions) => Promise<unknown>
        }
      }
    ).getChildren.query({ parentDeviceId: cameraId }, { signal })
  } catch {
    throwIfAborted(signal)
    return EMPTY
  }
  // The expensive half starts here: one `getStatus` per controllable child, all
  // of them queued on the SAME tRPC WebSocket. An invalidation storm used to
  // abandon this query and immediately start another while THIS fan-out carried
  // on occupying the socket — which is how an unrelated 50 ms call measured
  // 6000 ms. Check before paying for it.
  throwIfAborted(signal)
  const list = Array.isArray(children) ? children.filter(isRecord) : []

  const entries = await Promise.all(
    list.map(async (child): Promise<ChildDeviceState | null> => {
      const id = child.id
      if (typeof id !== 'number') return null
      const type = child.type
      const name = typeof child.name === 'string' ? child.name : `#${id}`
      const features = Array.isArray(child.features) ? child.features : []

      const hasSwitch = type === 'switch' || type === 'light' || type === 'siren'
      const hasMotion = features.includes('motion-trigger')
      // A child we can't represent (neither an output nor a motion trigger)
      // is dropped — the card only shows actionable accessory state.
      if (!hasSwitch && !hasMotion) return null

      let on = false
      if (hasSwitch) {
        const sw = await readStatus(client, 'switch', id, signal)
        on = sw?.on === true
      }
      let motionOn = false
      if (hasMotion) {
        const mt = await readStatus(client, 'motionTrigger', id, signal)
        motionOn = mt?.enabled === true
      }

      return { id, name, kind: toKind(type), hasSwitch, on, hasMotion, motionOn }
    }),
  )

  return entries.filter((e): e is ChildDeviceState => e !== null)
}

/** Per-device child states for `cameraId`. */
export function useCameraChildrenStates(
  cameraId: number,
  enabled: boolean,
): UseQueryResult<CameraChildrenStates> {
  const { controller, state } = useConnection()
  return useQuery<CameraChildrenStates>({
    queryKey: ['v2', 'children-states', cameraId],
    enabled: enabled && state === 'connected',
    // Paired with the interval on purpose: without it the global 5s
    // default makes this stale long before its own cadence, so every
    // remount refetches and the reconcile design does nothing.
    staleTime: RECONCILE_MS,
    refetchInterval: RECONCILE_MS,
    queryFn: async ({ signal }) => {
      const system = controller.getSystem()
      if (!system) return EMPTY
      return resolveChildrenStates(system.trpcClient as Record<string, unknown>, cameraId, signal)
    },
  })
}
