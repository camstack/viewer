/**
 * The version facts of the running app, read from the native modules.
 *
 * Two segments need them: About & updates shows them, and the network
 * diagnosis in Advanced ships them with its report. One reader, so the two can
 * never describe different builds.
 *
 * Four INDEPENDENT facts, not one version string. A single number cannot
 * distinguish "the OTA never arrived" from "it arrived under a stale label",
 * which is exactly what made the 2026-07-30 report undiagnosable.
 */
import { Platform } from 'react-native'
import Constants from 'expo-constants'
import * as Updates from 'expo-updates'
import { buildVersionRows, type VersionRow, type VersionRowId } from '../../app/version-info.js'

/** True on an iOS/Android binary; false on the web build and the Electron shell. */
export const NATIVE_BINARY = Platform.OS !== 'web'

export function runningVersionRows(): readonly VersionRow[] {
  return buildVersionRows({
    configVersion: Constants.expoConfig?.version,
    nativeBuildNumber:
      Constants.platform?.ios?.buildNumber ??
      (Constants.platform?.android?.versionCode !== undefined
        ? String(Constants.platform.android.versionCode)
        : null),
    runtimeVersion: Updates.runtimeVersion,
    updateId: Updates.updateId,
    updateCreatedAt: Updates.createdAt,
    isEmbeddedLaunch: Updates.isEmbeddedLaunch,
    updatesEnabled: Updates.isEnabled,
    // The Electron shell and the browser both load the WEB build: no native
    // binary, no OTA channel, no updater. `buildVersionRows` then returns the
    // app version alone, because those facts do not exist there rather than
    // being unknown.
    nativeBinary: NATIVE_BINARY,
  })
}

export function versionValue(rows: readonly VersionRow[], id: VersionRowId): string {
  return rows.find((r) => r.id === id)?.value ?? '—'
}
