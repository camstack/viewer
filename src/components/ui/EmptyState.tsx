/**
 * EmptyState / ErrorState — THE "nothing here" and "could not load" of the
 * viewer: an icon, a title, an optional line of body and an optional action,
 * centred. Every Library page, Events, the Settings lists and the notification
 * lists draw these, so an empty page says so the same way everywhere
 * (operator, 2026-10-21) — Retrain's bare sentence and Media's red text were
 * two more dialects of the same message.
 *
 * Unanswered is not empty: a page shows its skeleton or spinner while the
 * query is in flight and reaches for these only once it ANSWERED (empty) or
 * FAILED (error).
 *
 * `fill` (default) centres in the parent's whole box — a page body or a list's
 * empty component. `fill={false}` is the inline form for a card or a section
 * that sits among other content.
 */
import React from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Inbox, TriangleAlert, type LucideIcon } from '../../lib/icons.js'
import { useTheme } from '../../theme/theme-provider.js'
import { RADIUS, SPACING, TYPOGRAPHY } from '../../theme/tokens.js'

/** The one button under the message (Clear filters, Retry, Add …). */
export interface EmptyStateAction {
  readonly label: string
  readonly onPress: () => void
  readonly testID?: string
}

export interface EmptyStateProps {
  readonly title: string
  readonly body?: string
  /** Absent ⇒ the generic empty tray. */
  readonly icon?: LucideIcon
  readonly action?: EmptyStateAction
  /** `danger` colours the icon: a failure, not an empty answer. */
  readonly tone?: 'neutral' | 'danger'
  /** Centre in the parent's whole box (default) or sit inline. */
  readonly fill?: boolean
  readonly testID?: string
}

/** Icon size (pt): a glyph that reads as illustration, not as a control. */
export const EMPTY_STATE_ICON_SIZE = 28

export function EmptyState({
  title,
  body,
  icon: Icon = Inbox,
  action,
  tone = 'neutral',
  fill = true,
  testID,
}: EmptyStateProps): React.JSX.Element {
  const { colors } = useTheme()
  return (
    <View style={[styles.root, fill ? styles.fill : styles.inline]} testID={testID} accessibilityRole="summary">
      <Icon size={EMPTY_STATE_ICON_SIZE} color={tone === 'danger' ? colors.danger : colors.foregroundSubtle} />
      <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
      {body !== undefined && body.length > 0 ? (
        <Text style={[styles.body, { color: colors.foregroundMuted }]}>{body}</Text>
      ) : null}
      {action !== undefined ? (
        <Pressable
          onPress={action.onPress}
          accessibilityRole="button"
          accessibilityLabel={action.label}
          testID={action.testID}
          style={({ pressed }) => [
            styles.action,
            { borderColor: colors.border, backgroundColor: pressed ? colors.surfaceHover : colors.surface },
          ]}
        >
          <Text style={[styles.actionText, { color: colors.foreground }]}>{action.label}</Text>
        </Pressable>
      ) : null}
    </View>
  )
}

export interface ErrorStateProps extends Omit<EmptyStateProps, 'tone' | 'action' | 'icon'> {
  /** Offer Retry. */
  readonly onRetry?: () => void
  readonly retryTestID?: string
}

/** A load that FAILED: the danger glyph and, when the page can, Retry. */
export function ErrorState({ onRetry, retryTestID, ...rest }: ErrorStateProps): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <EmptyState
      {...rest}
      icon={TriangleAlert}
      tone="danger"
      {...(onRetry !== undefined ? { action: { label: t('common.retry'), onPress: onRetry, testID: retryTestID } } : {})}
    />
  )
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', justifyContent: 'center', gap: SPACING.md },
  fill: { flex: 1, width: '100%', padding: SPACING['2xl'] },
  inline: { paddingVertical: SPACING['2xl'], paddingHorizontal: SPACING.xl },
  title: { fontSize: TYPOGRAPHY.size.md, fontWeight: TYPOGRAPHY.weight.medium, textAlign: 'center' },
  body: { fontSize: TYPOGRAPHY.size.sm, lineHeight: 17, textAlign: 'center', maxWidth: 420 },
  action: {
    marginTop: SPACING.sm,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderRadius: RADIUS.pill,
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.md,
  },
  actionText: { fontSize: TYPOGRAPHY.size.md, fontWeight: TYPOGRAPHY.weight.medium },
})
