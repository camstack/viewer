/**
 * running-bundle — tell the crash reporter which bundle is running.
 *
 * The native reads (`expo-updates`, `expo-constants`) live here rather than in
 * `lib/crash-reporter.ts` so that module stays loadable in the node-env vitest
 * suite, the same split `app/version-info.ts` already uses for the Settings
 * page — and the formatting rule is that module's `describeRunningBundle`, so
 * a crash line and the Settings row can never disagree about what is running.
 */
import Constants from 'expo-constants'
import * as Updates from 'expo-updates'

import { setRunningBundle } from '../lib/crash-reporter.js'
import { describeRunningBundle } from './version-info.js'

/** Read the running bundle and hand it to the crash reporter. Total: a missing
 *  native value degrades the line, it never fails the launch. */
export function publishRunningBundle(): void {
  setRunningBundle({
    version: Constants.expoConfig?.version ?? null,
    bundle: describeRunningBundle({
      runtimeVersion: Updates.runtimeVersion,
      updateId: Updates.updateId,
      updateCreatedAt: Updates.createdAt,
      isEmbeddedLaunch: Updates.isEmbeddedLaunch,
      updatesEnabled: Updates.isEnabled,
    }),
  })
}

/** The native build number this runtime lives in — iOS `buildNumber`, Android `versionCode`. */
export function runningBuildNumber(): number | null {
  const ios = Constants.platform?.ios?.buildNumber
  if (typeof ios === 'string' && ios !== '') {
    const n = Number.parseInt(ios, 10)
    return Number.isFinite(n) ? n : null
  }
  const android = Constants.platform?.android?.versionCode
  return typeof android === 'number' ? android : null
}
