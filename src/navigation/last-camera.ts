/**
 * last-camera — "reopen the camera I was watching", as two pure rules.
 *
 * ## The semantics, in the operator's words
 *
 * *«Si salva quando si va sullo stream singolo, e si pulisce quando si cambia
 * pagina.»* So the remembered camera survives only if watching it was the LAST
 * thing that happened: open a camera, kill the app, next launch reopens it; open
 * a camera, go to the Library, kill the app, next launch is the normal one.
 * {@link lastCameraEffectFor} is that sentence and nothing more — every path
 * that is not a single stream CLEARS.
 *
 * ## Why the launch reads a frozen value and not the live one
 *
 * The two halves race, and the race is not subtle: at launch the app lands on
 * `/cameras`, which is a "changed page" and would clear the memory before
 * anything had a chance to read it. So the store keeps two different facts —
 * the camera the app STARTED with (read once at hydrate, never rewritten) and
 * the one the current navigation is writing — and {@link resolveReopenLastCamera}
 * is given the first. See `store/last-camera-store.ts`.
 *
 * ## Why the decision has a `wait` and not just a boolean
 *
 * The two failure modes the operator named — a camera that no longer exists and
 * one that has been disabled — can only be told apart from a camera list that
 * has ANSWERED. An unanswered query and an empty one are not the same thing
 * (`(data ?? [])` is precisely how they get confused), so `cameras: undefined`
 * yields `wait`, never `skip`. A launch that degrades to the normal one because
 * the hub was a beat slow would look exactly like the setting not working.
 *
 * Pure — no React, no storage. The bridge that runs it is
 * `navigation/LastCameraBridge.tsx`.
 */

/** AsyncStorage key for the remembered camera. */
export const LAST_CAMERA_STORAGE_KEY = '@camstack/v2/last-camera'

/** What a navigation does to the remembered camera. */
export type LastCameraEffect =
  | { readonly kind: 'remember'; readonly deviceId: number }
  /**
   * Leave it alone. Navigating AWAY from a camera — to Grids, to Settings —
   * is not the operator saying they are done with it, and treating it as such
   * is what made "press Cameras and come back to where I was" impossible: the
   * value was gone before the second press.
   */
  | { readonly kind: 'keep' }
  | { readonly kind: 'clear' }

/** The single-stream route, and the only shape that is remembered. */
const CAMERA_ROUTE = /^\/camera\/(\d+)$/

/**
 * Remember a single stream, clear anything else.
 *
 * A non-numeric id is a route this app never produces, so it clears rather than
 * remembering something the launch could not open.
 */
export function lastCameraEffectFor(pathname: string): LastCameraEffect {
  const match = CAMERA_ROUTE.exec(pathname)
  if (match === null) {
    // A path that LOOKS like a camera but does not parse (`/camera/abc`,
    // `/camera/1/edit`) still clears: remembering an id the launch cannot open
    // is worse than remembering nothing — it spends the whole startup budget
    // to arrive at `camera-gone`.
    //
    // Any OTHER page keeps. Clearing is a deliberate gesture now — backing
    // out, or pressing Cameras while already on a camera — never a side effect
    // of going somewhere else, which is what made returning to the camera you
    // never closed impossible. See `LastCameraEffect.keep`.
    return pathname === '/camera' || pathname.startsWith('/camera/')
      ? { kind: 'clear' }
      : { kind: 'keep' }
  }
  const deviceId = Number(match[1])
  return Number.isSafeInteger(deviceId) && deviceId > 0
    ? { kind: 'remember', deviceId }
    : { kind: 'clear' }
}

/** The route for a device id — one spelling, shared by the bridge and its tests. */
export function cameraRoute(deviceId: number): string {
  return `/camera/${deviceId}`
}

/**
 * Where a launch that has NOT been redirected sits. Anything else means the
 * operator (or a deep link) already went somewhere, and the reopen must not
 * pull them off it.
 */
const LANDING_ROUTES: ReadonlySet<string> = new Set(['', '/', '/cameras'])

export interface ReopenCandidate {
  readonly id: number
  /** Operator soft-disabled. A disabled camera has no stream to reopen. */
  readonly disabled: boolean
}

/** Why the launch stayed where it was. Every branch names itself so the log
 *  line says which one happened — a reopen that silently did nothing is the
 *  hardest kind of report to answer. */
export type ReopenSkipReason =
  | 'setting-off'
  | 'nothing-remembered'
  | 'left-the-landing-route'
  | 'camera-gone'
  | 'camera-disabled'

export type ReopenDecision =
  | { readonly action: 'reopen'; readonly deviceId: number }
  /** Not enough is known yet. Ask again on the next render. */
  | { readonly action: 'wait' }
  | { readonly action: 'skip'; readonly reason: ReopenSkipReason }

export interface ReopenLastCameraInput {
  /** `settings.stream.reopenLastCamera`. */
  readonly enabled: boolean
  /** Settings are only meaningful once hydrated — before that they are DEFAULTS
   *  (i.e. OFF), which is indistinguishable from the operator's choice. */
  readonly settingsHydrated: boolean
  /** Same for the remembered camera. */
  readonly memoryHydrated: boolean
  /** The camera the app STARTED with; `null` when nothing was remembered. */
  readonly startupDeviceId: number | null
  /** `undefined` until the camera list has ANSWERED — never `[]` for "unknown". */
  readonly cameras: readonly ReopenCandidate[] | undefined
  /** `usePathname()`. */
  readonly pathname: string
}

/**
 * Should this launch open a camera, and which?
 *
 * The cheap questions come first on purpose: with the setting off, or with
 * nothing remembered, this answers without ever caring whether the camera list
 * arrived — the overwhelmingly common case does no waiting at all.
 *
 * This function has NO memory of having been asked. "At most once per launch"
 * belongs to the caller, which is the only place that can enforce it without
 * reading mutable state during a render — see `LastCameraBridge.tsx`.
 */
export function resolveReopenLastCamera({
  enabled,
  settingsHydrated,
  memoryHydrated,
  startupDeviceId,
  cameras,
  pathname,
}: ReopenLastCameraInput): ReopenDecision {
  if (!settingsHydrated || !memoryHydrated) return { action: 'wait' }
  if (!enabled) return { action: 'skip', reason: 'setting-off' }
  if (startupDeviceId === null) return { action: 'skip', reason: 'nothing-remembered' }
  // A deep link (a notification tap) has already chosen a destination, and it
  // outranks a remembered one — see `pending-deep-link.ts`, which resolves
  // before this ever runs.
  if (!LANDING_ROUTES.has(pathname)) return { action: 'skip', reason: 'left-the-landing-route' }
  if (cameras === undefined) return { action: 'wait' }
  const camera = cameras.find((c) => c.id === startupDeviceId)
  if (camera === undefined) return { action: 'skip', reason: 'camera-gone' }
  if (camera.disabled) return { action: 'skip', reason: 'camera-disabled' }
  return { action: 'reopen', deviceId: startupDeviceId }
}
