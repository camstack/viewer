/**
 * ondemand-player-store — is the on-demand player open, and where the operator
 * put it (D483).
 *
 * ## Why a store at all
 *
 * The overlay is mounted ONCE, beside the `<Stack>` navigator in
 * `app/(app)/_layout.tsx`, because the operator asked for a player that "non
 * cambia con la navigazione" — it survives a route change with its media
 * session intact. Its entry points are three screens down a different subtree
 * (`EventsScreen`, `CamerasScreen`, `CameraShelf`), so a prop cannot reach it:
 * threading one would mean a callback through `TimelineBodyPanel` →
 * `TimelineClusterPanel` → `ClusterDetailBody` and a second through the reel,
 * with the host still unable to see either.
 *
 * A store is also what keeps the entry points ignorant of the overlay. They
 * call `open({ deviceId, atMs })` and nothing else; the decision to open a
 * player rather than navigate lives in one pure function
 * (`live/ondemand-player.ts`, `resolveSeekRoute`), and neither the store nor
 * the screens carry a copy of it.
 *
 * ## What persists, and what deliberately does not
 *
 * The BOX persists — the size and the position. An operator who drags the
 * player to the left edge and makes it large has expressed a preference about
 * their screen, not about that camera, and being asked again every launch is
 * the kind of small insult the app already avoids elsewhere.
 *
 * `open` does NOT persist, and that is the important half. A restored player
 * would come back pointing at an instant chosen in a session that has ended —
 * a recorded pointer into footage that may have been evicted, opened over a
 * screen the operator did not open it from, with a media session nobody asked
 * for. "On demand" means somebody asked just now.
 *
 * Absent storage means the DEFAULT in both fields: `size: null` is
 * `DEFAULT_ONDEMAND_SIZE` and `position: null` is bottom-right, resolved
 * against the live window every read. Neither default is ever materialised into
 * storage — a stored `'compact'` standing in for "never chosen" would freeze
 * today's default into every install, and a stored coordinate would outlive the
 * window it was measured in.
 */
import { create } from 'zustand'
import { log } from '../lib/logger.js'
import AsyncStorage from '@react-native-async-storage/async-storage'
import {
  DEFAULT_ONDEMAND_SIZE,
  ONDEMAND_SIZES,
  type OnDemandPosition,
  type OnDemandSize,
} from '../live/ondemand-geometry.js'
import { resolveOnDemandOnFocus, type OnDemandRequest } from '../live/ondemand-player.js'

const STORAGE_KEY = 'camstack.v2.ondemand-player'

/** The persisted half: the operator's box. Both fields ABSENT ⇒ the default. */
export interface OnDemandBoxPrefs {
  readonly size: OnDemandSize | null
  readonly position: OnDemandPosition | null
}

export const ONDEMAND_BOX_DEFAULTS: OnDemandBoxPrefs = Object.freeze({
  size: null,
  position: null,
})

function isOnDemandSize(value: unknown): value is OnDemandSize {
  return typeof value === 'string' && ONDEMAND_SIZES.includes(value as OnDemandSize)
}

function isPosition(value: unknown): value is OnDemandPosition {
  if (typeof value !== 'object' || value === null) return false
  const record: Record<string, unknown> = { ...(value as Record<string, unknown>) }
  return Number.isFinite(record['x']) && Number.isFinite(record['y'])
}

/**
 * Parse a stored blob, field by field.
 *
 * Per-field and not all-or-nothing on purpose: a `position` this build does not
 * recognise must not also discard a perfectly good `size`. A storage SHAPE
 * guard that throws away the whole record because one member changed is how a
 * preference silently resets for everybody, and this repo has paid for a value
 * guard that deleted whole documents.
 */
export function parseOnDemandBoxPrefs(raw: unknown): OnDemandBoxPrefs {
  if (typeof raw !== 'object' || raw === null) return ONDEMAND_BOX_DEFAULTS
  const record = raw as Record<string, unknown>
  return {
    size: isOnDemandSize(record['size']) ? record['size'] : null,
    position: isPosition(record['position'])
      ? { x: record['position'].x, y: record['position'].y }
      : null,
  }
}

/** The size to lay out with — the stored one, or the default. */
export function resolveOnDemandSize(prefs: OnDemandBoxPrefs): OnDemandSize {
  return prefs.size ?? DEFAULT_ONDEMAND_SIZE
}

interface OnDemandPlayerState {
  /** The open request, or null. NOT persisted — see the module docblock. */
  readonly request: OnDemandRequest | null
  readonly prefs: OnDemandBoxPrefs
  readonly hydrated: boolean
  hydrate: () => Promise<void>
  /**
   * Open the player, or RETARGET the one already open.
   *
   * One verb for both because they are the same intent — "this camera, this
   * instant" — and because a second verb is how the surface would acquire a
   * state the operator cannot see: an `open` that refused while a player was up
   * would make the reel's cards silently inert, and one that closed and
   * reopened would tear down a media session to move a pointer the session can
   * move itself.
   */
  open: (request: OnDemandRequest) => void
  close: () => void
  /**
   * The operator has ARRIVED on a camera's own screen. Closes the overlay when
   * that camera is the one it is showing, and does nothing otherwise —
   * `resolveOnDemandOnFocus` owns the whole decision.
   */
  focusCamera: (deviceId: number) => void
  setSize: (size: OnDemandSize) => void
  setPosition: (position: OnDemandPosition) => void
}

function persist(prefs: OnDemandBoxPrefs): void {
  void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(prefs)).catch(() => {})
}

export const useOnDemandPlayerStore = create<OnDemandPlayerState>((set, get) => ({
  request: null,
  prefs: ONDEMAND_BOX_DEFAULTS,
  hydrated: false,
  hydrate: async () => {
    if (get().hydrated) return
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY)
      set({
        prefs: raw ? parseOnDemandBoxPrefs(JSON.parse(raw)) : ONDEMAND_BOX_DEFAULTS,
        hydrated: true,
      })
    } catch {
      set({ prefs: ONDEMAND_BOX_DEFAULTS, hydrated: true })
    }
  },
  open: (request) => set({ request }),
  close: () => set({ request: null }),
  focusCamera: (deviceId) => {
    const request = get().request
    const kept = resolveOnDemandOnFocus(request, deviceId)
    if (kept === request) return
    log.info('ondemand', 'closing: its camera was opened full-screen', {
      tags: { deviceId },
    })
    set({ request: kept })
  },
  setSize: (size) => {
    const prefs: OnDemandBoxPrefs = { ...get().prefs, size }
    set({ prefs })
    persist(prefs)
  },
  setPosition: (position) => {
    const prefs: OnDemandBoxPrefs = { ...get().prefs, position }
    set({ prefs })
    persist(prefs)
  },
}))

/**
 * Open the on-demand player from anywhere, without subscribing to it.
 *
 * The entry points are press handlers: they need the ACTION and never the
 * state, and a component that read the store to get it would re-render on every
 * drag of the panel. The same discipline `CameraShelf`'s cards already use for
 * `useWorkspaceStore((s) => s.add)`, taken one step further because these call
 * sites are not components at all.
 */
export function openOnDemandPlayer(request: OnDemandRequest): void {
  useOnDemandPlayerStore.getState().open(request)
}

/**
 * Tell the overlay a camera's own screen is now on show.
 *
 * Same discipline as `openOnDemandPlayer`: the caller is a screen effect that
 * needs the ACTION and never the state, and subscribing to the store to get it
 * would re-render that screen on every drag of the panel.
 */
export function focusOnDemandCamera(deviceId: number): void {
  useOnDemandPlayerStore.getState().focusCamera(deviceId)
}
