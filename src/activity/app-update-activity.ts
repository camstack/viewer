/**
 * app-update-activity — the app's own update, told through the Activity.
 *
 * The update is no longer a modal: it is a row that shows the download, ends
 * with "Restart now", and can be dismissed ("later"). This file holds the
 * pure translation from what `expo-updates` reports to that row, and the two
 * things the row can do. The bridge that feeds it lives in
 * `app/AppUpdateActivityBridge.tsx`.
 */
import * as Updates from 'expo-updates'

import { reloadRuntimeForUpdate } from '../lib/reload-runtime.js'
import type { AppUpdateDraft } from './activity-model.js'

/** What the native update state machine reports for an error: a plain object
 *  with a `message`, NOT an `Error` instance, and `null` — not `undefined` —
 *  when there is none (the iOS context is a Swift dictionary whose nil values
 *  cross the bridge as null). 1.0.678 compared with `!== undefined`, took that
 *  null for a failure and threw `null.message` from the bridge's effect on
 *  every launch: the root boundary drew before the first connect. */
export type UpdateErrorLike = { readonly message?: unknown } | null | undefined

/** The slice of `Updates.useUpdates()` the row depends on. */
export interface AppUpdateStatus {
  readonly isChecking: boolean
  readonly isDownloading: boolean
  readonly isUpdatePending: boolean
  readonly downloadProgress: number | undefined
  readonly checkError: UpdateErrorLike
  readonly downloadError: UpdateErrorLike
}

/**
 * What the row says now, or `null` for no row. A check is shown only when the
 * operator asked for it (Settings): the launch check merely looking, or failing
 * offline, is not news and must not light the Activity button on every start.
 */
export function appUpdateDraft(status: AppUpdateStatus, manual: boolean): AppUpdateDraft | null {
  if (hasError(status.downloadError)) return failed(status.downloadError)
  if (status.isDownloading) {
    return { state: 'downloading', progress: status.downloadProgress ?? null, version: null, error: null }
  }
  if (status.isUpdatePending) return { state: 'ready', progress: null, version: null, error: null }
  if (manual && hasError(status.checkError)) return failed(status.checkError)
  if (manual && status.isChecking) return { state: 'checking', progress: null, version: null, error: null }
  return null
}

function hasError(error: UpdateErrorLike): error is { readonly message?: unknown } {
  return typeof error === 'object' && error !== null
}

function failed(error: { readonly message?: unknown }): AppUpdateDraft {
  const message = typeof error.message === 'string' && error.message !== '' ? error.message : null
  return { state: 'failed', progress: null, version: null, error: message }
}

/** "Restart now" — the one door, so the exit marker and the native drain happen. */
export function restartForUpdate(): Promise<void> {
  return reloadRuntimeForUpdate('activity')
}

// ── Asking the update server ────────────────────────────────────────────────

export type UpdateCheckOutcome = 'disabled' | 'up-to-date' | 'downloaded' | 'failed'

// Sticky for the session: once the operator asked, a failure stays visible.
let manualRequested = false

/** Whether the operator asked for a check (Settings) this session. */
export function isManualCheckRequested(): boolean {
  return manualRequested
}

/**
 * Ask the update server and fetch what is there. The result is shown by the
 * Activity bridge (it watches `useUpdates`); the return value is only for the
 * caller that must say "up to date" or "disabled", which have no row.
 */
export async function runUpdateCheck(manual: boolean): Promise<UpdateCheckOutcome> {
  if (!Updates.isEnabled) return 'disabled'
  if (manual) manualRequested = true
  try {
    const check = await Updates.checkForUpdateAsync()
    if (!check.isAvailable) return 'up-to-date'
    await Updates.fetchUpdateAsync()
    return 'downloaded'
  } catch {
    // Offline or a malformed manifest: `useUpdates` reports it as checkError /
    // downloadError, and the row shows it when the operator asked.
    return 'failed'
  }
}
