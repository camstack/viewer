/**
 * OtaUpdateGate — apply a pending OTA on THIS launch instead of the next one.
 *
 * `expo-updates` defaults to `fallbackToCacheTimeout: 0`: an update is fetched
 * in the background and applied on the FOLLOWING cold start. So the operator
 * publishes, opens the app, sees the old build, and concludes the update never
 * arrived — the "OTA doesn't reach TestFlight" report (2026-07-30). It did
 * arrive; it was waiting for a second launch.
 *
 * This checks explicitly at startup and, when something new is fetched, reloads
 * straight away. Reloading is only safe because it happens AT LAUNCH, before
 * the user has navigated anywhere: a reload mid-session would discard whatever
 * they were doing, so it is bounded by `RELOAD_WINDOW_MS` since mount and never
 * fires later (a later update simply waits for the next start, as before).
 *
 * It asks before it restarts (since 2026-09-06 — the dialog below). On a dev
 * client or when updates are disabled, `Updates.isEnabled` is false and this
 * is a no-op.
 *
 * ## It says so before it goes
 *
 * `reloadAsync` starts a brand-new JS runtime: a fresh `BootTimeline`, a second
 * `stage transportReady`, a whole second launch in the hub's logs — identical
 * to what a crash leaves behind. Chasing the 2026-08-20 "it crashes when I open
 * it" report, four launches in one hour could not be told apart for exactly
 * this reason. So the marker is written FIRST: the next runtime then reports
 * `previous runtime exit: ota-reload` and the launch is accounted for. See
 * `lib/crash-record.ts`.
 */
import { useEffect } from 'react'
import * as Updates from 'expo-updates'
import { useTranslation } from 'react-i18next'
import { useConfirm } from '../components/ui/confirm.js'

import { reloadRuntimeForUpdate } from '../lib/reload-runtime.js'

/** After this long since mount, an update is NOT auto-applied — the user has
 *  started doing things and a reload would be theft. */
const RELOAD_WINDOW_MS = 15_000

export function OtaUpdateGate(): null {
  const confirm = useConfirm()
  const { t } = useTranslation()
  useEffect(() => {
    if (!Updates.isEnabled) return
    const mountedAt = Date.now()
    let cancelled = false

    const run = async (): Promise<void> => {
      try {
        const check = await Updates.checkForUpdateAsync()
        if (cancelled || !check.isAvailable) return
        const fetched = await Updates.fetchUpdateAsync()
        if (cancelled || !fetched.isNew) return
        if (Date.now() - mountedAt > RELOAD_WINDOW_MS) return

        // It ASKS. A restart discards where the operator is, and "the app

        // reopened by itself" is indistinguishable from a crash to them

        // (operator, 2026-09-06). "Later" = the update applies on the next

        // cold start, exactly as expo-updates did before this gate.

        const install = await confirm({

          title: t('v2.updates.otaReadyTitle'),

          message: t('v2.updates.otaReadyBody'),

          confirmLabel: t('v2.updates.install'),

          cancelLabel: t('v2.updates.later'),

        })

        if (!install || cancelled) return
        await reloadRuntimeForUpdate('launch-gate')
      } catch {
        // Offline, hub unreachable, or a malformed manifest — the update simply
        // applies on the next launch, exactly as it did before this gate.
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [confirm, t])

  return null
}
