/**
 * FamilyRuleRow — one TIMELAPSE or DIGEST rule as a settings card.
 *
 * The same card as {@link RuleRow}, built from the same parts: the Rules tab
 * mixes the two kinds of card, and the operator's report that started this work
 * was that the app's notification surfaces did not resemble each other. So the
 * title is the shared {@link RuleTitle} (the name alone on its line, the kind /
 * ownership / off words under it) and the controls are the shared
 * {@link RuleActionRow}: the Enabled switch, Edit and Delete in ONE row for a
 * rule the caller can edit, none of them for a read-only one.
 *
 * What differs from a detection rule's card is what these two families ARE:
 * they have no per-target opt-out (there is nothing to opt out of between
 * windows) and they deliver HOURS after the window they are about — so under
 * the title the card says whether the rule has ever produced anything, which
 * is the question that would otherwise be unanswerable from the app.
 *
 * Presentational: the parent owns every mutation.
 */
import React, { useMemo } from 'react'
import { Pressable, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../theme/theme-provider.js'
import { Section } from '../ui/Section.js'
import { SPACING } from '../../theme/tokens.js'
import { buildFamilyRowModel, familyStatusKey } from './family-row.js'
import { sectionLabelKey, type NcViewerFamilySection } from './rule-sections.js'
import { RuleTitle, type RuleTitleHistory } from './RuleTitle.js'
import { RuleActionRow } from './RuleActionRow.js'

export interface FamilyRuleRowProps {
  readonly ruleId: string
  /** Which family the rule belongs to — its word on the kind chip. */
  readonly family: NcViewerFamilySection
  readonly name: string
  /** The server's per-row verdict — see `family-row.ts`. */
  readonly readOnly: boolean
  readonly enabled: boolean
  readonly deviceCount: number
  /** Epoch-ms of the last successful production. Absent/0 = never. */
  readonly generatedAt?: number
  readonly onEdit: () => void
  readonly onDelete: () => void
  /**
   * Switch the rule on or off. Resolves once the hub's answer is in the list,
   * rejects when the hub refused or did not apply it.
   */
  readonly onSetEnabled: (enabled: boolean) => Promise<unknown>
  /** The admin-only last-run line under the title; absent for anyone else. */
  readonly history?: RuleTitleHistory
}

export function FamilyRuleRow({
  ruleId,
  family,
  name,
  readOnly,
  enabled,
  deviceCount,
  generatedAt,
  onEdit,
  onDelete,
  onSetEnabled,
  history,
}: FamilyRuleRowProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const model = useMemo(
    () => buildFamilyRowModel({ readOnly, enabled, deviceCount, kindLabelKey: sectionLabelKey(family) }),
    [readOnly, enabled, deviceCount, family],
  )

  // The WHOLE card opens the editor (operator, 2026-10-01) — only where Edit
  // is offered: a read-only family rule has no read-only screen to open.
  const card = (
    <Section>
      <RuleTitle
        ruleId={ruleId}
        name={name}
        header={model.header}
        enabled={model.enabled}
        onPress={model.actions.edit ? onEdit : undefined}
        history={history}
      />

      <View style={{ paddingHorizontal: SPACING.xl, paddingVertical: SPACING.md, gap: 2 }}>
        <Text style={{ color: colors.foregroundSubtle, fontSize: 12, lineHeight: 16 }}>
          {t('v2.nc.family.cameras', { count: model.deviceCount })}
        </Text>
        <Text style={{ color: colors.foregroundSubtle, fontSize: 12, lineHeight: 16 }}>
          {t(familyStatusKey(generatedAt), {
            when: generatedAt === undefined ? '' : new Date(generatedAt).toLocaleString(),
          })}
        </Text>
      </View>

      {model.editable ? (
        <RuleActionRow
          ruleId={ruleId}
          name={name}
          actions={model.actions}
          enabled={model.enabled}
          divided
          onEdit={onEdit}
          onDelete={onDelete}
          onSetEnabled={onSetEnabled}
        />
      ) : (
        <View style={{ paddingHorizontal: SPACING.xl, paddingBottom: SPACING.lg }}>
          <Text style={{ color: colors.foregroundSubtle, fontSize: 12, lineHeight: 16 }}>
            {t('v2.nc.family.readOnly')}
          </Text>
        </View>
      )}
    </Section>
  )
  if (!model.actions.edit) return card
  return (
    // Not one accessibility element: its controls stay reachable (see RuleRow).
    <Pressable testID={`rule-row-${ruleId}`} accessible={false} onPress={onEdit}>
      {card}
    </Pressable>
  )
}
