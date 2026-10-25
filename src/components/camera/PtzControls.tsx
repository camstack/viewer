/**
 * PtzControls — directional pad + zoom for a PTZ camera, hooked to the camstack
 * `ptz` cap via `usePtz`. Layout ported from the V1 `PtzPanel` (d-pad + zoom
 * column) but re-themed (camstack Warm Amber/Stone) with lucide icons and
 * re-hooked to relative `ptz.move` calls.
 *
 * When the camera advertises no PTZ axes (cap absent or all-false options), the
 * pad renders DISABLED with an i18n "not available" note.
 *
 * Chrome-less: this renders only the pad/zoom content (no outer card / title) so
 * it composes cleanly inside `TimelinePtzPanel`, which supplies the surface, the
 * "PTZ" header and the close button. It used to say `FloatingPanel` — a
 * component deleted on 2026-08-01 — which is the kind of sentence that reads as
 * verification and sends the next reader looking for a file that is not there.
 */
import React from 'react'
import { View, Text, Pressable, StyleSheet, type GestureResponderEvent } from 'react-native'
import { useTimelineScale } from './theater/TimelineScaleProvider.js'
import { useTranslation } from 'react-i18next'
import {
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Plus,
  Minus,
  Home,
  MapPin,
  type LucideIcon,
} from '../../lib/icons.js'
import { hapticTap } from '../../lib/haptics.js'
import { useTheme } from '../../theme/theme-provider.js'
import { RADIUS, SPACING } from '../../theme/tokens.js'
import { usePtz } from '../../data/use-ptz.js'
import { useCanActuate } from '../../hooks/use-user-scope.js'
import { useNotice } from '../ui/confirm'

interface PtzControlsProps {
  readonly deviceId: number
  /** Whether the camera advertises the `pan-tilt-zoom` feature. Gates the cap
   *  query so non-PTZ devices never probe the cap. */
  readonly hasFeature: boolean
  /**
   * Told about every press (pad, zoom, Home, a preset) BEFORE the action
   * runs. The fullscreen overlay uses it to keep the chrome up while the
   * operator is steering; the panel hosts leave it out.
   */
  readonly onInteract?: () => void
}

function PadButton({
  icon: Icon,
  label,
  onPress,
  disabled,
}: {
  icon: LucideIcon
  label: string
  onPress?: (e: GestureResponderEvent) => void
  disabled?: boolean
}) {
  const { colors } = useTheme()

  return (
    <Pressable
      // EVERY pad press answers — pan, tilt, zoom and home all route through
      // this one atom. A camera that takes a moment to physically move is
      // exactly the case where the operator needs to know the button took.
      onPress={(e) => { hapticTap(); onPress?.(e) }}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.padBtn,
        {
          backgroundColor: pressed ? colors.surfaceHover : colors.backgroundElevated,
          borderColor: colors.border,
          opacity: disabled ? 0.3 : 1,
        },
      ]}
    >
      <Icon size={20} color={disabled ? colors.foregroundDisabled : colors.foreground} />
    </Pressable>
  )
}

const Spacer = () => <View style={styles.spacer} />

