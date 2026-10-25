/**
 * RuleRow — one rule rendered as a settings card. The WHOLE card opens the
 * rule (operator, 2026-10-01); the controls inside it sit in `CardControls`
 * regions and never open it. Its behaviour is resolved by
 * the pure {@link buildRuleRowModel}: a rule the caller can edit
 * (`readOnly === false`) gets ONE action row — the Enabled and Snooze
 * switches, Edit (not for a `mixed` rule) and Delete ({@link RuleActionRow});
 * any rule a snooze can silence gets the Snooze switch, whoever owns it; an
 * admin/global rule
 * a non-admin sees is read-only and instead exposes a
 * per-target opt-out toggle for each target the caller personally owns (bound to
 * `!disabledTargetIds.includes(targetId)` → `setRuleTargetEnabled`). An admin
 * rule that delivers to none of the caller's targets shows a read-only note.
 *
 * All server access is owned by the parent {@link RulesTab}; this component is
 * presentational and calls back through its props.
 */
import React, { useMemo } from 'react'
import { Pressable, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../theme/theme-provider.js'
import { Section } from '../ui/Section.js'
import { ToggleRow } from '../ui/ToggleRow.js'
import { SPACING, RADIUS } from '../../theme/tokens.js'
import type { NcSharedSequence, NcViewerRule, Target } from '../../data/notification-center.js'
import { buildRuleRowModel, type RuleMediaBadge, type RuleSnoozeSwitch } from './rule-row.js'
import { RuleActionRow } from './RuleActionRow.js'
import { CardControls } from './CardControls.js'
import { RuleTitle, type RuleTitleHistory } from './RuleTitle.js'
import type { TargetsReadState } from './save-gate.js'

interface RuleRowProps {
  readonly rule: NcViewerRule
  /** The caller's own targets — used to resolve which opt-out toggles to show. */
  readonly ownTargets: readonly Target[]
  /**
   * How far that list has got. Only an ANSWERED list may say "this rule
   * doesn't deliver to any of your targets" (D315): a pending one says
   * nothing yet, a failed one says it failed.
   */
  readonly ownTargetsState: TargetsReadState
  /** Open the rule's summary route — editable for a personal rule, read-only
   *  for an admin one and for a rule to recreate (`mixed`, D637). The header
   *  row opens it for every rule. */
  readonly onEdit: (rule: NcViewerRule) => void
  /** Delete a personal rule — already confirmed in the popover on its button. */
  readonly onDelete: (rule: NcViewerRule) => void
  /**
   * Switch the rule on or off. Resolves once the hub's answer is in the list,
   * rejects when the hub refused or did not apply it — the switch then goes
   * back to the stored state and says why.
   */
  readonly onSetEnabled: (rule: NcViewerRule, enabled: boolean) => Promise<unknown>
  /**
   * Snooze the rule for 30 minutes (true) or end its live windows (false);
   * same contract as `onSetEnabled`.
   */
  readonly onSetSnooze: (rule: NcViewerRule, snoozed: boolean, state: RuleSnoozeSwitch) => Promise<unknown>
  /** The rule's snooze switch state (`ruleSnoozeSwitchFor`), read by the list. */
  readonly snooze: RuleSnoozeSwitch
  /** Opt a caller-owned target in/out of an admin rule. */
  readonly onSetTargetEnabled: (ruleId: string, targetId: string, enabled: boolean) => void
  /** The admin-only last-run line under the title; absent for anyone else. */
  readonly history?: RuleTitleHistory
  /** The hub's shared sequences (admin-only read) — resolves the rule's
   *  sequence bindings for the snooze verdict; absent resolves none. */
  readonly sequences?: readonly NcSharedSequence[]
}

export function RuleRow({
  rule,
  ownTargets,
  ownTargetsState,
  onEdit,
  onDelete,
  onSetEnabled,
  onSetSnooze,
  onSetTargetEnabled,
  history,
  snooze,
  sequences,
}: RuleRowProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const model = useMemo(() => buildRuleRowModel(rule, ownTargets, sequences), [rule, ownTargets, sequences])

  return (
    // `accessible={false}`: a card that were ONE accessibility element would
    // hide its switches and buttons from a screen reader; the title stays the
    // card's accessible "open" button.
    <Pressable testID={`rule-row-${rule.id}`} accessible={false} onPress={() => onEdit(rule)}>
      <Section>
        <RuleTitle
          ruleId={rule.id}
          name={rule.name}
          header={model.header}
          enabled={model.enabled}
          onPress={() => onEdit(rule)}
          history={history}
        />

        {model.mediaBadges.length > 0 ? <MediaBadges badges={model.mediaBadges} /> : null}

        {model.recreateNoticeKey !== undefined ? (
          <View testID="rule-row-must-recreate" style={{ paddingHorizontal: SPACING.xl, paddingVertical: SPACING.md }}>
            {/* The instruction is a warning for whoever can act on it; for
                anyone else it is a plain read-only notice. */}
            <Text
              style={{
                color: model.editable ? colors.warning : colors.foregroundSubtle,
                fontSize: 12,
                lineHeight: 16,
              }}
            >
              {t(model.recreateNoticeKey)}
            </Text>
          </View>
        ) : null}

        {/* The owner's controls — and, for ANY rule a snooze can silence, the
            Snooze switch: a snooze is personal, so a rule the caller cannot
            edit may still be silenced for themselves. */}
        <RuleActionRow
          ruleId={rule.id}
          name={rule.name}
          actions={model.actions}
          enabled={rule.enabled}
          divided={model.mediaBadges.length > 0 || model.recreateNoticeKey !== undefined}
          onEdit={() => onEdit(rule)}
          onDelete={() => onDelete(rule)}
          onSetEnabled={(enabled) => onSetEnabled(rule, enabled)}
          snooze={{ state: snooze, onSet: (snoozed) => onSetSnooze(rule, snoozed, snooze) }}
        />
        {model.editable ? null : ownTargetsState !== 'answered' ? (
          ownTargetsState === 'failed' ? (
            <View style={{ paddingHorizontal: SPACING.xl, paddingBottom: SPACING.lg }}>
              <Text style={{ color: colors.danger, fontSize: 12, lineHeight: 16 }}>
                {t('v2.nc.rules.ownTargetsUnavailable')}
              </Text>
            </View>
          ) : null
        ) : model.optOutTargets.length === 0 ? (
          <View style={{ paddingHorizontal: SPACING.xl, paddingBottom: SPACING.lg }}>
            <Text style={{ color: colors.foregroundSubtle, fontSize: 12, lineHeight: 16 }}>
              {t('v2.nc.rules.noOwnedTargets')}
            </Text>
          </View>
        ) : (
          // The opt-outs are controls: a tap on them never opens the rule.
          <CardControls>
            {model.optOutTargets.map((target, index) => (
              <ToggleRow
                key={target.targetId}
                label={t('v2.nc.rules.receiveOn', { name: target.targetName })}
                value={target.receiving}
                onValueChange={(next) => onSetTargetEnabled(rule.id, target.targetId, next)}
                last={index === model.optOutTargets.length - 1}
              />
            ))}
          </CardControls>
        )}
      </Section>
    </Pressable>
  )
}

/** The rule's non-default media choices, as quiet chips under the title. A rule
 *  on the default policy renders none — only a rule that ships something other
 *  than the plain best still says so. */
function MediaBadges({ badges }: { readonly badges: readonly RuleMediaBadge[] }) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  return (
    <View
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: SPACING.xs,
        paddingHorizontal: SPACING.xl,
        paddingBottom: SPACING.md,
      }}
    >
      {badges.map((badge) => (
        <View
          key={badge.id}
          style={{
            borderRadius: RADIUS.sm,
            paddingHorizontal: SPACING.sm,
            paddingVertical: 2,
            backgroundColor: colors.surfaceHover,
          }}
        >
          <Text style={{ color: colors.foregroundSubtle, fontSize: 11, fontWeight: '600' }}>
            {t(badge.labelKey, badge.params)}
          </Text>
        </View>
      ))}
    </View>
  )
}
