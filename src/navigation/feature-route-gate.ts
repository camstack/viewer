/**
 * feature-route-gate — what a route behind a viewer feature does before it
 * renders (D921). A screen reachable by URL (a deep link, a bookmark, a typed
 * path) is not protected by the Library hiding its section: without its
 * feature it must never mount and then fail. It waits for the hub's answer,
 * renders with the feature, and otherwise sends the person to the Library
 * with "not available for your account".
 *
 * Pure — the React binding is `FeatureRouteGate.tsx`.
 */
import type { Href } from 'expo-router'

export type FeatureRouteDecision = 'wait' | 'render' | 'redirect'

/** Where a refused feature route lands: the Library tab (its route is `/events`). */
export const FEATURE_ROUTE_FALLBACK: Href = '/events'

export interface FeatureRouteInput {
  /** `auth.me` has not answered yet. */
  readonly pending: boolean
  /** The session holds the route's feature. */
  readonly held: boolean
}

export function featureRouteDecision(input: FeatureRouteInput): FeatureRouteDecision {
  if (input.held) return 'render'
  return input.pending ? 'wait' : 'redirect'
}
