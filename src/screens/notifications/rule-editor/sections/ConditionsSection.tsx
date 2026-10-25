/**
 * ConditionsSection — what makes THIS kind of rule fire.
 *
 * The descriptors come from `conditionsForSection('conditions', …)`: no device
 * scope (its own sub-screen), never another kind's discriminator, and not the
 * detection source nor the zone crossing (the Advanced section's). Every one
 * of them is ALWAYS visible (operator, 2026-10-01: no "show advanced" toggle).
 * A confirmed admin also gets the dry-run of the unsaved draft, at the bottom.
 */
import React, { useMemo } from 'react'
import { Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { systemFamilyOfKind } from '@camstack/types/client'
import { useTheme } from '../../../../theme/theme-provider.js'
import { SPACING } from '../../../../theme/tokens.js'
import { useNcConditionTaxonomy } from '../../../../data/use-notification-center.js'
import { useAdminVerdict } from '../../../../data/use-me.js'
import { ConditionForm } from '../../../../components/notifications/ConditionForm.js'
import {
  conditionsForSection,
  editorSectionLabelKey,
  kindBlurbKey,
} from '../../../../components/notifications/rule-editor-sections.js'
import type { NcConditionDescriptor } from '../../../../data/notification-center.js'
import type { RuleSectionProps } from './section-props.js'
import { ScheduleTimeZoneField } from './ScheduleTimeZoneField.js'
import { RuleDryRunCard } from '../RuleDryRunCard.js'
import { canDryRun } from '../../../../components/notifications/rule-test-result.js'
import { formToActions } from '../../../../components/notifications/rule-action-form.js'
import { sequenceResolver } from '../../../../components/notifications/rule-field-choices.js'
import { useSharedSequences } from '../../../../data/use-shared-sequences.js'
import { formScopedDeviceIds, ruleScopeExceptOffered } from '../../../../components/notifications/rule-scope-form.js'
import { ruleScopeList, type RuleScopeDraft } from '../../../../components/notifications/rule-scope-model.js'
import type { ConditionFormScopes } from '../../../../components/notifications/ConditionForm.js'
import type { NcRuleFormState } from '../../../../components/notifications/rule-editor.js'
import {
  isStateSummaryForm,
  summaryDeliveryOffered,
  withSummarySchedule,
} from '../../../../components/notifications/system-event-delivery.js'
import { SystemEventDeliveryField } from './SystemEventDeliveryField.js'
import { SectionLabel } from '../../../../components/ui/SectionLabel.js'

/** The form's scope drafts over string ids — the ones this section binds. */
type ScopeDraftKey = {
  [K in keyof NcRuleFormState]: NcRuleFormState[K] extends RuleScopeDraft<string> ? K : never
}[keyof NcRuleFormState]

export function ConditionsSection({ draft, patch, kind, catalog, rule }: RuleSectionProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const taxonomyQuery = useNcConditionTaxonomy()
  const verdict = useAdminVerdict()
  const form = draft.form

  // A SUMMARY rule is sent on its summary schedule (D647): the active-hours
  // schedule is not one of its controls (and a save neither sends nor keeps it).
  const summary = isStateSummaryForm(form)
  const ids = useMemo(
    () =>
      new Set(
        conditionsForSection('conditions', kind, form.delivery, catalog)
          .map((d) => d.id)
          .filter((id) => !summary || id !== 'schedule'),
      ),
    [kind, form.delivery, catalog, summary],
  )
  // No blurb row at all for a kind without one — never an empty line.
  const blurb = t(kindBlurbKey(kind), { defaultValue: '' })
  // Each scope is ONE field over its include / exclude pair (D641), bound to
  // the form's draft — never to `conditions`.
  const savedHad = (key: ScopeDraftKey): boolean =>
    draft.baseline[key].mode === form[key].mode && ruleScopeList(draft.baseline[key]).length > 0
  const scopes: ConditionFormScopes = {
    classes: {
      draft: form.classScope,
      onChange: (next) => patch({ classScope: next }),
      exceptOffered: ruleScopeExceptOffered(catalog, 'classesExclude', form.delivery, kind),
      savedHad: savedHad('classScope'),
    },
    zones: {
      draft: form.zoneScope,
      onChange: (next) => patch({ zoneScope: next }),
      exceptOffered: ruleScopeExceptOffered(catalog, 'zonesExclude', form.delivery, kind),
      savedHad: savedHad('zoneScope'),
      deviceScope: form.deviceScope,
    },
    identities: {
      draft: form.identityScope,
      onChange: (next) => patch({ identityScope: next }),
      exceptOffered: ruleScopeExceptOffered(catalog, 'identitiesExclude', form.delivery, kind),
    },
    labels: {
      draft: form.labelScope,
      onChange: (next) => patch({ labelScope: next }),
      // The hub has no label exclusion.
      exceptOffered: false,
    },
  }
  const deviceIds = formScopedDeviceIds(form)
  // The alarm half of "Notify when"'s never-fires warning (D640 × D630).
  // A sequence binding proves membership only through the shared list
  // (admin-only read) — the admin's `sequenceActionsOf`.
  const sharedSequences = useSharedSequences(verdict === 'admin').data
  const actions = formToActions(form.actions).actions
  const alarmActions = {
    ...(actions !== undefined ? { actions } : {}),
    ...(sharedSequences !== undefined ? { sequenceActionsOf: sequenceResolver(sharedSequences) } : {}),
  }

  const conditionForm = (
    <ConditionForm
      catalog={catalog}
      delivery={form.delivery}
      kind={kind}
      conditions={form.conditions}
      savedConditions={draft.baseline.conditions}
      schedule={form.schedule}
      taxonomy={taxonomyQuery.data}
      onConditionsChange={(next) => patch({ conditions: next })}
      onScheduleChange={(next) => patch({ schedule: next })}
      includeDescriptor={(descriptor: NcConditionDescriptor) => ids.has(descriptor.id)}
      systemFamily={systemFamilyOfKind(kind)}
      scopes={scopes}
      deviceIds={deviceIds}
      alarmActions={alarmActions}
      summary={summary}
    />
  )

  return (
    <View style={{ gap: SPACING.lg }} testID="rule-conditions-section">
      <SectionLabel inset>{t(editorSectionLabelKey('conditions', kind))}</SectionLabel>
      {blurb.length > 0 ? (
        <Text style={{ color: colors.foregroundSubtle, fontSize: 12, lineHeight: 17, paddingHorizontal: SPACING.xs }}>
          {blurb}
        </Text>
      ) : null}
      {conditionForm}

      {summaryDeliveryOffered(kind) ? (
        <SystemEventDeliveryField
          value={form.systemEventDelivery}
          onChange={(next) => patch({ systemEventDelivery: next })}
        />
      ) : null}

      {/* The zone the windows are read in — only once there ARE windows: the
          summary's send times on a summary rule, the active hours otherwise. */}
      {form.systemEventDelivery?.mode === 'summary' && summary ? (
        <ScheduleTimeZoneField
          schedule={form.systemEventDelivery.schedule}
          onChange={(next) => {
            // The zone edit keeps the split (D698): rebuilding the delivery
            // from `{ mode, schedule }` would drop it.
            if (form.systemEventDelivery?.mode === 'summary') {
              patch({ systemEventDelivery: withSummarySchedule(form.systemEventDelivery, next) })
            }
          }}
        />
      ) : form.schedule !== undefined ? (
        <ScheduleTimeZoneField schedule={form.schedule} onChange={(next) => patch({ schedule: next })} />
      ) : null}

      {canDryRun(verdict, kind) ? <RuleDryRunCard form={form} rule={rule} catalog={catalog} /> : null}
    </View>
  )
}
