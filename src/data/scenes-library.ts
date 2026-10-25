/**
 * scenes-library — read-only data for the Library → Scenes page, over
 * `sceneMonitor.listScenesBatch`.
 *
 * The cap answers EVERY requested camera with a row; `status: null` means the
 * camera could not be read, `status.monitors: []` means it was read and has
 * none. The page keeps that difference (`unreadable` vs `monitors`) instead of
 * folding both into "no scenes".
 */
import { useQuery } from '@tanstack/react-query'

import { useConnection } from '../connection/ConnectionProvider.js'
import { BULK_QUERY_DEADLINE_MS, capQuery, isRecord } from './cap-query.js'
import { useCameras } from './use-cameras.js'

/** The hub's cap bound for one batch (`deviceIds.max(200)`). */
export const SCENES_BATCH_MAX = 200

export interface SceneEntry {
  readonly monitorId: string
  readonly label: string
  readonly enabled: boolean
}

export interface CameraScenes {
  readonly deviceId: number
  /** `null`: the camera could not be read (NOT "no scenes"). */
  readonly scenes: readonly SceneEntry[] | null
}

function toSceneEntry(raw: unknown): SceneEntry | null {
  if (!isRecord(raw)) return null
  const id = typeof raw.id === 'string' ? raw.id : typeof raw.monitorId === 'string' ? raw.monitorId : null
  if (id === null) return null
  return {
    monitorId: id,
    label: typeof raw.label === 'string' ? raw.label : id,
    enabled: raw.enabled !== false,
  }
}

/** Narrow a `listScenesBatch` answer; a row that cannot be read is `scenes: null`. */
export function toCameraScenes(raw: unknown): CameraScenes[] {
  if (!Array.isArray(raw)) return []
  const out: CameraScenes[] = []
  for (const row of raw) {
    if (!isRecord(row) || typeof row.deviceId !== 'number') continue
    const status = row.status
    if (!isRecord(status) || !Array.isArray(status.monitors)) {
      out.push({ deviceId: row.deviceId, scenes: null })
      continue
    }
    const scenes: SceneEntry[] = []
    for (const monitor of status.monitors) {
      const entry = toSceneEntry(monitor)
      if (entry !== null) scenes.push(entry)
    }
    out.push({ deviceId: row.deviceId, scenes })
  }
  return out
}

/** Camera ids split into batches the cap accepts. */
export function sceneBatches(deviceIds: readonly number[]): number[][] {
  const batches: number[][] = []
  for (let i = 0; i < deviceIds.length; i += SCENES_BATCH_MAX) batches.push(deviceIds.slice(i, i + SCENES_BATCH_MAX))
  return batches
}

export function useScenesLibrary(enabled: boolean) {
  const { controller, state } = useConnection()
  const { data: cameras } = useCameras()
  const deviceIds = (cameras ?? []).map((c) => c.id)
  return useQuery<CameraScenes[]>({
    queryKey: ['v2', 'scenes-library', deviceIds],
    enabled: enabled && state === 'connected' && deviceIds.length > 0,
    staleTime: 30_000,
    queryFn: async () => {
      const system = controller.getSystem()
      if (!system) return []
      const client = system.trpcClient as Record<string, unknown>
      const answers = await Promise.all(
        sceneBatches(deviceIds).map((batch) =>
          capQuery(client, 'sceneMonitor', 'listScenesBatch', { deviceIds: batch }, { deadlineMs: BULK_QUERY_DEADLINE_MS }),
        ),
      )
      return answers.flatMap(toCameraScenes)
    },
  })
}
