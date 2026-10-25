/**
 * DevicesSection — which devices the rule watches: cameras for a camera kind,
 * the sensors for a sensor rule (`ruleDeviceSource`, narrowed by the rule's
 * `sensorKinds`). Its own sub-screen because every zone picker reads its
 * options from this selection.
 *
 * ONE field (D641): "All | Only these | All except these" over one picker,
 * bound to the form's `deviceScope` — `devices` and `devicesExclude` are never
 * two rows. "All except these" only where the hub serves the exclusion.
 */
import React, { useMemo } from 'react'
import { systemFamilyOfKind } from '@camstack/types/client'
import { useNcConditionTaxonomy } from '../../../../data/use-notification-center.js'
import { ConditionForm } from '../../../../components/notifications/ConditionForm.js'
import { conditionsForSection } from '../../../../components/notifications/rule-editor-sections.js'
import { ruleScopeExceptOffered } from '../../../../components/notifications/rule-scope-form.js'
import { ruleDeviceSource } from '../../../../components/notifications/rule-device-source.js'
import { ruleScopeList } from '../../../../components/notifications/rule-scope-model.js'
import { isStateSummaryForm } from '../../../../components/notifications/system-event-delivery.js'
import type { RuleSectionProps } from './section-props.js'

export function DevicesSection({ draft, patch, kind, catalog }: RuleSectionProps) {
  const taxonomyQuery = useNcConditionTaxonomy()
  const form = draft.form
  const sensorKinds = form.conditions.sensorKinds
  const source = useMemo(() => ruleDeviceSource(kind, sensorKinds), [kind, sensorKinds])
  const ids = useMemo(
    () => new Set(conditionsForSection('devices', kind, form.delivery, catalog).map((d) => d.id)),
    [kind, form.delivery, catalog],
  )
  return (
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
      includeDescriptor={(descriptor) => ids.has(descriptor.id)}
      systemFamily={systemFamilyOfKind(kind)}
      summary={isStateSummaryForm(form)}
      scopes={{
        devices: {
          draft: form.deviceScope,
          source,
          onChange: (next) => patch({ deviceScope: next }),
          exceptOffered: ruleScopeExceptOffered(catalog, 'devicesExclude', form.delivery, kind),
          savedHad:
            draft.baseline.deviceScope.mode === form.deviceScope.mode &&
            ruleScopeList(draft.baseline.deviceScope).length > 0,
        },
      }}
    />
  )
}
