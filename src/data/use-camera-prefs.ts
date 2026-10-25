import { useEffect } from 'react'
import {
  cameraClipProvider,
  cameraRecordingProvider,
  useCameraPrefsStore,
  type AppCameraPrefs,
} from '../store/camera-prefs-store.js'

/** Stable, feature-facing API over the camera-prefs store. The cameras list +
 *  management UI consume `prefs`; the management UI drives the setters.
 *  Hydration is triggered lazily on first mount and is idempotent. */
export interface UseCameraPrefs {
  /** The current, fully-populated camera-prefs document. */
  readonly prefs: AppCameraPrefs
  /** True once persisted prefs have loaded. */
  readonly hydrated: boolean
  /** Set (or clear, when empty) a camera's local display name. */
  readonly setLocalName: (id: number, name: string) => void
  /** Set (or clear) a camera's hidden flag. */
  readonly setHidden: (id: number, hidden: boolean) => void
  /** Replace the global custom camera order. */
  readonly setOrder: (ids: readonly number[]) => void
}

/** Read + mutate persisted camera prefs. Triggers a one-time hydrate on mount. */
export function useCameraPrefs(): UseCameraPrefs {
  const prefs = useCameraPrefsStore((s) => s.prefs)
  const hydrated = useCameraPrefsStore((s) => s.hydrated)
  const hydrate = useCameraPrefsStore((s) => s.hydrate)
  const setLocalName = useCameraPrefsStore((s) => s.setLocalName)
  const setHidden = useCameraPrefsStore((s) => s.setHidden)
  const setOrder = useCameraPrefsStore((s) => s.setOrder)

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  return { prefs, hydrated, setLocalName, setHidden, setOrder }
}


/** One camera's clip-source pick, and the setter the picker drives. */
export interface UseCameraClipProvider {
  /** The stored SOURCE id, or undefined = the default (CamStack). */
  readonly chosen: string | undefined
  /** True once persisted prefs have loaded. Until then `chosen` is not an
   *  answer: an unhydrated store says "no pick" for every camera, and acting on
   *  that would flip a camera back to CamStack for one frame on every launch. */
  readonly hydrated: boolean
  readonly setChosen: (sourceId: string | undefined) => void
}

/**
 * Which ONE of a camera's clip sources this viewer reads.
 *
 * Client-persisted, in the per-camera prefs document, for the reason
 * `camera-prefs-store.ts` spells out: this is what the person
 * holding the phone is LOOKING at, not a claim about what runs. Writing it to
 * the hub would mean turning the other sources off for everybody, which is the
 * second knob over somebody else's configuration that D557 § 3 rejected.
 */
export function useCameraClipProvider(deviceId: number): UseCameraClipProvider {
  const prefs = useCameraPrefsStore((s) => s.prefs)
  const hydrated = useCameraPrefsStore((s) => s.hydrated)
  const hydrate = useCameraPrefsStore((s) => s.hydrate)
  const setCameraClipProvider = useCameraPrefsStore((s) => s.setCameraClipProvider)

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  return {
    chosen: cameraClipProvider(prefs, deviceId),
    hydrated,
    setChosen: (sourceId) => setCameraClipProvider(deviceId, sourceId),
  }
}

/**
 * Which ONE of a camera's RECORDING sources this viewer reads.
 *
 * The same client-persisted, per-installation choice `useCameraClipProvider`
 * is, on its own axis. `hydrated` matters more here than it does for clips:
 * an unhydrated store says "no pick" for every camera, and "no pick" MEANS
 * ours — so acting before hydration would paint one frame of our bar over a
 * camera the operator had pointed at its card.
 */
export function useCameraRecordingProvider(deviceId: number): UseCameraClipProvider {
  const prefs = useCameraPrefsStore((s) => s.prefs)
  const hydrated = useCameraPrefsStore((s) => s.hydrated)
  const hydrate = useCameraPrefsStore((s) => s.hydrate)
  const setCameraRecordingProvider = useCameraPrefsStore((s) => s.setCameraRecordingProvider)

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  return {
    chosen: cameraRecordingProvider(prefs, deviceId),
    hydrated,
    setChosen: (sourceId) => setCameraRecordingProvider(deviceId, sourceId),
  }
}
