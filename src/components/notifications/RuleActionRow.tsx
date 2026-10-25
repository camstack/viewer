/**
 * RuleActionRow — the ONE row of controls under a rule card: the Enabled
 * switch and the Snooze switch on the left, Edit and Delete as compact icon
 * buttons on the right. Which of them appear is decided by the pure
 * {@link buildRuleRowModel}; this component only draws them and owns each
 * switch's in-flight state.
 *
 * The Snooze switch snoozes THIS RULE for 30 minutes (on) or ends its live
 * windows (off) — the admin column's meaning (controller ruling on R3). A rule
 * no snooze can silence has no switch at all.
 *
 * Operator, 2026-09-26: "Tieni modifica elimina ed abilitata sulla stessa
 * riga". 2026-10-01: the whole card opens the rule, a Snooze switch replaces
 * any prose about snoozing, and Delete is confirmed through the app's shared
 * confirm dialog (`useConfirm`, `../ui/confirm.js`) — the SAME one the
 * Targets tab already uses for its own delete, replacing an earlier
 * custom popover anchored to the button.
 *
 * The row is a {@link CardControls} region: a tap on a control, or between
 * two, never reaches the card's own press and opens the editor by accident.
 *
 * ## A switch ends on what the hub HOLDS
 *
 * While a flip is in flight the switch shows the asked state (and cannot be
 * flipped again). When the call settles it goes back to the rule as the list
 * reports it — which the mutation has already refreshed — so a refused write,
 * or one the hub answered without applying, lands the switch on the real
 * state, with the reason said underneath. It never shows a state the hub did
 * not accept.
 */
import React, { useState } from 'react'
import { Pressable, Switch, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Pencil, Trash2 } from '../../lib/icons.js'
import { hapticAction, hapticTap } from '../../lib/haptics.js'
import { useTheme } from '../../theme/theme-provider.js'
import { RADIUS, SPACING } from '../../theme/tokens.js'
import { ncErrorKey } from '../../data/nc-errors.js'
import { useConfirm } from '../ui/confirm.js'
import type { RuleRowActions, RuleSnoozeSwitch } from './rule-row.js'
import { CardControls } from './CardControls.js'

/** The Snooze switch as the card binds it. */
export interface RuleActionSnooze {
  readonly state: RuleSnoozeSwitch
  /** Snooze the rule (true) or end its live windows (false); resolves once the hub answered. */
  readonly onSet: (snoozed: boolean) => Promise<unknown>
}

interface RuleActionRowProps {
  readonly ruleId: string
  /** The rule's name — said by the delete confirmation. */
  readonly name: string
  readonly actions: RuleRowActions
  /** The rule's state as the hub last reported it. */
  readonly enabled: boolean
  /** Draw a hairline above the row (something sits between it and the title). */
  readonly divided: boolean
  readonly onEdit: () => void
  /** Delete, once the shared confirm dialog is confirmed. */
  readonly onDelete: () => void
  /** Ask the hub to switch the rule; resolves once the list holds the answer. */
  readonly onSetEnabled: (enabled: boolean) => Promise<unknown>
  /** The Snooze switch; absent where the rule kind has none. */
  readonly snooze?: RuleActionSnooze
}

/** A flip the hub did not accept: which switch, which way, and why it failed. */
interface FlipFailure {
  readonly which: 'enable' | 'snooze'
  readonly asked: boolean
  readonly message: string
}

/** One in-flight flip per switch. */
function useFlip(
  which: FlipFailure['which'],
  onFailure: (failure: FlipFailure | undefined) => void,
  errorText: (error: unknown) => string,
) {
  const [asked, setAsked] = useState<boolean | undefined>(undefined)
  const flip = (next: boolean, send: (next: boolean) => Promise<unknown>): void => {
    onFailure(undefined)
    setAsked(next)
    hapticAction()
    send(next).then(
      () => setAsked(undefined),
      (error: unknown) => {
        setAsked(undefined)
        onFailure({ which, asked: next, message: errorText(error) })
      },
    )
  }
  return { asked, flip }
}

