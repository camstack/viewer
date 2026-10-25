import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import type { DeviceInfo } from '@camstack/sdk'
import { useConnection } from '../connection/ConnectionProvider.js'
import { hydrateCameraList, writeCameraListCache } from './camera-list-cache.js'
import { useCameraPrefs } from './use-camera-prefs.js'
import { applySavedOrder } from './device-order.js'
import {
  cameraOrderBootSnapshot,
  cameraPrefsForPaint,
  subscribeCameraOrderBoot,
} from './camera-order-boot.js'
import type { AppCameraPrefs } from '../store/camera-prefs-store.js'
import { RECONCILE_MS } from './reconcile.js'
import { markBoot } from '../connection/boot-timeline.js'
import { withQueryDeadline } from './query-deadline.js'

/** Device-feature flag strings carried in `DeviceInfo.features`. These mirror
 *  the kebab-case VALUES of the server-side `DeviceFeature` enum
 *  (`packages/types/src/device/device-type.ts`) — NOT the enum keys. The SDK
 *  does not re-export the enum, so we pin the literals the card gates on here. */
export const FEATURE = {
  battery: 'battery-operated',
  ptz: 'pan-tilt-zoom',
  twoWayAudio: 'two-way-audio',
  doorbell: 'doorbell-button',
} as const

/** Flattened camera fields the UI needs. */
export interface CameraInfo {
  readonly id: number
  /** Display name. Local rename override when set, else the server name. */
  readonly name: string
  readonly type: string
  readonly online: boolean
  /** Operator soft-disabled flag (device-manager `DeviceInfo.disabled`). Drives
   *  the card/player status dot's top-priority "disabled" (black) state. */
  readonly disabled: boolean
  /** Device feature flags (e.g. `'battery-operated'`, `'pan-tilt-zoom'`),
   *  used by the card to gate the battery badge / sleeping overlay / hints. */
  readonly features: readonly string[]
  /** The server-provided name, kept even when `name` is locally overridden.
   *  Lets the management UI show the original under a renamed camera. */
  readonly originalName: string
  /** True when the camera is locally hidden. Only surfaced when hidden cameras
   *  are explicitly included (management UI); the default list excludes them. */
  readonly hidden: boolean
  /**
   * The operator's location label for this camera, or `null` when unset.
   *
   * NULL IS A FACT, not an empty string: "this camera has no location" and
   * "its location is the empty label" would group differently in the picker,
   * and only one of them is true.
   */
  readonly location: string | null
}

function toCamera(d: DeviceInfo): CameraInfo {
  const serverName = d.name?.trim() || `Camera #${d.id}`
  return {
    id: d.id,
    name: serverName,
    type: d.type,
    online: d.online,
    disabled: d.disabled,
    features: d.features ?? [],
    originalName: serverName,
    hidden: false,
    location: d.location?.trim() ? d.location.trim() : null,
  }
}

/** Apply local camera prefs to the raw server list (pure transform):
 *   • override the display `name` with `localName` when set,
 *   • stamp the `hidden` flag,
 *   • sort by the custom `order` — `applySavedOrder` owns that rule and what it
 *     does when the device set has moved under a saved arrangement,
 *   • EXCLUDE hidden cameras unless `includeHidden` is set.
 *  Order/name overrides do not mutate the input array. */
export function applyCameraPrefs(
  cameras: readonly CameraInfo[],
  prefs: AppCameraPrefs,
  includeHidden: boolean,
): CameraInfo[] {
  const mapped = cameras.map((c) => {
    const pref = prefs.byId[c.id]
    return {
      ...c,
      name: pref?.localName ?? c.originalName,
      hidden: pref?.hidden === true,
    }
  })

  const visible = includeHidden ? mapped : mapped.filter((c) => !c.hidden)

  return applySavedOrder(visible, prefs.order)
}

/** Options for {@link useCameras}. */
export interface UseCamerasOptions {
  /** Include cameras the user has locally hidden (management UI). Default false. */
  readonly includeHidden?: boolean
}

/** Raw server camera query. Queries `deviceManager.listAll` directly through the
 *  authenticated tRPC client (authoritative) and filters to cameras. This
 *  deliberately bypasses the SDK `SystemMirror` warm-boot snapshot, whose
 *  one-shot `init()` can cache an empty set if it runs before the transport is
 *  fully ready (the cause of the empty list). React Query caches + refetches.
 *  Prefs are applied as a client-side transform on top of this — the query
 *  itself stays pref-agnostic so its cache is shared across all consumers. */
