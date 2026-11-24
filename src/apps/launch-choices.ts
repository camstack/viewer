/**
 * launch-choices — the rows of the "Open at launch" picker, as pure rules: "last
 * used" and one row per app the hub offered, labelled the way the drawer labels it.
 */
import type { AppCatalog } from './app-catalog.js'
import { offeredLaunchPreferences, type LaunchPreference } from './app-launch.js'
import type { Translate } from './drawer-model.js'

export interface LaunchChoice {
  readonly preference: LaunchPreference
  /** `null` is "last used": the caller translates it. */
  readonly label: string | null
}

export function launchChoices(catalog: AppCatalog, translate: Translate): readonly LaunchChoice[] {
  const apps = catalog.status === 'answered' ? catalog.apps : []
  return offeredLaunchPreferences(catalog).map((preference) => {
    if (preference === 'last') return { preference, label: null }
    const info = apps.find((candidate) => candidate.app.id === preference)
    return { preference, label: info === undefined ? preference : translate(info.app.label) }
  })
}

/** The current preference as text: its app's label, "last used", or `null` while the list cannot name it. */
export function launchValueLabel(preference: LaunchPreference, catalog: AppCatalog, translate: Translate): string | null {
  const choice = launchChoices(catalog, translate).find((c) => c.preference === preference)
  return choice === undefined ? null : choice.label
}