export function RuleActionRow({
  ruleId,
  name,
  actions,
  enabled,
  divided,
  onEdit,
  onDelete,
  onSetEnabled,
  snooze,
}: RuleActionRowProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const confirm = useConfirm()
  const [failure, setFailure] = useState<FlipFailure | undefined>(undefined)
  const errorText = (error: unknown): string => {
    const key = ncErrorKey(error)
    return key !== undefined ? t(key) : error instanceof Error ? error.message : String(error)
  }
  const enable = useFlip('enable', setFailure, errorText)
  const snoozeFlip = useFlip('snooze', setFailure, errorText)
  const showSnooze = actions.snoozeSwitch && snooze !== undefined

  // Delete asks through the app's shared confirm dialog — the SAME one the
  // Targets tab already uses for its own delete. Nothing is deleted until the
  // operator confirms.
  const requestDelete = (): void => {
    hapticTap()
    void (async (): Promise<void> => {
      const ok = await confirm({
        title: t('v2.nc.rules.deleteConfirmTitle'),
        message: t('v2.nc.rules.deleteConfirmMessage', { name }),
        confirmLabel: t('v2.nc.rules.delete'),
        destructive: true,
      })
      if (!ok) return
      hapticAction()
      onDelete()
    })()
  }

  if (!actions.edit && !actions.remove && !actions.enableSwitch && !showSnooze) return null

  return (
    <CardControls style={{ borderTopWidth: divided ? 1 : 0, borderTopColor: colors.borderSubtle }}>
      <View
        testID={`rule-row-actions-${ruleId}`}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: SPACING.md,
          paddingHorizontal: SPACING.xl,
          paddingVertical: SPACING.md,
        }}
      >
        <View style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: SPACING.md }}>
          {actions.enableSwitch ? (
            <SwitchWithLabel
              label={t('v2.nc.rules.enabledSwitch')}
              value={enable.asked ?? enabled}
              disabled={enable.asked !== undefined}
              onValueChange={(next) => enable.flip(next, onSetEnabled)}
            />
          ) : null}
          {showSnooze ? (
            <SwitchWithLabel
              label={t('v2.nc.rules.snoozeSwitch')}
              value={snoozeFlip.asked ?? snooze.state.state === 'on'}
              // Not known yet (the windows are still being read): never
              // claim "not snoozed" — the switch waits, dimmed (D315).
              disabled={snooze.state.state === 'unknown' || snoozeFlip.asked !== undefined}
              dimmed={snooze.state.state === 'unknown'}
              onValueChange={(next) => snoozeFlip.flip(next, snooze.onSet)}
            />
          ) : null}
        </View>
        {actions.edit ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('v2.nc.rules.edit')}
            onPress={onEdit}
            hitSlop={6}
            style={({ pressed }) => ({
              padding: SPACING.sm,
              borderRadius: RADIUS.md,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: pressed ? colors.surfaceHover : 'transparent',
            })}
          >
            <Pencil size={16} color={colors.foregroundMuted} />
          </Pressable>
        ) : null}
        {actions.remove ? (
          <Pressable
            testID={`rule-row-delete-${ruleId}`}
            accessibilityRole="button"
            accessibilityLabel={t('v2.nc.rules.delete')}
            onPress={requestDelete}
            hitSlop={6}
            style={({ pressed }) => ({
              padding: SPACING.sm,
              borderRadius: RADIUS.md,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: pressed ? colors.surfaceHover : 'transparent',
            })}
          >
            <Trash2 size={16} color={colors.danger} />
          </Pressable>
        ) : null}
      </View>
      {failure !== undefined ? (
        <View style={{ paddingHorizontal: SPACING.xl, paddingBottom: SPACING.md }}>
          <Text
            testID={`rule-row-${failure.which}-error-${ruleId}`}
            style={{ color: colors.danger, fontSize: 12, lineHeight: 16 }}
          >
            {t(failure.which === 'enable' ? 'v2.nc.rules.enableFailed' : 'v2.nc.rules.snoozeFailed', {
              state: t(failure.asked ? 'v2.nc.rules.enableStateOn' : 'v2.nc.rules.enableStateOff'),
              error: failure.message,
            })}
          </Text>
        </View>
      ) : null}
    </CardControls>
  )
}

interface SwitchWithLabelProps {
  readonly label: string
  readonly value: boolean
  readonly disabled: boolean
  /** Drawn as not applicable (an alarm rule's Snooze), not merely busy. */
  readonly dimmed?: boolean
  readonly onValueChange: (next: boolean) => void
}

/** A switch and its word — the word is also the switch's accessible name. */
function SwitchWithLabel({ label, value, disabled, dimmed = false, onValueChange }: SwitchWithLabelProps) {
  const { colors } = useTheme()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm }}>
      <Switch value={value} onValueChange={onValueChange} disabled={disabled} accessibilityLabel={label} />
      <Text
        style={{ color: dimmed ? colors.foregroundSubtle : colors.foreground, fontSize: 14, fontWeight: '500' }}
        numberOfLines={1}
      >
        {label}
      </Text>
    </View>
  )
}