function useCamerasQuery(): UseQueryResult<CameraInfo[]> {
  const { controller, state } = useConnection()
  const queryClient = useQueryClient()
  // Read from the controller rather than the server context: this module is
  // imported by pure data tests, and pulling a provider .tsx in drags
  // react-native's flow-typed entry into an environment that cannot parse it.
  //
  // The CONFIGURED url, not `getSystem()?.serverUrl`. Two bugs came out of the
  // live route being used to identify the hub:
  //
  //  1. `getSystem()` is null until `connect()` has run, and `connect()` is
  //     called from an effect in `ConnectionProvider` — a PARENT. Child effects
  //     run first, so on the first commit this read was `''` and the hydration
  //     below returned immediately. It was re-armed only when something else
  //     re-rendered the screen (the camera-prefs or settings store finishing
  //     its own AsyncStorage read), which is to say: the cold-launch paint this
  //     cache exists for depended on an unrelated store's timing.
  //  2. The route MOVES. The endpoint race pivots the transport onto the LAN IP
  //     at home and back to the public URL on mobile data, so the same hub wrote
  //     its list under one key and looked for it under another — a guaranteed
  //     miss on every network change.
  const hubUrl = controller.configuredServerUrl

  // Paint the last known camera list while the hub is still being reached.
  // This query is the HEAD of the cameras-tab waterfall — cards, badges,
  // tracks and event kinds all wait behind it — so on a cold launch every one
  // of them waited for a connection handshake plus a round-trip. The stored
  // copy is a hint, never authority: the query below runs regardless and
  // overwrites it, and the hydrator refuses to touch a cache the live query
  // has already filled.
  useEffect(() => {
    if (hubUrl.length === 0) return
    void (async () => {
      // A HIT is the whole point of this cache and a MISS is the finding: it
      // means this launch paints a skeleton and waits for the network, and
      // whether that was a first launch, a new hub or a key that moved is not
      // guessable after the fact.
      const painted = await hydrateCameraList(queryClient, hubUrl)
      if (painted) markBoot('camerasFromCache')
    })()
  }, [queryClient, hubUrl])

  return useQuery<CameraInfo[]>({
    queryKey: ['v2', 'cameras'],
    enabled: state === 'connected',
    refetchInterval: RECONCILE_MS,
    // Reconcile when the operator comes BACK, not only on the interval. The
    // app-wide default is off (RN has no window focus), but `focusManager` is
    // now driven from `AppState` (`app/query-focus.ts`), so this is a real
    // signal on both native and the PWA — and returning to the app is exactly
    // when a stale device list is most visible. Nine cameras deleted on the hub
    // stayed on this screen until a manual pull-to-refresh, because the
    // interval is parked while unfocused and nothing fired on return.
    refetchOnWindowFocus: true,
    // Match the interval. Without it the query inherits the global 5 s
    // staleTime, so EVERY consumer that mounts — the detail screen's
    // `useCameraMeta`, the reel's name resolver, the switcher — fires an extra
    // `listAll` on top of the interval that is already running. Opening a
    // camera should not cost a device-list round-trip.
    staleTime: RECONCILE_MS,
    queryFn: async () => {
      const system = controller.getSystem()
      if (!system) return []
      // Filtered and projected SERVER-side. The full listing is 293 devices /
      // 271 KB, of which `config` alone is 113 KB — and it carries camera
      // credentials to the browser. `toCamera` reads 7 fields, ~1.8 KB.
      // Bounded: `listAll` is hub-LOCAL and cannot itself wait on a node, but
      // an unbounded await is what turned every other stalled call into a
      // permanent skeleton, and the camera list is the query the whole app
      // chains behind. A deadline here means a sick hub costs a retry and the
      // CACHED list (painted above), not a dead app.
      const all = await withQueryDeadline(
        system.trpcClient.deviceManager.listAll.query({
          isCamera: true,
          projection: 'slim',
        }),
        'deviceManager.listAll',
      )
      // The client-side filter STAYS. A hub that predates the `isCamera` input
      // silently ignores it — Zod strips unknown keys rather than rejecting
      // them — and would hand back all 293 devices for the camera list. This
      // makes the change safe to ship in either order.
      const cameras = all.filter((d) => d.isCamera).map(toCamera)
      // Persist for the NEXT cold launch. Best-effort and not awaited — the
      // screen must never wait on a cache write.
      if (hubUrl.length > 0) void writeCameraListCache(hubUrl, cameras)
      markBoot('camerasLive', { count: cameras.length })
      return cameras
    },
  })
}

/** Live camera list with local prefs applied: rename overrides, custom order,
 *  and hidden cameras excluded by default. Pass `{ includeHidden: true }` to get
 *  the full set (management UI). The underlying react-query cache is shared with
 *  every other consumer; prefs are a memoised client-side transform. */
export function useCameras(options: UseCamerasOptions = {}): UseQueryResult<CameraInfo[]> {
  const includeHidden = options.includeHidden === true
  const query = useCamerasQuery()
  const { prefs, hydrated } = useCameraPrefs()
  const boot = useSyncExternalStore(
    subscribeCameraOrderBoot,
    cameraOrderBootSnapshot,
    cameraOrderBootSnapshot,
  )
  // Empty order is not an answer while the disk read is in flight: painting
  // then would be the unordered flash. The hydrated store reconciles later.
  const paint = cameraPrefsForPaint({ hydrated, prefs, boot })

  const data = useMemo(
    () => (paint.ready && query.data ? applyCameraPrefs(query.data, paint.prefs, includeHidden) : undefined),
    [paint.ready, paint.prefs, query.data, includeHidden],
  )
  const held = !paint.ready

  // Re-expose the query result with the transformed data; identity of the other
  // fields is preserved so consumers' loading/error handling is unchanged.
  return useMemo(
    () =>
      ({
        ...query,
        data,
        isLoading: held || query.isLoading,
        isPending: held || query.isPending,
      }) as UseQueryResult<CameraInfo[]>,
    [query, data, held],
  )
}

/** Convenience variant for the management UI: every camera, including hidden. */
export function useAllCameras(): UseQueryResult<CameraInfo[]> {
  return useCameras({ includeHidden: true })
}
