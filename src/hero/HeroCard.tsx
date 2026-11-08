/**
 * HeroCard — a device's hero in the viewer: the scene, the facts under it, the
 * device's own power (large), the rows with their controls, and a Remote button
 * when the device has one. Everything comes from `hero-layout.getHeroModel`
 * (`heroCardView`); the card decides nothing about the device type.
 *
 * The remote is NOT the detail's body any more: it is one tap from here
 * (`/remote/<id>`), the same full-screen remote the sheet opens.
 */
import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import type { HeroAction, HeroModel } from '@camstack/types'
import { CatalogIcon } from '../components/CatalogIcon.js'
import { PillButton } from '../components/camera/accessory-controls/control-atoms.js'
import { useConfirm } from '../components/ui/confirm.js'
import { RemoteControl } from '../lib/icons.js'
import { remoteRoute } from '../remote/remote-route.js'
import { useTheme } from '../theme/theme-provider.js'
import { RADIUS, SPACING, TYPOGRAPHY } from '../theme/tokens.js'
import { HeroControlView } from './HeroControlView.js'
import { HeroSceneTile, SCENE_TILE_HERO } from './HeroSceneTile.js'
import { heroCardView } from './hero-card-view.js'
import { heroLocale, heroText, toneColor } from './hero-view.js'
import { useHeroCaller } from './use-hero.js'

export interface HeroCardProps {
  readonly model: HeroModel
  readonly deviceName: string
  readonly online: boolean
}

export function HeroCard({ model, deviceName, online }: HeroCardProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const { colors } = useTheme()
  const router = useRouter()
  const confirm = useConfirm()
  const caller = useHeroCaller(model.deviceId)
  const locale = heroLocale(i18n.language)
  const view = heroCardView(model, locale)
  const confirmAction = (action: HeroAction): Promise<boolean> =>
    confirm({ title: heroText(action.label, locale), message: t('v2.hero.confirmOffWhileRunning'), destructive: true })
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]} testID="hero-card">
      <Text style={[styles.title, { color: colors.foreground }]} numberOfLines={1} testID="hero-card-title">
        {view.title}
      </Text>
      {view.facts.length > 0 ? (
        <View style={styles.facts} testID="hero-card-facts">
          {view.facts.map((fact, index) => (
            <View key={index} style={[styles.chip, { backgroundColor: colors.backgroundElevated }]}>
              {fact.icon !== null ? <CatalogIcon iconKey={fact.icon} size={13} color={toneColor(fact.tone, colors)} /> : null}
              <Text style={[styles.chipText, { color: colors.foregroundMuted }]} numberOfLines={1}>
                {fact.text}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
      <HeroSceneTile icon={view.icon} tone={view.tone} size={SCENE_TILE_HERO} level={view.level} muted={view.muted || !online} testID="hero-card-scene" />
      {view.tiles.length > 0 ? (
        <View style={styles.tiles}>
          {view.tiles.map((tile, index) => (
            <View key={index} style={[styles.tile, { backgroundColor: colors.backgroundElevated }]}>
              <Text style={[styles.tileValue, { color: colors.foreground }]} numberOfLines={1}>
                {tile.value}
              </Text>
              <Text style={[styles.tileLabel, { color: colors.foregroundMuted }]} numberOfLines={1}>
                {tile.label}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
      {view.power !== null ? (
        <View style={styles.power} testID="hero-card-power">
          <HeroControlView control={view.power} locale={locale} caller={caller} online={online} large confirmAction={confirmAction} />
        </View>
      ) : null}
      {view.rows.map((row) => (
        <View key={row.id} style={[styles.row, { backgroundColor: colors.backgroundElevated }]} testID={`hero-card-row-${row.id}`}>
          <CatalogIcon iconKey={row.icon} size={16} color={colors.foregroundMuted} />
          <Text style={[styles.rowStatus, { color: colors.foreground }]} numberOfLines={1}>
            {row.status}
          </Text>
          <View style={styles.rowControls}>
            {row.controls.map((control, index) => (
              <HeroControlView key={index} control={control} locale={locale} caller={caller} online={online} confirmAction={confirmAction} />
            ))}
          </View>
        </View>
      ))}
      {view.remote ? (
        <View style={styles.remote}>
          <PillButton
            label={t('v2.hero.remote')}
            icon={RemoteControl}
            disabled={!online}
            onPress={() => router.push(remoteRoute(model.deviceId, deviceName))}
          />
        </View>
      ) : null}
      {caller.error !== null ? (
        <Text accessibilityRole="alert" style={[styles.error, { color: colors.danger }]}>
          {caller.error}
        </Text>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: RADIUS.xl, padding: SPACING.lg, gap: SPACING.md },
  title: { fontSize: TYPOGRAPHY.size.lg, fontWeight: TYPOGRAPHY.weight.bold },
  facts: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  chip: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs, height: 26, paddingHorizontal: SPACING.md, borderRadius: RADIUS.pill },
  chipText: { fontSize: TYPOGRAPHY.size.sm },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  tile: { flexGrow: 1, minWidth: 96, borderRadius: RADIUS.lg, padding: SPACING.md, gap: 2 },
  tileValue: { fontSize: TYPOGRAPHY.size.lg, fontWeight: TYPOGRAPHY.weight.medium },
  tileLabel: { fontSize: TYPOGRAPHY.size.xs },
  power: { alignItems: 'center', paddingVertical: SPACING.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, minHeight: 44, paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, borderRadius: RADIUS.lg },
  rowStatus: { flex: 1, minWidth: 0, fontSize: TYPOGRAPHY.size.md },
  rowControls: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, flexShrink: 0 },
  remote: { flexDirection: 'row', justifyContent: 'center' },
  error: { fontSize: TYPOGRAPHY.size.sm },
})
