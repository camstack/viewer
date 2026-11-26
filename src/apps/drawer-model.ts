/**
 * drawer-model — what the one app drawer draws, as pure rules (D1096).
 *
 * Everything comes from the apps the hub listed: the APPS rows, the active app's
 * NAV and its Settings. No app id is spelled here. The Viewer's own tabs stay in
 * its bar or rail, so the hosted app publishes an empty nav. A claim of absence
 * is made only from a list that answered (D315): pending and a failed read draw
 * no app rows at all rather than a wrong one.
 */
import type { AppInfo, AppLabel } from '@camstack/types'

import { hostedAppOf, orderApps, type AppCatalog } from './app-catalog.js'
import type { AppId } from './app-launch.js'

export type Translate = (label: AppLabel) => string

export interface DrawerApp {
  readonly id: string
  readonly label: string
  readonly icon: string
  readonly selected: boolean
}

export interface DrawerNavItem {
  readonly id: string
  readonly label: string
  readonly icon: string
  readonly path: string
}

export interface DrawerNavSection {
  readonly id: string
  readonly label: string | null
  readonly items: readonly DrawerNavItem[]
}

export interface DrawerSettings {
  readonly label: string
  readonly path: string
}

export interface DrawerModel {
  readonly appsState: AppCatalog['status']
  readonly apps: readonly DrawerApp[]
  /** The active app's id once the list answered; `null` while it is not known. */
  readonly activeId: string | null
  readonly nav: readonly DrawerNavSection[]
  readonly settings: DrawerSettings | null
}

export interface DrawerInput {
  readonly catalog: AppCatalog
  /** The app on screen; `null` is the app the shell hosts itself. */
  readonly activeAppId: AppId
  readonly translate: Translate
}

/** The label of the shell's own Settings when the hub did not send one. */
export const SETTINGS_LABEL: AppLabel = { key: 'v2.userMenu.settings', fallback: 'Settings' }

function activeOf(catalog: AppCatalog, activeAppId: AppId): AppInfo | null {
  if (catalog.status !== 'answered') return null
  if (activeAppId !== null) {
    const found = catalog.apps.find((info) => info.app.id === activeAppId)
    if (found !== undefined) return found
  }
  return hostedAppOf(catalog)
}

export function buildDrawerModel({ catalog, activeAppId, translate }: DrawerInput): DrawerModel {
  const active = activeOf(catalog, activeAppId)
  const activeId = active?.app.id ?? null
  const apps: readonly DrawerApp[] =
    catalog.status === 'answered'
      ? orderApps(catalog.apps).map((info) => ({
          id: info.app.id,
          label: translate(info.app.label),
          icon: info.app.icon,
          selected: info.app.id === activeId,
        }))
      : []

  const hostedIsActive = active === null ? activeAppId === null : hostedAppOf(catalog)?.app.id === active.app.id
  const nav: readonly DrawerNavSection[] =
    active === null || hostedIsActive
      ? []
      : active.app.nav
          .map((section) => ({
            id: section.id,
            label: section.label === null ? null : translate(section.label),
            items: section.items.map((item) => ({ id: item.id, label: translate(item.label), icon: item.icon, path: item.path })),
          }))
          .filter((section) => section.items.length > 0)

  // Settings belong to the active app and only when it declares them. While the
  // list has not answered the shell is still its own host: its Settings stay
  // reachable (an older hub has no `apps` cap at all).
  let settings: DrawerSettings | null = null
  if (active !== null) {
    if (active.app.settings !== null) {
      settings = { label: translate(active.app.settings.label ?? SETTINGS_LABEL), path: active.app.settings.path }
    }
  } else if (activeAppId === null) {
    settings = { label: translate(SETTINGS_LABEL), path: '/settings' }
  }

  return { appsState: catalog.status, apps, activeId, nav, settings }
}
