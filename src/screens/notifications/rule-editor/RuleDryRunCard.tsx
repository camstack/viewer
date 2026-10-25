/**
 * RuleDryRunCard — evaluate the CURRENT draft against the last hour of
 * persisted records. Sends nothing.
 *
 * The draft goes through `ruleDryRunInput` — the conversion a save sends — so
 * what is tested is what Save would write, never a second reading of the form.
 * A result describes the form it was run on: an edit afterwards clears it, or
 * the list would answer for a rule that no longer exists.
 *
 * Mounted by the caller for a CONFIRMED admin only, and never for a system
 * rule: the dry-run replays detection records, and there is none behind "a
 * node went offline" — it would answer "nothing matched" for a working rule.
 */
import React, { useEffect, useMemo } from 'react'
import { Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../../theme/theme-provider.js'
import { useDateLocale } from '../../../lib/date-locale.js'
import { SPACING } from '../../../theme/tokens.js'
import { useNcTargets } from '../../../data/use-notification-center.js'
import { useNcDryRunRule } from '../../../data/use-nc-rule-test.js'
import type { NcConditionDescriptor, NcDryRunRecord, NcViewerRule } from '../../../data/notification-center.js'
import { isRuleFormValid, type NcRuleFormState } from '../../../components/notifications/rule-editor.js'
import { RuleErrorBanner } from '../../../components/notifications/RuleFormFields.js'
import { targetsReadState } from '../../../components/notifications/save-gate.js'
import { targetSaveContext } from '../../../components/notifications/target-ownership.js'
import { useNcErrorText } from '../../../components/notifications/use-nc-error-text.js'
import { dryRunRecordLine, dryRunSummaryLine } from '../../../components/notifications/rule-test-result.js'
import { ruleDryRunInput } from './rule-draft-source.js'
import { RuleTestCard } from './RuleTestCard.js'

/** How many evaluated records are drawn — the admin editor's cap. */
const DRY_RUN_ROWS_MAX = 50

export interface RuleDryRunCardProps {
  readonly form: NcRuleFormState
  readonly rule: NcViewerRule | null
  readonly catalog: readonly NcConditionDescriptor[]
}

export function RuleDryRunCard({ form, rule, catalog }: RuleDryRunCardProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const targetsQuery = useNcTargets()
  const dryRun = useNcDryRunRule()
  const errorText = useNcErrorText()
  const { reset } = dryRun
  const ownTargetIds = useMemo(() => (targetsQuery.data ?? []).map((tgt) => tgt.id), [targetsQuery.data])
  const valid = isRuleFormValid(form, {
    isAdmin: true,
    targets: targetSaveContext('admin', targetsQuery.data?.map((tgt) => tgt.id), rule?.targets ?? []),
  })
  // The targets list decides which ids travel; running before it answered
  // would test a rule with no targets. A FAILED list will not fix itself, so
  // the disabled button says why (final review m5).
  const targetsState = targetsReadState(targetsQuery)

  useEffect(() => reset(), [form, reset])

  const run = (): void => {
    dryRun.mutate({ rule: ruleDryRunInput(form, rule, { ownTargetIds, catalog, isAdmin: true }) })
  }
  const results = dryRun.data
  const summary = results !== undefined ? dryRunSummaryLine(results, form.delivery) : undefined

  return (
    <RuleTestCard
      title={t('v2.nc.rules.test.title')}
      hint={valid ? t('v2.nc.rules.test.dryRun.hint') : t('v2.nc.rules.test.dryRun.incomplete')}
      buttonLabel={t('v2.nc.rules.test.dryRun.button')}
      busy={dryRun.isPending}
      disabled={!valid || targetsState !== 'answered'}
      onPress={run}
    >
      {targetsState === 'failed' ? <RuleErrorBanner message={t('v2.nc.rules.test.dryRun.targetsFailed')} /> : null}
      {dryRun.error ? (
        <RuleErrorBanner message={t('v2.nc.rules.test.unavailable', { message: errorText(dryRun.error) })} />
      ) : null}
      {results !== undefined ? (
        <View style={{ gap: SPACING.sm }}>
          <Text style={{ color: colors.foreground, fontSize: 13, lineHeight: 18 }}>
            {summary !== undefined ? t(summary.key, summary.params) : null}
          </Text>
          {form.delivery === 'device-event'
            ? null
            : results.slice(0, DRY_RUN_ROWS_MAX).map((record) => <DryRunRow key={record.recordId} record={record} />)}
          {form.delivery !== 'device-event' && results.length > DRY_RUN_ROWS_MAX ? (
            <Text style={{ color: colors.foregroundSubtle, fontSize: 12 }}>
              {t('v2.nc.rules.test.dryRun.more', { shown: DRY_RUN_ROWS_MAX, total: results.length })}
            </Text>
          ) : null}
        </View>
      ) : null}
    </RuleTestCard>
  )
}

interface DryRunRowProps {
  readonly record: NcDryRunRecord
}

function DryRunRow({ record }: DryRunRowProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  // The app's language, never the runtime's (see `lib/date-locale.ts`).
  const dateLocale = useDateLocale()
  const line = dryRunRecordLine(record)
  const subject = record.label ?? record.className ?? record.recordKind
  return (
    <View style={{ gap: 2 }}>
      <Text style={{ color: record.wouldFire ? colors.success : colors.foreground, fontSize: 12, fontWeight: '600' }}>
        {t(line.key, line.params)}
      </Text>
      <Text style={{ color: colors.foregroundSubtle, fontSize: 11 }}>
        {`${new Date(record.timestamp).toLocaleString(dateLocale)} · #${String(record.deviceId)} · ${subject}`}
      </Text>
    </View>
  )
}
