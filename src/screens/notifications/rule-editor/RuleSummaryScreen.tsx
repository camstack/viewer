/**
 * RuleSummaryScreen — the rule editor's home route (`/rule/[id]`).
 *
 * One row per section this kind of rule has (the shared order, per kind, never
 * mixed), each saying what it holds and opening its sub-screen. Save and
 * Cancel live here and only here; sub-screens edit the shared draft and pop.
 *
 * THE BACK GUARD is on this screen only. A sub-screen never prompts, because
 * the draft survives its pop. Leaving the summary with unsaved changes asks
 * first — the header button, Android back and the iOS swipe alike
 * (`usePreventRemove` also tells the native stack to hold the swipe).
 *
 * A READ-ONLY rule (an admin rule, for a non-admin) is shown, never saved: no
 * Save, no sub-screens, a notice saying why. Save on an incomplete form is not
 * disabled silently — pressing it names what is missing and turns those
 * fields red.
 *
 * A confirmed admin editing a SAVED rule also gets "Test now", which really
 * delivers — it asks first.
 */
import React, { useEffect, useMemo, useRef } from 'react'
import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useNavigation, useRouter } from 'expo-router'
import { usePreventRemove } from 'expo-router/react-navigation'
import { ChevronRight } from '../../../lib/icons.js'
import { useTheme } from '../../../theme/theme-provider.js'
import { RADIUS, SPACING } from '../../../theme/tokens.js'
import { useConfirm } from '../../../components/ui/confirm.js'
import { useAdminVerdict } from '../../../data/use-me.js'
import { useNcConditionTaxonomy, useNcTargets } from '../../../data/use-notification-center.js'
import { RuleErrorBanner, SaveBlockedNotice } from '../../../components/notifications/RuleFormFields.js'
import { PruneBanner } from '../../../components/notifications/PruneBanner.js'
import { editorSectionsFor } from '../../../components/notifications/rule-editor-sections.js'
import { kindLabelKey } from '../../../components/notifications/rule-kind-nav.js'
import {
  sectionSummary,
  summaryClassLabels,
  type SummaryContext,
} from '../../../components/notifications/rule-summary-lines.js'
import { droppedRuleConditions, dropReasonKey } from '../../../components/notifications/rule-editor.js'
import { ruleSectionHref } from '../../../navigation/rule-routes.js'
import { isDraftDirty } from '../../../store/nc-rule-draft-store.js'
import { EditorNotice } from './EditorNotice.js'
import { EditorScroll } from './EditorScroll.js'
import { RuleTestNowCard } from './RuleTestNowCard.js'
import { RuleDevicesList } from './RuleDevicesList.js'
import { canTestNow } from '../../../components/notifications/rule-test-result.js'
import { adoptedRuleRoute, ruleFormProblems } from './rule-draft-source.js'
import { targetSaveContext } from '../../../components/notifications/target-ownership.js'
import { useRuleDraft, useSummaryHold } from './use-rule-draft.js'
import { ConfirmFooter } from '../../../components/ui/Button.js'

export interface RuleSummaryScreenProps {
  readonly id: string
  readonly kind?: string
}

