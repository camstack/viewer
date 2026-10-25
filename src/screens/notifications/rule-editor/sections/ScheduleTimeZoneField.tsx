/**
 * ScheduleTimeZoneField — which clock a rule's schedule windows are read on.
 *
 * Absent = the hub's own zone, offered as the first choice. Where the runtime
 * lists its zones (`Intl.supportedValuesOf`) this is a picker; where it cannot
 * (Hermes builds without it) it is a text box that writes only a zone the
 * runtime can resolve — a typo'd zone is not saved, and says so.
 */
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Section } from '../../../../components/ui/Section.js'
import { SelectRow, type SelectOption } from '../../../../components/ui/SelectRow.js'
import { LabeledInput } from '../../../../components/notifications/RuleFormFields.js'
import { isValidTimeZone, timeZoneChoices } from '../../../../components/notifications/rule-field-choices.js'
import type { NcSchedule } from '../../../../data/notification-center.js'
import { Hint } from './SectionHint.js'

/** The "hub's zone" value — never a real IANA name. */
const HUB_ZONE = ''
const ZONE = 'v2.nc.rules.editor.timezone'

export interface ScheduleTimeZoneFieldProps {
  readonly schedule: NcSchedule
  readonly onChange: (next: NcSchedule) => void
}

/** The schedule with `timezone` set, or removed for the hub's zone. */
function withZone(schedule: NcSchedule, zone: string): NcSchedule {
  // Spread, so a field the schedule gains later rides along untouched.
  const { timezone: _previous, ...rest } = schedule
  return zone === HUB_ZONE ? rest : { ...schedule, timezone: zone }
}

export function ScheduleTimeZoneField({ schedule, onChange }: ScheduleTimeZoneFieldProps) {
  const { t } = useTranslation()
  const [zones] = useState<readonly string[] | null>(timeZoneChoices)
  const [text, setText] = useState<string>(schedule.timezone ?? '')
  const stored = schedule.timezone ?? HUB_ZONE

  if (zones !== null) {
    const options: readonly SelectOption<string>[] = [
      { value: HUB_ZONE, label: t(`${ZONE}.hub`) },
      // A stored zone this runtime does not list still shows as itself.
      ...(stored !== HUB_ZONE && !zones.includes(stored) ? [{ value: stored, label: stored }] : []),
      ...zones.map((zone) => ({ value: zone, label: zone })),
    ]
    return (
      <Section title={t(`${ZONE}.label`)}>
        <SelectRow<string>
          label={t(`${ZONE}.pickerLabel`)}
          options={options}
          value={stored}
          onChange={(next) => onChange(withZone(schedule, next))}
        />
        <Hint text={t(`${ZONE}.hint`)} last />
      </Section>
    )
  }

  const trimmed = text.trim()
  const invalid = trimmed.length > 0 && !isValidTimeZone(trimmed)
  return (
    <Section title={t(`${ZONE}.label`)}>
      <LabeledInput
        label={t(`${ZONE}.pickerLabel`)}
        value={text}
        placeholder={t(`${ZONE}.placeholder`)}
        invalid={invalid}
        onChangeText={(next) => {
          setText(next)
          const zone = next.trim()
          if (zone.length === 0) onChange(withZone(schedule, HUB_ZONE))
          else if (isValidTimeZone(zone)) onChange(withZone(schedule, zone))
        }}
      />
      <Hint text={invalid ? t(`${ZONE}.invalid`) : t(`${ZONE}.hint`)} last />
    </Section>
  )
}
