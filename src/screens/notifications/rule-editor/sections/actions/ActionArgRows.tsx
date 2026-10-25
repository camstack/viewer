/**
 * ActionArgRows — a Do step's method arguments, one row per argument: a key,
 * a type, and the value AS TYPED.
 *
 * The admin's single JSON field re-derives its text from the last value that
 * parsed, so a keystroke that leaves the JSON half-written is thrown away and
 * the field snaps back under the cursor. Here the row holds the text itself
 * (`NcArgRow.text`) and it is parsed only at save (`rowsToArgs`): a half-typed
 * object stays exactly as typed — across leaving the screen, since the draft
 * holds it — and the row names its error until it parses.
 */
import React from 'react'
import { View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { SegmentedControl, type SegmentOption } from '../../../../../components/ui/SegmentedControl.js'
import { argRowError, newArgRow, removeAt, replaceAt } from '../../../../../components/notifications/rule-action-edit.js'
import type { NcArgRow, NcArgValueType } from '../../../../../components/notifications/rule-action-form.js'
import { SPACING } from '../../../../../theme/tokens.js'
import { ActionErrorLine, ActionLinkButton, ActionTextField } from './action-controls.js'

const UI = 'v2.nc.rules.editor.actions'
const ARG_TYPES: readonly NcArgValueType[] = ['string', 'number', 'boolean', 'json']

export interface ActionArgRowsProps {
  readonly rows: readonly NcArgRow[]
  readonly onChange: (next: readonly NcArgRow[]) => void
}

export function ActionArgRows({ rows, onChange }: ActionArgRowsProps) {
  const { t } = useTranslation()
  const typeOptions: readonly SegmentOption<NcArgValueType>[] = ARG_TYPES.map((value) => ({
    value,
    label: t(`${UI}.argType.${value}`),
  }))
  const set = (index: number, next: Partial<NcArgRow>): void => {
    const current = rows[index]
    if (current !== undefined) onChange(replaceAt(rows, index, { ...current, ...next }))
  }

  return (
    <View style={{ gap: SPACING.lg }}>
      {rows.map((row, index) => {
        const error = argRowError(rows, index)
        return (
          <View key={row.editId} style={{ gap: SPACING.sm }}>
            <ActionTextField
              value={row.key}
              onChangeText={(key) => set(index, { key })}
              placeholder={t(`${UI}.argKeyPlaceholder`)}
              accessibilityLabel={`${t(`${UI}.argsLabel`)} ${index + 1}: ${t(`${UI}.argKeyPlaceholder`)}`}
              invalid={error !== undefined && row.key.trim().length === 0}
            />
            <SegmentedControl<NcArgValueType>
              options={typeOptions}
              value={row.type}
              onChange={(type) => set(index, { type })}
            />
            <ActionTextField
              value={row.text}
              onChangeText={(text) => set(index, { text })}
              placeholder={t(`${UI}.argValuePlaceholder`)}
              accessibilityLabel={`${t(`${UI}.argsLabel`)} ${index + 1}: ${t(`${UI}.argValuePlaceholder`)}`}
              multiline={row.type === 'json'}
              code={row.type === 'json'}
              invalid={error !== undefined}
            />
            {error !== undefined ? <ActionErrorLine text={t(error)} /> : null}
            <ActionLinkButton
              kind="remove"
              label={t(`${UI}.removeArg`)}
              onPress={() => onChange(removeAt(rows, index))}
            />
          </View>
        )
      })}
      <ActionLinkButton kind="add" label={t(`${UI}.addArg`)} onPress={() => onChange([...rows, newArgRow(rows)])} />
    </View>
  )
}
