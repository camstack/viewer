/**
 * RuleTitle — the title of every rule card in the Rules tab: detection rules
 * ({@link RuleRow}) and the timelapse / digest families ({@link FamilyRuleRow})
 * alike, so the cards the tab mixes read as one list.
 *
 * The NAME sits on its own line (only the chevron beside it, when the title
 * opens something) and wraps to `header.nameMaxLines`; under it, the kind chip,
 * the ownership word and — for an off rule whose card has no Enabled switch —
 * the off notice (`ruleHeaderFor`; the switch says it otherwise). Operator,
 * 2026-09-26: with all five on one line the notice took the width and an off
 * rule read "Alla…". The line below wraps, so no word there can ever cost the
 * name its characters. An off rule's name is dimmed AND the notice says so in
 * full colour — dimming alone reads as "loading".
 *
 * For an ADMIN viewer the title also carries the rule's LAST RUN
 * ({@link RuleLastRunRow}), which doubles as the door to its delivery history.
 * It sits here, in the part both cards share, so a detection card and a
 * timelapse card answer "when did this last fire?" the same way; it is a
 * sibling of the title's pressable, never nested inside it.
 */
import React from 'react'
import { Pressable, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { ChevronRight } from '../../lib/icons.js'
import { useTheme } from '../../theme/theme-provider.js'
import { RADIUS, SPACING, type ColorTokens } from '../../theme/tokens.js'
import type { RuleHeaderModel, RuleHeaderTone } from './rule-row.js'
import type { RuleLastRunLine } from './rule-last-run.js'
import { RuleLastRunRow } from './RuleLastRunRow.js'
import { summaryDeliveryLabel } from './system-event-delivery.js'

/** The last-run line and where it leads. Absent = this viewer has none. */
export interface RuleTitleHistory {
  readonly line: RuleLastRunLine
  /** The list's clock (`useMinuteClock`). */
  readonly nowMs: number
  readonly onOpen: () => void
}

interface RuleTitleProps {
  readonly ruleId: string
  readonly name: string
  readonly header: RuleHeaderModel
  readonly enabled: boolean
  /** Makes the title a button with a chevron; absent, it is plain text. */
  readonly onPress?: () => void
  /** The admin-only last-run line (`undefined` for anyone else). */
  readonly history?: RuleTitleHistory
}

/** The colour a meta chip's word is drawn in. */
function toneColor(tone: RuleHeaderTone, colors: ColorTokens): string {
  if (tone === 'warning') return colors.warning
  if (tone === 'neutral') return colors.foregroundMuted
  return colors.foregroundSubtle
}

export function RuleTitle({ ruleId, name, header, enabled, onPress, history }: RuleTitleProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const content = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: SPACING.md,
        paddingHorizontal: SPACING.xl,
        paddingTop: SPACING.lg,
        paddingBottom: history === undefined ? SPACING.lg : SPACING.sm,
      }}
    >
      <View style={{ flex: 1, gap: SPACING.sm }}>
        <Text
          testID={`rule-row-name-${ruleId}`}
          style={{ color: colors.foreground, fontSize: 15, fontWeight: '500', opacity: enabled ? 1 : 0.55 }}
          numberOfLines={header.nameMaxLines}
        >
          {name}
        </Text>
        <View
          testID={`rule-row-meta-${ruleId}`}
          style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: SPACING.sm }}
        >
          {header.meta.map((chip) =>
            chip.id === 'kind' || chip.id === 'delivery' ? (
              <View
                key={chip.id}
                style={{
                  borderRadius: RADIUS.sm,
                  paddingHorizontal: SPACING.sm,
                  paddingVertical: 2,
                  backgroundColor: colors.surfaceHover,
                }}
              >
                <Text
                  testID={chip.id === 'delivery' ? `rule-row-delivery-${ruleId}` : undefined}
                  style={{ color: toneColor(chip.tone, colors), fontSize: 11, fontWeight: '700' }}
                >
                  {chip.summarySchedule !== undefined
                    ? summaryDeliveryLabel(chip.summarySchedule, (key, params) => t(key, params))
                    : t(chip.labelKey)}
                </Text>
              </View>
            ) : (
              <Text key={chip.id} style={{ color: toneColor(chip.tone, colors), fontSize: 12, fontWeight: '600' }}>
                {t(chip.labelKey)}
              </Text>
            ),
          )}
        </View>
      </View>
      {onPress !== undefined ? <ChevronRight size={18} color={colors.foregroundSubtle} /> : null}
    </View>
  )
  const title =
    onPress === undefined ? (
      content
    ) : (
      <Pressable
        accessibilityRole="button"
        onPress={onPress}
        android_ripple={{ color: colors.surfaceHover }}
        style={({ pressed }) => ({ backgroundColor: pressed ? colors.surfaceHover : 'transparent' })}
      >
        {content}
      </Pressable>
    )
  return (
    <View style={{ borderBottomWidth: 1, borderBottomColor: colors.borderSubtle }}>
      {title}
      {history !== undefined ? (
        <RuleLastRunRow ruleId={ruleId} line={history.line} nowMs={history.nowMs} onOpenHistory={history.onOpen} />
      ) : null}
    </View>
  )
}
