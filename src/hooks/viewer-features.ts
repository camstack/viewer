/**
 * viewer-features — which named features this session holds.
 *
 * A person on the hub is an admin or a viewer. A viewer reaches its devices
 * and, on top, the features an admin switched on for it one at a time
 * (`auth.me.scope.features`): face assignment, plate assignment, retrain,
 * scenes. An admin holds every feature. A session the hub calls `scoped` is a
 * person not yet converted to a role; it holds none, which is exactly what it
 * had before features existed (those surfaces were admin-only).
 *
 * Unknown fails CLOSED here, like `useIsAdmin`: while `auth.me` is in flight,
 * or on a hub too old to send a role, no feature surface is drawn. A gallery
 * the hub then refuses is worse than one that appears a moment later.
 *
 * Pure — no React, no I/O. The React binding is `useGrantedFeatures` /
 * `useHasFeature` in `data/use-me.ts`.
 */
import type { ViewerFeatureId } from '@camstack/types'

export type { ViewerFeatureId }

/**
 * Every feature this build knows. A `Record` over the type, so a feature the
 * types package adds fails to compile here until it is listed — and an id a
 * newer hub sends that this build does not know is dropped by
 * {@link isViewerFeatureId} instead of being trusted.
 */
const KNOWN_FEATURES: Readonly<Record<ViewerFeatureId, true>> = {
  'face-assignment': true,
  'plate-assignment': true,
  retrain: true,
  scenes: true,
}

export function isViewerFeatureId(value: unknown): value is ViewerFeatureId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(KNOWN_FEATURES, value)
}

/** Every feature, in catalog order — what an admin holds. */
export const ALL_VIEWER_FEATURES: readonly ViewerFeatureId[] = Object.keys(KNOWN_FEATURES).filter(isViewerFeatureId)

/** No feature — an unknown session, a legacy `scoped` user, a viewer granted none. */
export const NO_VIEWER_FEATURES: readonly ViewerFeatureId[] = []

/** The session's role as the hub states it (`auth.me.scope.role`). */
export type SessionRole = 'admin' | 'viewer' | 'scoped'

export function isSessionRole(value: unknown): value is SessionRole {
  return value === 'admin' || value === 'viewer' || value === 'scoped'
}

/** Keep the known feature ids of a wire list, in their wire order, once each. */
export function parseViewerFeatures(raw: unknown): readonly ViewerFeatureId[] {
  if (!Array.isArray(raw)) return NO_VIEWER_FEATURES
  const out: ViewerFeatureId[] = []
  for (const entry of raw) {
    if (isViewerFeatureId(entry) && !out.includes(entry)) out.push(entry)
  }
  return out
}

/** The two fields of the session the feature answer is read from. */
export interface FeatureSessionInput {
  /** `auth.me.isAdmin`, present on every hub. */
  readonly isAdmin: boolean
  /** The parsed scope; `null` on a hub that sends none. */
  readonly scope: { readonly role: SessionRole; readonly features: readonly ViewerFeatureId[] } | null
}

/**
 * The features a session holds. `undefined` / `null` is an unanswered
 * `auth.me` and holds none. An admin — by the top-level flag OR the scope's
 * role — holds all of them; a viewer holds what its row lists; anyone else
 * holds none.
 */
export function grantedFeatures(session: FeatureSessionInput | null | undefined): readonly ViewerFeatureId[] {
  if (session === null || session === undefined) return NO_VIEWER_FEATURES
  if (session.isAdmin || session.scope?.role === 'admin') return ALL_VIEWER_FEATURES
  if (session.scope?.role === 'viewer') return session.scope.features
  return NO_VIEWER_FEATURES
}

export function holdsFeature(granted: readonly ViewerFeatureId[], feature: ViewerFeatureId): boolean {
  return granted.includes(feature)
}
