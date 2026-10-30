/**
 * use-export-selection — the hub half of "save this stretch of the recording".
 *
 * The feature is split in three, and each part lives where it can be checked:
 *
 *   • the MODE is a state of the playback machine (`selectionAnchor`), because
 *     the selection's free end IS the playhead's preview and a second reducer
 *     owning that would drift from the first;
 *   • the ARITHMETIC is `export-selection.ts`, pure and unit-tested, because
 *     the operator normally scrubs BACKWARDS and an unordered range reaches the
 *     hub as a silent no-op;
 *   • the HUB CALL is here, so the machine never learns what an export is and a
 *     mount test can drive the whole cycle through real code.
 *
 * The selection has two KINDS — export and delete — drawn alike and confirmed
 * differently (`selection-commit.ts` is the one place that maps kind + range to
 * a hub call, and where "delete is admin-only" is decided).
 *
 * WHEN the export is created: on **Save**, never on the scrub's release. A
 * created-then-discarded export is not free — `cancelExport` transitions the
 * state and KEEPS the history row (`use-exports.ts`), so "create on release,
 * cancel on discard" would leave the operator's own rejected attempts littering
 * the hub's export list, one per release, for a period they explicitly threw
 * away. Save-only also means Discard has nothing to undo, which is what makes
 * "the discard must leave nothing" a property of the shape rather than a
 * cleanup path that can fail.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'

import { useConfirm, useNotice } from '../components/ui/confirm.js'
import { useConnection } from '../connection/ConnectionProvider.js'
import { formatBytes } from '../data/export-format.js'
import { useIsAdmin } from '../data/use-me.js'
import { useDeleteFootprint } from '../data/use-storage-management.js'
import { log } from '../lib/logger.js'
import {
  formatSelectionDuration,
  formatSelectionSpan,
  type ExportSelectionRange,
  type SelectionCoverage,
} from './export-selection.js'
import { selectActiveEpoch, type PlaybackMachine } from './playback-machine.js'
import { planSelectionCommit, type SelectionCommit, type SelectionKind } from './selection-commit.js'
import { useRunExport } from './use-run-export.js'

type DeleteCommit = Extract<SelectionCommit, { readonly action: 'delete' }>

/** The recording queries (coverage, days, profiles) a delete makes stale. */
const RECORDING_QUERIES = ['v2', 'recording'] as const

/** The screen's half of the timeline's `exportSelection` binding. */
export interface ExportSelectionBinding {
  readonly anchorMs: number | null
  /** What the ARMED selection is for. Meaningful only while `anchorMs` is set. */
  readonly kind: SelectionKind
  readonly onBegin: (kind: SelectionKind) => void
  readonly onSave: (range: ExportSelectionRange, coverage: SelectionCoverage) => void
  readonly onDiscard: () => void
  readonly saving: boolean
}

