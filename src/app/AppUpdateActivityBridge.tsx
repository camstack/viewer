/**
 * AppUpdateActivityBridge — feeds the app's own update into the Activity.
 *
 * Replaces the launch modal (`OtaUpdateGate`): `expo-updates` fetches an OTA in
 * the background and applies it on the next cold start, which looked like "the
 * update never arrived". This checks at launch, and the download is announced
 * as an Activity row that ends with "Restart now" — the operator restarts when
 * it suits them; nothing interrupts what they are doing.
 *
 * `useUpdates()` re-renders on every progress tick, so it lives HERE, in a leaf
 * that renders nothing and writes only to the activity store — never in a
 * provider above the tree. On the web, and wherever updates are disabled (a
 * dev client), nothing is mounted.
 */
import { useEffect } from 'react'
import { Platform } from 'react-native'
import * as Updates from 'expo-updates'

import { useActivityStore } from '../activity/activity-instance.js'
import {
  appUpdateDraft,
  isManualCheckRequested,
  runUpdateCheck,
} from '../activity/app-update-activity.js'

export function AppUpdateActivityBridge(): React.JSX.Element | null {
  if (Platform.OS === 'web' || !Updates.isEnabled) return null
  return <NativeBridge />
}

function NativeBridge(): null {
  const status = Updates.useUpdates()
  const setAppUpdate = useActivityStore((s) => s.setAppUpdate)

  useEffect(() => {
    void runUpdateCheck(false)
  }, [])

  const { isChecking, isDownloading, isUpdatePending, downloadProgress, checkError, downloadError } = status
  useEffect(() => {
    setAppUpdate(
      appUpdateDraft(
        { isChecking, isDownloading, isUpdatePending, downloadProgress, checkError, downloadError },
        isManualCheckRequested(),
      ),
    )
  }, [setAppUpdate, isChecking, isDownloading, isUpdatePending, downloadProgress, checkError, downloadError])

  return null
}
