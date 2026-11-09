/**
 * HeroRowBody — a device row built from `hero-layout.getRowModels` and nothing
 * else: scene tile, name, ONE status line, the primary control, the trailing
 * fact (tablet width and up, like the web row), chevron.
 *
 * `model` is always a real model (D315): a pending or failed batch, or a hub
 * with no row for the device, draws the legacy row instead. A model whose
 * `primary` is null (a cap the hero does not cover yet) draws `fallbackControl`.
 */
import React from 'react'
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import { useTranslation } from 'react-i18next'
import type { HeroRowModel } from '@camstack/types'
import { CatalogIcon } from '../components/CatalogIcon.js'
import { hapticTap } from '../lib/haptics.js'
import { ChevronRight } from '../lib/icons.js'
import { useTheme } from '../theme/theme-provider.js'
import { SPACING, TYPOGRAPHY } from '../theme/tokens.js'
import { HeroControlView } from './HeroControlView.js'
import { HeroSceneTile } from './HeroSceneTile.js'
import { heroLocale, rowView, toneColor } from './hero-view.js'
import { useHeroCaller } from './use-hero.js'

/** Width from which the trailing fact is drawn: the web row's `sm` breakpoint. */
export const ROW_FACT_MIN_WIDTH = 640

export interface HeroRowBodyProps {
  readonly deviceId: number
  /** What the row is called: the operator's local name, else the hub's (never the model's own). */
  readonly name: string
  readonly online: boolean
  /** A real model: a row without one is the legacy row, drawn by the caller. */
  readonly model: HeroRowModel
  /** An icon the operator picked on this phone; replaces the state icon, keeps the tone. */
  readonly customIcon?: string | null
  /** Shown under the name while the model has no status line (location, badges). */
  readonly caption?: string | null
  /**
   * Drawn in the control zone when the hub's row model carries no control for a
   * device that still has one: `hero-layout` does not cover every cap yet (the
   * `LATER_PHASE` entries of `hero-cap-coverage.ts`: climate, lock, cover,
   * brightness, alarm, fan, vacuum…). Removing it would drop a working control;
   * it goes away as each cap gains a hero contribution.
   */
  readonly fallbackControl?: React.ReactNode
  /**
   * A shortcut cluster (a cover's up / stop / down) drawn in the control zone
   * INSTEAD of the model's single primary control, which cannot express it.
   */
  readonly shortcuts?: React.ReactNode
  readonly onOpen: () => void
  readonly openLabel: string
}

export function HeroRowBody({ deviceId, name, online, model, customIcon = null, caption = null, fallbackControl = null, shortcuts = null, onOpen, openLabel }: HeroRowBodyProps): React.JSX.Element {
  const { i18n } = useTranslation()
  const { colors } = useTheme()
  const { width } = useWindowDimensions()
  const caller = useHeroCaller(deviceId)
  const locale = heroLocale(i18n.language)
  const view = rowView(model, locale)
  const status = view.status
  const showFact = view.trailing !== null && width >= ROW_FACT_MIN_WIDTH
  return (
    <View style={[styles.row, { borderBottomColor: colors.borderSubtle }]} testID={`hero-row-${deviceId}`}>
      <HeroSceneTile
        icon={customIcon ?? view.icon}
        tone={view.tone}
        muted={!online || view.muted}
        testID={`hero-row-scene-${deviceId}`}
      />
      <View style={styles.label}>
        <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={1}>
          {name}
        </Text>
        {status !== '' ? (
          <Text testID={`hero-row-status-${deviceId}`} style={[styles.status, { color: colors.foregroundMuted }]} numberOfLines={1}>
            {status}
          </Text>
        ) : null}
        {caption !== null && caption !== '' ? (
          <Text testID={`hero-row-caption-${deviceId}`} style={[styles.caption, { color: colors.foregroundSubtle }]} numberOfLines={1}>
            {caption}
          </Text>
        ) : null}
      </View>
      {shortcuts !== null ? (
        <View style={styles.control} testID={`hero-row-shortcuts-${deviceId}`}>
          {shortcuts}
        </View>
      ) : model.primary !== null ? (
        <View style={styles.control}>
          <HeroControlView control={model.primary} locale={locale} caller={caller} online={online} />
        </View>
      ) : fallbackControl !== null ? (
        <View style={styles.control}>{fallbackControl}</View>
      ) : null}
      {showFact && view.trailing !== null ? (
        <View style={styles.fact} testID={`hero-row-fact-${deviceId}`}>
          {view.trailing.icon !== null ? (
            <CatalogIcon iconKey={view.trailing.icon} size={14} color={toneColor(view.trailing.tone, colors)} />
          ) : null}
          <Text style={[styles.factText, { color: colors.foregroundMuted }]} numberOfLines={1}>
            {view.trailing.text}
          </Text>
        </View>
      ) : null}
      <Pressable
        onPress={() => {
          hapticTap()
          onOpen()
        }}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={openLabel}
        testID={`accessory-detail-${deviceId}`}
        style={styles.chevron}
      >
        <ChevronRight size={18} color={colors.foregroundSubtle} />
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    minHeight: 64,
    paddingVertical: SPACING.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  label: { flex: 1, minWidth: 0, gap: 2 },
  name: { fontSize: TYPOGRAPHY.size.md, fontWeight: TYPOGRAPHY.weight.medium },
  status: { fontSize: TYPOGRAPHY.size.sm },
  caption: { fontSize: TYPOGRAPHY.size.xs },
  control: { flexShrink: 0 },
  fact: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs, flexShrink: 0, maxWidth: 120 },
  factText: { fontSize: TYPOGRAPHY.size.sm },
  chevron: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
})