export function useExportSelection(
  deviceId: number,
  cameraName: string,
  playback: PlaybackMachine,
): ExportSelectionBinding {
  const { t } = useTranslation()
  const confirm = useConfirm()
  const notice = useNotice()
  const deleteFootprint = useDeleteFootprint()
  const queryClient = useQueryClient()
  const isAdmin = useIsAdmin()
  const { state: connectionState } = useConnection()
  const [kind, setKind] = useState<SelectionKind>('export')

  const onBegin = useCallback(
    (next: SelectionKind): void => {
      const epoch = selectActiveEpoch(playback.state)
      // Null ⟺ the live edge, where this control is not drawn and the reducer
      // would refuse anyway. Belt and braces on the one press that decides what
      // an operator ends up keeping — or losing.
      if (epoch === null) return
      // The same refusal the commit makes, one press earlier: a non-admin never
      // even sees the band turn red.
      if (next === 'delete' && !isAdmin) return
      setKind(next)
      playback.beginSelection(epoch)
    },
    [isAdmin, playback],
  )

  const onDiscard = useCallback((): void => {
    // Nothing to undo: no export exists yet. That is the point of Save-only.
    playback.endSelection()
  }, [playback])

  const { run: runExport, pending: exportPending } = useRunExport(deviceId, cameraName)

  const runDelete = useCallback(
    /** Resolves `false` when the operator declined the dialog. */
    async (plan: DeleteCommit, range: ExportSelectionRange): Promise<boolean> => {
      const span = formatSelectionSpan(range.durationMs)
      // The last word, and a destructive one: the dialog names what goes and
      // from where, and says there is no way back.
      const proceed = await confirm({
        title: t('v2.deleteSelection.confirmTitle', { span, camera: cameraName }),
        message: t('v2.deleteSelection.confirmMessage'),
        confirmLabel: t('v2.deleteSelection.confirmLabel'),
        cancelLabel: t('common.cancel'),
        destructive: true,
      })
      if (!proceed) return false
      log.info('recording', 'deleteFootprint from timeline selection', {
        deviceId,
        fromMs: plan.request.fromMs,
        toMs: plan.request.toMs,
      })
      const result = await deleteFootprint.mutateAsync(plan.request)
      void queryClient.invalidateQueries({ queryKey: RECORDING_QUERIES })
      notice({
        title: t('v2.deleteSelection.title'),
        message:
          result === null
            ? t('v2.deleteSelection.failed')
            : t('v2.deleteSelection.done', { span, size: formatBytes(result.reclaimedBytes) }),
      })
      return true
    },
    [cameraName, confirm, deleteFootprint, deviceId, notice, queryClient, t],
  )

  const onSave = useCallback(
    (range: ExportSelectionRange, coverage: SelectionCoverage): void => {
      void (async () => {
        const plan = planSelectionCommit(kind, isAdmin, deviceId, range)
        if (plan.action === 'refuse') {
          playback.endSelection()
          return
        }
        // A hole in the footage never produces a silently short file. Only
        // `partial` asks — `covered` is fine and `unknown` must not block, an
        // unread coverage window being no evidence of an empty one (D315).
        // A DELETE over a hole needs no such warning: there is nothing to lose
        // where nothing was recorded, and its own dialog names the span.
        if (plan.action === 'export' && coverage === 'partial') {
          const proceed = await confirm({
            title: t('v2.exportSelection.gapTitle'),
            message: t('v2.exportSelection.gapMessage', {
              duration: formatSelectionDuration(range.durationMs),
            }),
            confirmLabel: t('v2.exportSelection.gapConfirm'),
            cancelLabel: t('common.cancel'),
          })
          // Refusing leaves the selection ARMED: the operator said no to this
          // range, not to the whole mode, and dropping the band would make them
          // draw it again.
          if (!proceed) return
        }
        // Declining the delete dialog leaves the selection ARMED, like
        // declining the gap warning: the operator refused this act, not the mode.
        let finished = true
        try {
          if (plan.action === 'export') await runExport(plan)
          else finished = await runDelete(plan, range)
        } catch {
          notice({
            title: t(plan.action === 'export' ? 'v2.exportSelection.title' : 'v2.deleteSelection.title'),
            message: t(plan.action === 'export' ? 'v2.exportSelection.failed' : 'v2.deleteSelection.failed'),
          })
        } finally {
          if (finished) playback.endSelection()
        }
      })()
    },
    [confirm, deviceId, isAdmin, kind, notice, playback, runDelete, runExport, t],
  )

  useEffect(() => {
    // The session dropped: close the mode rather than leave a Save button over
    // a range nothing can be created from. Leaving the SCREEN needs no handler —
    // the machine is the screen's own `useReducer` and dies with it.
    if (connectionState === 'connected') return
    if (playback.state.selectionAnchor === null) return
    playback.endSelection()
  }, [connectionState, playback])

  return useMemo(
    () => ({
      anchorMs: playback.state.selectionAnchor,
      kind,
      onBegin,
      onSave,
      onDiscard,
      saving: exportPending || deleteFootprint.isPending,
    }),
    [playback.state.selectionAnchor, kind, onBegin, onSave, onDiscard, exportPending, deleteFootprint.isPending],
  )
}
