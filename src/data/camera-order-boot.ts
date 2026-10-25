/**
 * camera-order-boot — the saved camera arrangement, readable before the
 * server-scope bind.
 *
 * The cameras list cache paints from the hub URL as soon as it is known.
 * Camera prefs used to wait on `whenServerScoped()`, and that bind waits for
 * the one-time storage moves and a grids reload. The grid therefore rendered
 * in server order and jumped when the document arrived.
 *
 * This read starts from the active server id (known as soon as the saved
 * session is) and does not wait for that bind. The store's own hydrate still
 * wins once it has run, so an account sync can reconcile afterwards.
 */
import AsyncStorage from '@react-native-async-storage/async-storage'
import { log } from '../lib/logger.js'
import {
  CAMERA_PREFS_STORAGE_KEY,
  parseCameraPrefs,
  resetCameraPrefsEntry,
  type AppCameraPrefs,
} from '../store/camera-prefs-store.js'
import { scopedStorageKey } from '../store/server-scope.js'

export type CameraOrderBootPhase = 'idle' | 'loading' | 'ready'

export interface CameraOrderBootState {
  readonly phase: CameraOrderBootPhase
  readonly serverId: string | null
  readonly prefs: AppCameraPrefs
}

export interface CameraPrefsForPaint {
  readonly ready: boolean
  readonly prefs: AppCameraPrefs
}

type PrefsReader = (key: string) => Promise<string | null>

const listeners = new Set<() => void>()
let state: CameraOrderBootState = {
  phase: 'idle',
  serverId: null,
  prefs: resetCameraPrefsEntry(),
}
let generation = 0

function emit(): void {
  for (const listener of listeners) listener()
}

export function cameraOrderBootSnapshot(): CameraOrderBootState {
  return state
}

export function subscribeCameraOrderBoot(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Tests only — a process has one boot. */
export function resetCameraOrderBoot(): void {
  generation += 1
  state = { phase: 'idle', serverId: null, prefs: resetCameraPrefsEntry() }
  emit()
}

/** True when the document carries an arrangement worth painting. */
export function cameraPrefsHasArrangement(prefs: AppCameraPrefs): boolean {
  return prefs.order.length > 0 || Object.keys(prefs.byId).length > 0
}

/**
 * The prefs the grid should paint.
 *
 * A boot read in flight withholds the list: an empty order is not yet an
 * answer. Once the store has hydrated, it is the authority (account sync
 * included). Idle — nothing started a read — keeps the previous behaviour so
 * a test that never mounts the boot does not stall.
 */
export function cameraPrefsForPaint(input: {
  readonly hydrated: boolean
  readonly prefs: AppCameraPrefs
  readonly boot: CameraOrderBootState
}): CameraPrefsForPaint {
  if (input.hydrated) return { ready: true, prefs: input.prefs }
  if (input.boot.phase === 'loading') return { ready: false, prefs: input.prefs }
  if (input.boot.phase === 'ready') return { ready: true, prefs: input.boot.prefs }
  return { ready: true, prefs: input.prefs }
}

/** Per-hub document, else the unscoped copy a migration has not moved yet. */
export async function readBootCameraPrefs(read: PrefsReader, serverId: string): Promise<AppCameraPrefs> {
  const scoped = parseCameraPrefs(await read(scopedStorageKey(CAMERA_PREFS_STORAGE_KEY, serverId)))
  if (cameraPrefsHasArrangement(scoped)) return scoped
  const legacy = parseCameraPrefs(await read(CAMERA_PREFS_STORAGE_KEY))
  if (cameraPrefsHasArrangement(legacy)) return legacy
  return scoped
}

const readStorage: PrefsReader = (key) => AsyncStorage.getItem(key)

/**
 * Start the disk read for `serverId`. Idempotent per id.
 *
 * Synchronous up to `phase: 'loading'` and silent about it: the caller is
 * mid-render, and children read the snapshot in the same commit. The settle
 * notifies.
 */
export function ensureCameraOrderBoot(serverId: string, read: PrefsReader = readStorage): void {
  if (state.serverId === serverId && (state.phase === 'loading' || state.phase === 'ready')) return
  const ticket = generation + 1
  generation = ticket
  state = { phase: 'loading', serverId, prefs: resetCameraPrefsEntry() }
  void readBootCameraPrefs(read, serverId)
    .then((prefs) => {
      if (generation !== ticket) return
      state = { phase: 'ready', serverId, prefs }
      emit()
    })
    .catch((err: unknown) => {
      if (generation !== ticket) return
      log.warn('cameras', 'camera order boot read failed', err)
      state = { phase: 'ready', serverId, prefs: resetCameraPrefsEntry() }
      emit()
    })
}
