/**
 * app-launch — which app the drawer offers and which one the viewer opens at
 * launch, as pure rules over the apps the hub listed (D1096).
 *
 * `null` is the app the shell draws itself (the native Viewer): it needs no
 * list to exist. Any other app id is data from `apps.listApps`. A wanted app is
 * opened only once the list ANSWERED and holds it: pending or a failed read is
 * "not known yet", never "not offered" (D315).
 */
import { findApp, hostedAppOf, orderApps, type AppCatalog } from './app-catalog.js'

/** An app id from the `apps` cap, or `null` for the app the shell hosts itself. */
export type AppId = string | null

/** "Open at launch": whichever was used last, or one app by id. */
export type LaunchPreference = 'last' | string

export const DEFAULT_LAUNCH_PREFERENCE: LaunchPreference = 'last'
export const DEFAULT_APP: AppId = null

export function parseAppId(raw: unknown): AppId {
  return typeof raw === 'string' && raw !== '' ? raw : DEFAULT_APP
}

export function parseLaunchPreference(raw: unknown): LaunchPreference {
  return typeof raw === 'string' && raw !== '' ? raw : DEFAULT_LAUNCH_PREFERENCE
}

/**
 * The app to show for a wanted one. A hosted app, an app the list does not
 * hold, and any wish while the list has not answered all resolve to the shell
 * itself.
 */
export function resolveApp(wanted: AppId, catalog: AppCatalog): AppId {
  if (wanted === null || catalog.status !== 'answered') return DEFAULT_APP
  const hosted = hostedAppOf(catalog)
  if (hosted !== null && hosted.app.id === wanted) return DEFAULT_APP
  return catalog.apps.some((info) => info.app.id === wanted) ? wanted : DEFAULT_APP
}

function wantedOf(preference: LaunchPreference, lastApp: AppId): AppId {
  return preference === 'last' ? lastApp : preference
}

/** The launch preferences the picker lists: last used, then every app the hub offered. */
export function offeredLaunchPreferences(catalog: AppCatalog): readonly LaunchPreference[] {
  if (catalog.status !== 'answered') return ['last']
  return ['last', ...orderApps(catalog.apps).map((info) => info.app.id)]
}

/** The app to open at launch. */
export function resolveLaunchApp(preference: LaunchPreference, lastApp: AppId, catalog: AppCatalog): AppId {
  return resolveApp(wantedOf(preference, lastApp), catalog)
}

/**
 * Whether the launch resolution may be spent now. While the list is still
 * pending a wanted embedded app must wait for the answer — otherwise the app
 * would open in the Viewer and never get to it. A failed read settles it.
 */
export function launchResolvable(preference: LaunchPreference, lastApp: AppId, catalog: AppCatalog): boolean {
  const wanted = wantedOf(preference, lastApp)
  return wanted === null || catalog.status !== 'pending'
}

/**
 * Whether the launch is still undecided AND the viewer must not be painted yet:
 * the device settings are not read (the wanted app is unknown), or they name an
 * embedded app that has not been opened. A launch into the Viewer never waits.
 */
export function launchCoversViewer(input: {
  readonly hydrated: boolean
  readonly settled: boolean
  readonly preference: LaunchPreference
  readonly lastApp: AppId
}): boolean {
  if (input.settled) return false
  return !input.hydrated || wantedOf(input.preference, input.lastApp) !== null
}

/** The last app used on each saved server, by server id: a server switch reopens it. */
export type LastAppByServer = Readonly<Record<string, AppId>>

/** Whether the catalog offers an app. The shell's own app always is; any other needs an ANSWERED list holding it. */
function offers(catalog: AppCatalog, appId: AppId): boolean {
  if (appId === null) return true
  if (catalog.status !== 'answered') return false
  return hostedAppOf(catalog)?.app.id === appId || findApp(catalog, appId) !== null
}

export interface SwitchAppInput {
  /** The app on screen before the switch. */
  readonly previous: AppId
  /** The new server's remembered app; `undefined` when it has no history. */
  readonly remembered: AppId | undefined
  readonly catalog: AppCatalog
  /** What a fresh launch would open (the launch preference). */
  readonly fallback: AppId
}

/**
 * The app to show after a server switch: the same app when the new server offers
 * it, else the last one used on THAT server, else the launch default.
 */
export function resolveSwitchApp({ previous, remembered, catalog, fallback }: SwitchAppInput): AppId {
  if (offers(catalog, previous)) return resolveApp(previous, catalog)
  if (remembered !== undefined && offers(catalog, remembered)) return resolveApp(remembered, catalog)
  return fallback
}

/** Whether the switch resolution may be spent: an embedded app waits for the new server's list to answer. */
export function switchResolvable(previous: AppId, catalog: AppCatalog): boolean {
  return previous === null || catalog.status !== 'pending'
}
