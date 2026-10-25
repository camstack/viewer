/**
 * TimelapseEditorScreen — the `/timelapse-rule/[id]` route: create (`new`) or
 * edit a SCHEDULED TIMELAPSE rule from the phone, every field the admin
 * editor has (the operator's 2026-09-24 decision for full parity).
 *
 * One screen, so the draft is LOCAL state — the rule editor's draft store
 * exists because its sections are separate routes, and this has none. The
 * back guard is the rule summary's: `usePreventRemove` (which also holds the
 * iOS swipe and the Android back button) with the app's `useConfirm` prompt,
 * armed only while the form differs from what it opened on.
 *
 * ## The refusal that matters is the server's
 *
 * A timelapse renders RECORDED footage, so a camera that is not recording can
 * never produce one. The hub refuses that save and NAMES the camera; this
 * screen shows the message verbatim. Guessing the answer client-side would mean
 * a second recording authority, and the one thing worse than being refused at
 * save is being allowed and finding out at 06:05, when the window has closed
 * and does not come back.
 */
import React, { useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useNavigation, useRouter } from 'expo-router'
import { usePreventRemove } from 'expo-router/react-navigation'
import { useTheme } from '../../../theme/theme-provider.js'
import { RADIUS, SPACING } from '../../../theme/tokens.js'
import { useConfirm } from '../../../components/ui/confirm.js'
import { RuleErrorBanner, SaveBlockedNotice } from '../../../components/notifications/RuleFormFields.js'
import { useNcErrorText } from '../../../components/notifications/use-nc-error-text.js'
import { PruneBanner } from '../../../components/notifications/PruneBanner.js'
import { saveBlockReason, targetsReadState } from '../../../components/notifications/save-gate.js'
import {
  timelapseFormProblems,
  type TimelapseFormProblem,
  type TimelapseFormState,
} from '../../../components/notifications/timelapse-form.js'
import {
  useNcTargets,
  useNcTimelapseRules,
  useNcUpsertTimelapseRule,
  type UpsertTimelapseInput,
} from '../../../data/use-notification-center.js'
import type { NcViewerTimelapseRule } from '../../../data/notification-center.js'
import { targetSaveContext, unlistedTargetNote } from '../../../components/notifications/target-ownership.js'
import { useAdminVerdict } from '../../../data/use-me.js'
import { EditorNotice } from './EditorNotice.js'
import { EditorScroll } from './EditorScroll.js'
import { TimelapseFormSections } from './TimelapseFormSections.js'
import {
  isTimelapseFormDirty,
  resolveTimelapseSource,
  timelapseSaveRequest,
  type TimelapseSaveRequest,
} from './timelapse-source.js'
import { ConfirmFooter } from '../../../components/ui/Button.js'

/** Where a cold-started editor (opened by URL, nothing to go back to) lands. */
const NOTIFICATION_CENTER_PATH = '/settings/notifications'

export interface TimelapseEditorScreenProps {
  /** A rule id, or `new`. */
  readonly id: string
}

export function TimelapseEditorScreen({ id }: TimelapseEditorScreenProps) {
  const { t } = useTranslation()
  const router = useRouter()
  const rulesQuery = useNcTimelapseRules()
  const source = resolveTimelapseSource(id, rulesQuery.data, rulesQuery.isError)

  const back = (): void => {
    if (router.canGoBack()) router.back()
    else router.replace(NOTIFICATION_CENTER_PATH)
  }

  if (source.status !== 'ready') {
    const message =
      source.status === 'missing'
        ? t('v2.nc.rules.editor.missing')
        : source.status === 'failed'
          ? t('v2.nc.timelapse.loadError')
          : undefined
    // Never "New timelapse" over a rule that is loading, missing or unreadable.
    return (
      <EditorScroll title={t('v2.nc.timelapse.editorTitle')} onBack={back}>
        <EditorNotice message={message} />
      </EditorScroll>
    )
  }

  // Keyed on the rule so a list refresh that REPLACES the rule object does not
  // reseed a form the operator is typing into — only a different rule does.
  return (
    <TimelapseEditorForm
      key={source.rule?.id ?? 'new'}
      rule={source.rule}
      readOnly={source.readOnly}
      seed={source.seed}
      onLeave={back}
    />
  )
}

interface TimelapseEditorFormProps {
  readonly rule: NcViewerTimelapseRule | null
  readonly readOnly: boolean
  readonly seed: TimelapseFormState
  readonly onLeave: () => void
}

