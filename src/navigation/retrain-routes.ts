/**
 * retrain-routes — the href of the retrain annotation editor.
 *
 * `frameId` is the route segment; the Library filter the frame was opened from
 * (`deviceId`, `collectionId`) rides as search params so the editor walks the
 * SAME list ("Frame 3/12") and hits the same query cache. Typed as expo-router's
 * own `Href`, like the rule routes.
 */
import type { Href } from 'expo-router'

export interface RetrainFrameScope {
  readonly deviceId?: number | null
  readonly collectionId?: string | null
}

export function retrainFrameHref(frameId: string, scope: RetrainFrameScope = {}): Href {
  return {
    pathname: '/retrain/[frameId]',
    params: {
      frameId,
      ...(scope.deviceId !== undefined && scope.deviceId !== null
        ? { deviceId: String(scope.deviceId) }
        : {}),
      ...(scope.collectionId !== undefined && scope.collectionId !== null
        ? { collectionId: scope.collectionId }
        : {}),
    },
  }
}

/** The scope a route's search params describe — junk is dropped, never thrown. */
export function parseRetrainScope(params: {
  readonly deviceId?: string | string[]
  readonly collectionId?: string | string[]
}): { readonly deviceId: number | null; readonly collectionId: string | null } {
  const device = Array.isArray(params.deviceId) ? params.deviceId[0] : params.deviceId
  const collection = Array.isArray(params.collectionId) ? params.collectionId[0] : params.collectionId
  const parsed = device !== undefined && device !== '' ? Number(device) : Number.NaN
  return {
    deviceId: Number.isInteger(parsed) ? parsed : null,
    collectionId: collection !== undefined && collection !== '' ? collection : null,
  }
}
