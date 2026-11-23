/**
 * app-launch — which app the drawer offers and which one the viewer opens at
 * launch, as pure rules.
 *
 * Admin is offered ONLY once the hub has ANSWERED that
 * the session is an admin. A pending or failed `auth.me` is "not known yet",
 * never "not an admin" — and never "an admin" either (D315): the surfaces stay
 * out of the drawer until the answer is `admin`.
 */
import type { AdminVerdict } from '../data/use-me.js'

/** The apps the operator can pick as a destination. */
export type AppId = 'viewer' | 'admin'

/** "Open at launch": a fixed app, or whichever was used last. */
export type LaunchPreference = 'last' | AppId

export const DEFAULT_LAUNCH_PREFERENCE: LaunchPreference = 'last'
export const DEFAULT_APP: AppId = 'viewer'

export const LAUNCH_PREFERENCES: readonly LaunchPreference[] = ['last', 'viewer', 'admin']

export function parseAppId(raw: unknown): AppId {
  return raw === 'admin' ? 'admin' : 'viewer'
}

export function parseLaunchPreference(raw: unknown): LaunchPreference {
  return raw === 'viewer' || raw === 'admin' || raw === 'last' ? raw : DEFAULT_LAUNCH_PREFERENCE
}

/** Admin exists for this session only when the hub said "admin". */
export function adminSurfacesOffered(verdict: AdminVerdict): boolean {
  return verdict === 'admin'
}

/** The apps the drawer lists. */
export function offeredApps(verdict: AdminVerdict): readonly AppId[] {
  return adminSurfacesOffered(verdict) ? ['viewer', 'admin'] : ['viewer']
}

/** The launch preferences the picker lists: Admin only for a confirmed admin. */
export function offeredLaunchPreferences(verdict: AdminVerdict): readonly LaunchPreference[] {
  return adminSurfacesOffered(verdict) ? LAUNCH_PREFERENCES : ['last', 'viewer']
}

/**
 * The app to open at launch. `last` reopens the last app used; a fixed choice
 * opens that app. Admin always falls back to Viewer while the verdict is not
 * `admin` (pending, unknown, not-admin).
 */
export function resolveLaunchApp(
  preference: LaunchPreference,
  lastApp: AppId,
  verdict: AdminVerdict,
): AppId {
  const wanted: AppId = preference === 'last' ? lastApp : preference
  return wanted === 'admin' && !adminSurfacesOffered(verdict) ? DEFAULT_APP : wanted
}

/**
 * Whether the launch resolution may be spent now. While the verdict is still
 * `pending` a wanted Admin must wait for the answer — otherwise the app would
 * open in Viewer and never get to Admin. Any other verdict settles it.
 */
export function launchResolvable(
  preference: LaunchPreference,
  lastApp: AppId,
  verdict: AdminVerdict,
): boolean {
  const wanted: AppId = preference === 'last' ? lastApp : preference
  return wanted === 'viewer' || verdict !== 'pending'
}