function TimelapseEditorForm({ rule, readOnly, seed, onLeave }: TimelapseEditorFormProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const navigation = useNavigation()
  const confirm = useConfirm()
  const targetsQuery = useNcTargets()
  const errorText = useNcErrorText()
  const upsert = useNcUpsertTimelapseRule()
  // Who is saving decides which stored targets survive (`target-ownership.ts`);
  // while that is unknown, Save waits rather than guessing either way.
  const verdict = useAdminVerdict()

  const [form, setForm] = useState<TimelapseFormState>(seed)
  const [showInvalid, setShowInvalid] = useState(false)
  const leavingRef = useRef(false)

  const ownTargets = useMemo(() => targetsQuery.data ?? [], [targetsQuery.data])
  const ownTargetIds = useMemo(() => ownTargets.map((target) => target.id), [ownTargets])
  const targetOptions = useMemo(
    () => ownTargets.map((target) => ({ id: target.id, name: target.name })),
    [ownTargets],
  )

  const dirty = !readOnly && isTimelapseFormDirty(form, seed)
  usePreventRemove(dirty, ({ data }) => {
    if (leavingRef.current) {
      navigation.dispatch(data.action)
      return
    }
    void confirm({
      title: t('v2.nc.rules.editor.unsaved.title'),
      message: t('v2.nc.rules.editor.unsaved.body'),
      confirmLabel: t('v2.nc.rules.editor.unsaved.discard'),
      cancelLabel: t('v2.nc.rules.editor.unsaved.keep'),
      destructive: true,
    }).then((ok) => {
      if (!ok) return
      leavingRef.current = true
      navigation.dispatch(data.action)
    })
  })

  const update = (patch: Partial<TimelapseFormState>): void => setForm((prev) => ({ ...prev, ...patch }))

  // Counts the targets the save will SEND once role and list answered (m3).
  const problems = timelapseFormProblems(
    form,
    targetSaveContext(verdict, targetsQuery.data?.map((tgt) => tgt.id), rule?.targets ?? []),
  )
  // Shown only after a refused Save: a form that is red before it has been
  // filled in teaches the operator to ignore the colour.
  const shows = (problem: TimelapseFormProblem): boolean => showInvalid && problems.includes(problem)
  // A hub refusal verbatim; the app's own errors (not connected, a hub too
  // old to clear a field) translated.
  const serverError = errorText(upsert.error)
  // The role and the caller's own targets decide which stored targets a save
  // keeps; until both have ANSWERED, Save waits and says why (`save-gate.ts`).
  const blockReason = saveBlockReason(verdict, targetsReadState(targetsQuery))
  const saveBlocked = upsert.isPending || blockReason !== undefined
  const unlisted =
    rule !== null ? unlistedTargetNote(rule.targets, targetsQuery.data?.map((tgt) => tgt.id), verdict) : undefined

  const leave = (): void => {
    leavingRef.current = true
    onLeave()
  }

  const handleSave = (): void => {
    if (problems.length > 0) {
      setShowInvalid(true)
      return
    }
    if (saveBlocked) return
    const request = timelapseSaveRequest(form, rule, { ownTargetIds, isAdmin: verdict === 'admin' })
    if (request.mode === 'unchanged') {
      leave()
      return
    }
    upsert.mutate(upsertInputFor(request), { onSuccess: leave })
  }

  return (
    <EditorScroll
      title={rule ? t('v2.nc.timelapse.editTitle', { name: rule.name }) : t('v2.nc.timelapse.createTitle')}
      onBack={onLeave}
    >
      {readOnly ? (
        <Text style={{ color: colors.foregroundSubtle, fontSize: 13, lineHeight: 18 }}>
          {t('v2.nc.rules.editor.readOnly')}
        </Text>
      ) : null}

      {rule ? <PruneBanner kind="timelapse" ruleId={rule.id} enabled={rule.enabled} updatedAt={rule.updatedAt} /> : null}

      {serverError ? <RuleErrorBanner message={serverError} /> : null}

      <View style={{ pointerEvents: readOnly ? 'none' : 'auto' }}>
        <TimelapseFormSections
          form={form}
          update={update}
          shows={shows}
          targets={targetOptions}
          targetsReadState={targetsReadState(targetsQuery)}
          unlisted={unlisted}
          storedNoCaption={rule?.previewText === ''}
        />
      </View>

      {readOnly ? null : <SaveBlockedNotice reason={blockReason} />}

      <ConfirmFooter
        cancelLabel={t('v2.nc.rules.cancel')}
        onCancel={onLeave}
        {...(readOnly
          ? {}
          : {
              confirmLabel: rule ? t('v2.nc.rules.editor.save') : t('v2.nc.rules.editor.create'),
              onConfirm: handleSave,
              confirmDisabled: saveBlocked,
              busy: upsert.isPending,
            })}
      />
    </EditorScroll>
  )
}

/** The mutation's input for a request that sends something. */
function upsertInputFor(request: Exclude<TimelapseSaveRequest, { mode: 'unchanged' }>): UpsertTimelapseInput {
  if (request.mode === 'create') return { rule: request.rule }
  return { ruleId: request.ruleId, patch: request.patch, clear: request.clear }
}
