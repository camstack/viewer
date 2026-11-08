/**
 * HeroRowBody — a device row built from `hero-layout.getRowModels` and nothing
 * else: scene tile, name, ONE status line, the primary control, the trailing
 * fact (tablet width and up, like the web row), chevron.
 *
 * `model` is `undefined` while the batch has not answered and `null` when the
 * hub has no row for the device; both draw the identity with no control (a
 * control is never guessed from the device type).
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
  readonly model: HeroRowModel | null | undefined
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
  readonly onOpen: () => void
  readonly openLabel: string
}

export function HeroRowBody({ deviceId, name, online, model, customIcon = null, caption = null, fallbackControl = null, onOpen, openLabel }: HeroRowBodyProps): React.JSX.Element {
  const { i18n } = useTranslation()
  const { colors } = useTheme()
  const { width } = useWindowDimensions()
  const caller = useHeroCaller(deviceId)
  const locale = heroLocale(i18n.language)
  const view = model == null ? null : rowView(model, locale)
  const status = view !== null && view.status !== '' ? view.status : (caption ?? '')
  const showFact = view?.trailing != null && width >= ROW_FACT_MIN_WIDTH
  return (
    <View style={[styles.row, { borderBottomColor: colors.borderSubtle }]} testID={`hero-row-${deviceId}`}>
      <HeroSceneTile
        icon={customIcon ?? view?.icon ?? 'power'}
        tone={view?.tone ?? 'muted'}
        muted={!online || view?.muted === true}
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
      </View>
      {model?.primary != null ? (
        <View style={styles.control}>
          <HeroControlView control={model.primary} locale={locale} caller={caller} online={online} />
        </View>
      ) : fallbackControl !== null && model !== undefined ? (
        <View style={styles.control}>{fallbackControl}</View>
      ) : null}
      {showFact && view?.trailing != null ? (
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
  control: { flexShrink: 0 },
  fact: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs, flexShrink: 0, maxWidth: 120 },
  factText: { fontSize: TYPOGRAPHY.size.sm },
  chevron: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
})