export function PtzControls({ deviceId, hasFeature, onInteract }: PtzControlsProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  // Scaled like the rest of the timeline chrome: the panel owns the body now,
  // and a fixed size is the only thing in a narrow landscape drawer that does
  // not shrink with it.
  const ui = useTimelineScale()
  // BACKSTOP, not the gate. Both hosts (the theater's `hasPtz`, the wall's
  // `ptzIds`) already withhold the button that opens this panel from a session
  // that may not actuate, so this branch should never render. It exists so a
  // THIRD host added later cannot mount a pad whose every press 403s — and
  // because passing `false` here also stops `usePtz` from asking a question
  // the hub would refuse.
  const canActuate = useCanActuate()
  const controllable = hasFeature && canActuate
  const notice = useNotice()
  // `goHome` refuses when this camera has no home preset configured, and a
  // refusal nobody sees is the same silent no-op as before. A disabled feature
  // must be REPORTED disabled, never made to look broken.
  const ptz = usePtz(deviceId, controllable, (message) => {
    notice({ title: t('v2.ptz.home'), message, dismissLabel: t('v2.common.ok') })
  })

  // No PTZ cap (or no controllable axis) → disabled shell with a clear note.
  if (!controllable || !ptz.available) {
    return (
      <Text style={[styles.notAvailable, { fontSize: ui.font.xs, color: colors.foregroundSubtle }]}>
        {t('v2.ptz.notAvailable')}
      </Text>
    )
  }

  const { options } = ptz
  // Every action reports the press first, then runs: the action itself is
  // `usePtz`'s, unchanged, whichever host the pad is mounted in.
  const pressed = (action: () => void) => (): void => {
    onInteract?.()
    action()
  }
  // Only an ANSWERED `none` disables Home; pending/unknown leave it pressable.
  const homeMissing = ptz.home === 'none'
  const hasPan = options?.hasPan ?? false
  const hasTilt = options?.hasTilt ?? false
  const hasZoom = options?.hasZoom ?? false

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        {/* Directional pad */}
        <View style={styles.dpad}>
          <View style={styles.dpadRow}>
            <Spacer />
            {hasTilt ? <PadButton icon={ChevronUp} label={t('v2.ptz.tiltUp')} onPress={pressed(ptz.tiltUp)} /> : <Spacer />}
            <Spacer />
          </View>
          <View style={styles.dpadRow}>
            {hasPan ? <PadButton icon={ChevronLeft} label={t('v2.ptz.panLeft')} onPress={pressed(ptz.panLeft)} /> : <Spacer />}
            <Pressable
              onPress={pressed(ptz.goHome)}
              disabled={homeMissing}
              style={[styles.homeBtn, { opacity: homeMissing ? 0.3 : 1 }]}
              accessibilityLabel={t('v2.ptz.home')}
              accessibilityState={{ disabled: homeMissing }}
              accessibilityHint={homeMissing ? t('v2.ptz.noHome') : undefined}
            >
              <Home
                size={16}
                color={homeMissing ? colors.foregroundDisabled : colors.foregroundSubtle}
              />
            </Pressable>
            {hasPan ? <PadButton icon={ChevronRight} label={t('v2.ptz.panRight')} onPress={pressed(ptz.panRight)} /> : <Spacer />}
          </View>
          <View style={styles.dpadRow}>
            <Spacer />
            {hasTilt ? <PadButton icon={ChevronDown} label={t('v2.ptz.tiltDown')} onPress={pressed(ptz.tiltDown)} /> : <Spacer />}
            <Spacer />
          </View>
        </View>

        {/* Zoom column */}
        {hasZoom ? (
          <View style={styles.zoomCol}>
            <PadButton icon={Plus} label={t('v2.ptz.zoomIn')} onPress={pressed(ptz.zoomIn)} />
            <Text style={[styles.zoomLabel, { fontSize: ui.font.xs, color: colors.foregroundSubtle }]}>
              {t('v2.ptz.zoom')}
            </Text>
            <PadButton icon={Minus} label={t('v2.ptz.zoomOut')} onPress={pressed(ptz.zoomOut)} />
          </View>
        ) : null}
      </View>

      {/* A disabled Home says WHY — a disabled feature must never look like a
          broken one (D62). Setting a home is an admin task for now. */}
      {homeMissing ? (
        <Text style={[styles.notAvailable, { fontSize: ui.font.xs, color: colors.foregroundSubtle }]}>
          {t('v2.ptz.noHome')}
        </Text>
      ) : null}

      {/* Presets — recall a named position. Shown only when the camera
          advertises preset support; an empty list renders a "no presets" note. */}
      {ptz.supportsPresets ? (
        <View style={styles.presets}>
          <Text style={[styles.presetsLabel, { fontSize: ui.font.xs, color: colors.foregroundSubtle }]}>
            {t('v2.ptz.presets')}
          </Text>
          {ptz.presets.length > 0 ? (
            <View style={styles.presetList}>
              {ptz.presets.map((preset) => (
                <Pressable
                  key={preset.id}
                  onPress={() => { hapticTap(); onInteract?.(); ptz.goToPreset(preset.id) }}
                  accessibilityLabel={preset.name}
                  style={({ pressed }) => [
                    styles.presetChip,
                    {
                      backgroundColor: pressed ? colors.surfaceHover : colors.backgroundElevated,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <MapPin size={12} color={colors.foregroundSubtle} />
                  <Text style={[styles.presetText, { fontSize: ui.font.xs, color: colors.foreground }]} numberOfLines={1}>
                    {preset.name}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : (
            <Text style={[styles.notAvailable, { fontSize: ui.font.xs, color: colors.foregroundSubtle }]}>
              {t('v2.ptz.noPresets')}
            </Text>
          )}
        </View>
      ) : null}
    </View>
  )
}

const BTN = 44

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: SPACING.md,
  },
  notAvailable: { fontSize: 12, paddingVertical: SPACING.sm, textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: SPACING['2xl'] },
  dpad: { gap: SPACING.sm },
  dpadRow: { flexDirection: 'row', gap: SPACING.sm },
  padBtn: {
    width: BTN,
    height: BTN,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  spacer: { width: BTN, height: BTN },
  homeBtn: { width: BTN, height: BTN, alignItems: 'center', justifyContent: 'center' },
  zoomCol: { alignItems: 'center', gap: SPACING.sm },
  zoomLabel: { fontSize: 11 },
  presets: { alignSelf: 'stretch', gap: SPACING.sm },
  presetsLabel: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  presetList: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  presetChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs + 2,
    maxWidth: '100%',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.md,
    borderWidth: 1,
  },
  presetText: { fontSize: 12, fontWeight: '600', flexShrink: 1 },
})