export function RuleSummaryScreen({ id, kind: kindParam }: RuleSummaryScreenProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const router = useRouter()
  const navigation = useNavigation()
  const confirm = useConfirm()
  const verdict = useAdminVerdict()
  const targetsQuery = useNcTargets()
  const editor = useRuleDraft({ id, kind: kindParam })
  const { draft, kind, rule, discard } = editor
  const leavingRef = useRef(false)
  useSummaryHold(editor.draftKey)

  const dirty = draft !== undefined && isDraftDirty(draft)
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
      discard()
      navigation.dispatch(data.action)
    })
  })

  // A draft never outlives its summary: leaving with no changes drops it too,
  // so the next open reads the rule as the hub has it now.
  useEffect(() => () => discard(), [discard])

  // The class labels come from the same taxonomy the class scope field draws.
  const taxonomyQuery = useNcConditionTaxonomy()
  const summaryContext = useMemo<SummaryContext>(
    () => ({
      targetNames: new Map((targetsQuery.data ?? []).map((tgt) => [tgt.id, tgt.name])),
      cooldownSec: rule?.throttle.cooldownSec,
      classLabels: summaryClassLabels(taxonomyQuery.data),
      deviceNoun: kind === 'sensor' ? 'sensors' : 'cameras',
    }),
    [targetsQuery.data, rule, taxonomyQuery.data, kind],
  )

  const handleSave = (): void => {
    editor
      .save()
      .then(() => {
        leavingRef.current = true
        router.back()
      })
      .catch((error: unknown) => {
        // A NEW rule the hub stored before refusing its summary: this is no
        // longer a "new" screen — it becomes the stored rule's editor, with
        // the draft (moved under its id) and the notice riding along.
        const next = adoptedRuleRoute(id, error)
        if (next === null) return // refused: the error or the missing-field list is on screen
        leavingRef.current = true
        router.replace(next)
      })
  }

  const title = rule ? rule.name : t('v2.nc.rules.kindPicker.title')
  const back = (): void => router.back()

  if (editor.status !== 'ready' || draft === undefined || kind === undefined || verdict === 'pending') {
    return (
      <EditorScroll title={title} onBack={back}>
        <EditorNotice
          message={
            editor.status === 'missing'
              ? t('v2.nc.rules.editor.missing')
              : editor.status === 'failed'
                ? t('v2.nc.rules.editor.loadError')
                : undefined
          }
        />
      </EditorScroll>
    )
  }

  const form = draft.form
  const dropped = droppedRuleConditions(form)
  const targetContext = targetSaveContext(verdict, targetsQuery.data?.map((tgt) => tgt.id), rule?.targets ?? [])
  const problems = draft.saveAttempted
    ? ruleFormProblems(form, { isAdmin: verdict === 'admin', targets: targetContext })
    : []
  const readOnly = editor.readOnly
  const saveDisabled = editor.saving || editor.saveBlock !== undefined

  return (
    <EditorScroll title={form.name.trim().length > 0 ? form.name : title} onBack={back}>
      <View
        style={{
          alignSelf: 'flex-start',
          borderRadius: RADIUS.xl,
          borderWidth: 1,
          borderColor: colors.border,
          paddingHorizontal: SPACING.lg,
          paddingVertical: SPACING.xs,
        }}
      >
        <Text style={{ color: colors.foregroundSubtle, fontSize: 12, fontWeight: '600' }}>
          {t(kindLabelKey(kind))}
        </Text>
      </View>

      {readOnly ? (
        <Text style={{ color: colors.foregroundSubtle, fontSize: 13, lineHeight: 18 }}>
          {t('v2.nc.rules.editor.readOnly')}
        </Text>
      ) : null}

      {rule ? <PruneBanner kind="rule" ruleId={rule.id} enabled={rule.enabled} updatedAt={rule.updatedAt} /> : null}

      {editor.error ? <RuleErrorBanner message={editor.error} /> : null}

      {problems.length > 0 ? (
        <RuleErrorBanner
          message={[
            t('v2.nc.rules.editor.problem.title'),
            ...problems.map((problem) => `• ${t(`v2.nc.rules.editor.problem.${problem}`)}`),
          ].join('\n')}
        />
      ) : null}

      {/* Said BEFORE the save, never discovered after it: each entry is a
          condition the engine fails CLOSED on this rule's subject. */}
      {dropped.length > 0 ? (
        <View
          style={{
            backgroundColor: `${colors.warning}1a`,
            borderColor: colors.warning,
            borderWidth: 1,
            borderRadius: RADIUS.md,
            paddingHorizontal: SPACING.lg,
            paddingVertical: SPACING.md,
            gap: SPACING.sm,
          }}
        >
          <Text style={{ color: colors.warning, fontSize: 13, fontWeight: '600' }}>
            {t('v2.nc.rules.editor.dropTitle')}
          </Text>
          <Text style={{ color: colors.foregroundSubtle, fontSize: 12, lineHeight: 17 }}>
            {t('v2.nc.rules.editor.dropHint')}
          </Text>
          {dropped.map((entry) => (
            <View key={entry.conditionId} style={{ gap: 2 }}>
              <Text style={{ color: colors.foreground, fontSize: 12, fontWeight: '500' }}>
                {t(`v2.nc.rules.editor.condition.${entry.conditionId}`, { defaultValue: entry.conditionId })}
              </Text>
              <Text style={{ color: colors.foregroundSubtle, fontSize: 11, lineHeight: 15 }}>
                {t(dropReasonKey(kind, entry.conditionId), { defaultValue: entry.reason })}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      <View
        style={{
          borderRadius: RADIUS.lg,
          borderWidth: 1,
          borderColor: colors.border,
          overflow: 'hidden',
        }}
      >
        {editorSectionsFor(kind, verdict === 'admin').map((section, index) => {
          const line = sectionSummary(section.key, form, summaryContext)
          return (
            <React.Fragment key={section.key}>
              <Pressable
                accessibilityRole="button"
                disabled={readOnly}
                onPress={() => router.push(ruleSectionHref(id, section.key, kind))}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: SPACING.md,
                  paddingHorizontal: SPACING.lg,
                  paddingVertical: SPACING.md,
                  borderTopWidth: index === 0 ? 0 : 1,
                  borderTopColor: colors.border,
                }}
              >
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ color: colors.foreground, fontSize: 15, fontWeight: '600' }}>
                    {t(section.titleKey)}
                  </Text>
                  <Text style={{ color: colors.foregroundSubtle, fontSize: 12 }} numberOfLines={2}>
                    {t(line.key, line.params)}
                  </Text>
                </View>
                {readOnly ? null : <ChevronRight size={18} color={colors.foregroundSubtle} />}
              </Pressable>
              {/* The devices this rule is active on — always listed, never folded. */}
              {section.key === 'devices' ? <RuleDevicesList scope={form.deviceScope} divided /> : null}
            </React.Fragment>
          )
        })}
      </View>

      {/* Fires the SAVED rule for real: a confirmed admin and a stored rule
          only — a new rule has no id, and the hub tests only what it stored. */}
      {canTestNow(verdict, readOnly, rule) ? <RuleTestNowCard rule={rule} /> : null}

      {readOnly ? null : <SaveBlockedNotice reason={editor.saveBlock} />}

      <ConfirmFooter
        cancelLabel={readOnly ? t('v2.common.back') : t('v2.nc.rules.cancel')}
        onCancel={back}
        {...(readOnly
          ? {}
          : {
              confirmLabel: rule ? t('v2.nc.rules.editor.save') : t('v2.nc.rules.editor.create'),
              onConfirm: handleSave,
              confirmDisabled: saveDisabled,
              busy: editor.saving,
            })}
      />
    </EditorScroll>
  )
}
