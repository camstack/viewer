/**
 * NavigationControls — the robot camera's drive pad, actions, sounds and fill
 * light, for the `navigation` cap. Lives in the same controls sheet as PTZ
 * (one icon, one panel): a device with a gimbal gets the PTZ section, a robot
 * gets this one — two separate capabilities, never one projected as the other.
 *
 * Drive with the joystick: the hook nudges once a second with the latest
 * vector and stops on release, like the robot app's. The stick is the SAME
 * `DriveJoystick` the landscape overlay mounts — the four hold buttons it
 * replaced were a second drive vocabulary (operator, 2026-09-06). Every list
 * here is the cap's own data (`listActions`, `getFeatures`); no vendor
 * knowledge in the component.
 */
import React from 'react'
import { View, Text, Pressable, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import {
  type LucideIcon,
  Bell,
  Cat,
  Clock,
  Crosshair,
  Dog,
  Droplets,
  Footprints,
  Home,
  Lightbulb,
  Minus,
  Pause,
  PawPrint,
  Play,
  Plus,
  Sparkles,
  Square,
  Trash2,
} from '../../lib/icons.js'
import { hapticTap } from '../../lib/haptics.js'
import { useTheme } from '../../theme/theme-provider.js'
import { RADIUS, SPACING } from '../../theme/tokens.js'
import { useTimelineScale } from './theater/TimelineScaleProvider.js'
import { useNavigation } from '../../data/use-navigation.js'
import { type NavigationEntry, stepLightLevel } from '../../data/navigation-controls.js'
import { useCanActuate } from '../../hooks/use-user-scope.js'
import { DriveJoystick } from './navigation/DriveJoystick.js'

interface NavigationControlsProps {
  readonly deviceId: number
  /** Whether the device is bound to the `navigation` cap (gates the queries). */
  readonly hasCap: boolean
}

/** The cap's icon HINTS are lucide names; an unknown hint gets a spark. */
const ICONS: Readonly<Record<string, LucideIcon>> = {
  play: Play,
  pause: Pause,
  hand: Square,
  home: Home,
  bell: Bell,
  crosshair: Crosshair,
  'paw-print': PawPrint,
  footprints: Footprints,
  droplets: Droplets,
  'trash-2': Trash2,
  flashlight: Lightbulb,
  'flashlight-off': Lightbulb,
  cat: Cat,
  dog: Dog,
  clock: Clock,
}

function EntryChip({ entry, onPress }: { readonly entry: NavigationEntry; readonly onPress: () => void }) {
  const { colors } = useTheme()
  const ui = useTimelineScale()
  const Icon = ICONS[entry.icon] ?? Sparkles
  return (
    <Pressable
      onPress={() => { hapticTap(); onPress() }}
      accessibilityRole="button"
      accessibilityLabel={entry.label}
      style={({ pressed }) => [
        styles.chip,
        { backgroundColor: pressed ? colors.surfaceHover : colors.backgroundElevated, borderColor: colors.border },
      ]}
    >
      <Icon size={14} color={colors.foreground} />
      <Text style={[styles.chipText, { fontSize: ui.font.xs, color: colors.foreground }]} numberOfLines={1}>
        {entry.label}
      </Text>
    </Pressable>
  )
}

export function NavigationControls({ deviceId, hasCap }: NavigationControlsProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const ui = useTimelineScale()
  const canActuate = useCanActuate()
  const controllable = hasCap && canActuate
  const nav = useNavigation(deviceId, controllable)
  const features = nav.features

  if (!controllable || features === null) {
    return (
      <Text style={[styles.notAvailable, { fontSize: ui.font.xs, color: colors.foregroundSubtle }]}>
        {t('v2.navigation.notAvailable')}
      </Text>
    )
  }

  const status = nav.status
  const manual = status?.lightMode === 'manual'
  const level = status?.lightLevel ?? 100

  return (
    <View style={styles.container}>
      {status ? (
        <View style={styles.chips}>
          <Text style={[styles.status, { fontSize: ui.font.xs, color: colors.foregroundSubtle }]}>
            {t(`v2.navigation.mode.${status.mode}`, status.mode)}
            {status.following ? ` · ${t('v2.navigation.following')}` : ''}
            {status.flash ? ` · ${t('v2.navigation.lightOn')}` : ''}
          </Text>
        </View>
      ) : null}

      {features.move ? (
        <View>
          <Text style={[styles.label, { fontSize: ui.font.xs, color: colors.foregroundSubtle }]}>
            {t('v2.navigation.drive')}
          </Text>
          <View style={styles.pad}>
            <DriveJoystick onVector={nav.driveVector} onRelease={nav.stopDrive} />
            {features.stop ? (
              <Pressable
                onPress={() => { hapticTap(); nav.stopDrive(); nav.runAction('stop') }}
                accessibilityRole="button"
                accessibilityLabel={t('v2.navigation.stop')}
                style={[styles.padBtn, { backgroundColor: colors.backgroundElevated, borderColor: colors.border }]}
              >
                <Square size={20} color={colors.danger} />
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}

      {features.runAction && nav.actions.length > 0 ? (
        <View>
          <Text style={[styles.label, { fontSize: ui.font.xs, color: colors.foregroundSubtle }]}>
            {t('v2.navigation.actions')}
          </Text>
          <View style={styles.chips}>
            {nav.actions.map((entry) => (
              <EntryChip key={entry.id} entry={entry} onPress={() => nav.runAction(entry.id)} />
            ))}
          </View>
        </View>
      ) : null}

      {features.playSound && nav.sounds.length > 0 ? (
        <View>
          <Text style={[styles.label, { fontSize: ui.font.xs, color: colors.foregroundSubtle }]}>
            {t('v2.navigation.sounds')}
          </Text>
          <View style={styles.chips}>
            {nav.sounds.map((entry) => (
              <EntryChip
                key={entry.id}
                entry={entry}
                onPress={() => { if (entry.soundId !== undefined) nav.playSound(entry.soundId) }}
              />
            ))}
          </View>
        </View>
      ) : null}

      {features.light ? (
        <View>
          <Text style={[styles.label, { fontSize: ui.font.xs, color: colors.foregroundSubtle }]}>
            {t('v2.navigation.light')}
          </Text>
          <View style={styles.chips}>
            <Pressable
              onPress={() => { hapticTap(); nav.setLightOn(!(status?.flash === true)) }}
              accessibilityRole="button"
              accessibilityLabel={status?.flash ? t('v2.navigation.lightOff') : t('v2.navigation.lightOn')}
              style={[
                styles.chip,
                { backgroundColor: status?.flash ? colors.primary : colors.backgroundElevated, borderColor: colors.border },
              ]}
            >
              <Lightbulb size={14} color={status?.flash ? colors.primaryForeground : colors.foreground} />
              <Text style={[styles.chipText, { fontSize: ui.font.xs, color: status?.flash ? colors.primaryForeground : colors.foreground }]}>
                {status?.flash ? t('v2.navigation.lightOn') : t('v2.navigation.lightOff')}
              </Text>
            </Pressable>
            {features.lightMode ? (
              <>
                <Pressable
                  onPress={() => { hapticTap(); nav.setLightMode(manual ? 'auto' : 'manual', manual ? undefined : level) }}
                  accessibilityRole="button"
                  accessibilityLabel={manual ? t('v2.navigation.manual') : t('v2.navigation.auto')}
                  style={[styles.chip, { backgroundColor: colors.backgroundElevated, borderColor: colors.border }]}
                >
                  <Text style={[styles.chipText, { fontSize: ui.font.xs, color: colors.foreground }]}>
                    {manual ? t('v2.navigation.manual') : t('v2.navigation.auto')}
                  </Text>
                </Pressable>
                {manual ? (
                  <View style={styles.stepper}>
                    <Pressable
                      onPress={() => { hapticTap(); nav.setLightLevel(stepLightLevel(level, -1)) }}
                      accessibilityRole="button"
                      accessibilityLabel={t('v2.navigation.levelDown')}
                      style={[styles.stepBtn, { borderColor: colors.border }]}
                    >
                      <Minus size={14} color={colors.foreground} />
                    </Pressable>
                    <Text style={[styles.chipText, { fontSize: ui.font.xs, color: colors.foreground }]}>{level}%</Text>
                    <Pressable
                      onPress={() => { hapticTap(); nav.setLightLevel(stepLightLevel(level, 1)) }}
                      accessibilityRole="button"
                      accessibilityLabel={t('v2.navigation.levelUp')}
                      style={[styles.stepBtn, { borderColor: colors.border }]}
                    >
                      <Plus size={14} color={colors.foreground} />
                    </Pressable>
                  </View>
                ) : null}
              </>
            ) : null}
          </View>
        </View>
      ) : null}

      {nav.error ? (
        <Text style={[styles.error, { fontSize: ui.font.xs, color: colors.danger }]}>{nav.error}</Text>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { gap: SPACING.md },
  notAvailable: { fontStyle: 'italic' },
  label: { marginBottom: SPACING.xs, fontWeight: '600' },
  status: { fontWeight: '600' },
  pad: { flexDirection: 'row', gap: SPACING.lg, alignItems: 'center' },
  padBtn: {
    width: 52,
    height: 52,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm, alignItems: 'center' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 6,
    borderRadius: RADIUS.md,
    borderWidth: 1,
  },
  chipText: { fontWeight: '600' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  stepBtn: { width: 32, height: 32, borderRadius: RADIUS.md, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  error: {},
})
