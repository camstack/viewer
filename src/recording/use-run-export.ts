/**
 * use-run-export — queue an export from a planned commit, then say so.
 *
 * The act shared by every surface that keeps a stretch of the recording: the
 * timeline selection's Save and the event card's clip download. One function so
 * the three things that follow a `createExport` cannot drift apart — the
 * Activity item (so the progress shows up in the Activity list), the notice, and
 * the rule that a `null` from the hub (`capMutate` swallows an absent cap) is
 * reported as a failure, never as "saved".
 */
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import { useActivityStore } from '../activity/activity-instance.js'
import { exportItemFrom } from '../activity/activity-model.js'
import { useNotice } from '../components/ui/confirm.js'
import { useCreateExport } from '../data/use-exports.js'
import { log } from '../lib/logger.js'
import type { SelectionCommit } from './selection-commit.js'

export type ExportCommit = Extract<SelectionCommit, { readonly action: 'export' }>

export interface RunExport {
  readonly run: (commit: ExportCommit) => Promise<void>
  readonly pending: boolean
}

export function useRunExport(deviceId: number, cameraName: string): RunExport {
  const { t } = useTranslation()
  const notice = useNotice()
  const createExport = useCreateExport()
  const addActivity = useActivityStore((s) => s.add)

  const run = useCallback(
    async ({ input }: ExportCommit): Promise<void> => {
      log.info('exports', 'createExport from the timeline', {
        deviceId,
        fromMs: input.fromMs,
        toMs: input.toMs,
      })
      const rec = await createExport.mutateAsync(input)
      // `capMutate` swallows an absent cap to `null`. Reporting "saved" on
      // a null would be a lie about the one act in this cycle the operator
      // cannot repeat from memory.
      if (rec !== null) addActivity(exportItemFrom(rec, cameraName, Date.now()))
      notice({
        title: t('v2.exportSelection.title'),
        message: rec === null ? t('v2.exportSelection.failed') : t('v2.activity.exportStarted'),
      })
    },
    [addActivity, cameraName, createExport, deviceId, notice, t],
  )

  return { run, pending: createExport.isPending }
}
