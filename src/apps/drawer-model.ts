/**
 * drawer-model — which blocks the app drawer draws, as pure rules.
 *
 * APPS lists Viewer and — only once the hub answered that the session is an
 * admin — Admin. NODES is the same gate. A block never shows on an unanswered
 * `auth.me`: pending is not "not admin", and it is not "admin" either (D315).
 */
import type { AdminVerdict } from '../data/use-me.js'
import { adminSurfacesOffered, type AppId } from './app-launch.js'
import { showServerList } from '../navigation/user-menu.js'

export interface DrawerBlocks {
  /** The Admin row of APPS. Viewer is always listed. */
  readonly adminApp: boolean
  /** The NODES list. */
  readonly nodes: boolean
  /** The saved-servers list: at least two. */
  readonly servers: boolean
}

export function drawerBlocks(verdict: AdminVerdict, serverCount: number): DrawerBlocks {
  const admin = adminSurfacesOffered(verdict)
  return { adminApp: admin, nodes: admin, servers: showServerList(serverCount) }
}

/** The label key of the app on screen, for the highlighted drawer row. */
export function isAppSelected(active: { readonly kind: string }, app: AppId): boolean {
  return active.kind === app
}

/** The i18n key of a launch preference's label. */
export function launchLabelKey(preference: 'last' | AppId): string {
  return `v2.apps.launch.${preference}`
}
