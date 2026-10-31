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

/** The camera an export is for, when it is not the hook's own (a scoped selection). */
export interface ExportTarget {
  readonly deviceId: number
  readonly name: string
}

export interface RunExport {
  /** `target` names the camera when it differs from the hook's; `announce`
   *  overrides {@link RunExportOptions.announceStart} for this one run. */
  readonly run: (commit: ExportCommit, target?: ExportTarget, announce?: boolean) => Promise<void>
  readonly pending: boolean
}

export interface RunExportOptions {
  /**
   * Say "export started" in a notice. Off where the Activity button is the
   * acknowledgement (an event's download), so a start never needs a dismissal;
   * a failure is always said.
   */
  readonly announceStart?: boolean
}

export function useRunExport(deviceId: number, cameraName: string, options: RunExportOptions = {}): RunExport {
  const announceStart = options.announceStart ?? true
  const { t } = useTranslation()
  const notice = useNotice()
  const createExport = useCreateExport()
  const addActivity = useActivityStore((s) => s.add)

  const run = useCallback(
    async ({ input }: ExportCommit, target?: ExportTarget, announce?: boolean): Promise<void> => {
      const name = target?.name ?? cameraName
      log.info('exports', 'createExport from the timeline', {
        deviceId: target?.deviceId ?? deviceId,
        fromMs: input.fromMs,
        toMs: input.toMs,
      })
      const rec = await createExport.mutateAsync(input)
      // `capMutate` swallows an absent cap to `null`. Reporting "saved" on
      // a null would be a lie about the one act in this cycle the operator
      // cannot repeat from memory.
      if (rec !== null) addActivity(exportItemFrom(rec, name, Date.now()))
      if (rec === null || (announce ?? announceStart)) {
        notice({
          title: t('v2.exportSelection.title'),
          message: rec === null ? t('v2.exportSelection.failed') : t('v2.activity.exportStarted'),
        })
      }
    },
    [addActivity, announceStart, cameraName, createExport, deviceId, notice, t],
  )

  return { run, pending: createExport.isPending }
}
