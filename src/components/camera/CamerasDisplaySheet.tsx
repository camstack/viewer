/**
 * CamerasDisplaySheet — slide-up "Display options" for the Cameras page. Hosts
 * the Recent-events reel presentation preferences (thumbnail size, label mode)
 * AND the camera-card overlay set — what each card draws over its thumbnail, and
 * where.
 */
import React, { memo } from 'react'
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'
import { X, Zap } from '../../lib/icons.js'
import { useTheme } from '../../theme/theme-provider.js'
import { RADIUS, SPACING } from '../../theme/tokens.js'
import { SheetModal } from '../ui/SheetModal.js'
import { Section } from '../ui/Section.js'
import { ToggleRow } from '../ui/ToggleRow.js'
import { SegmentBlock } from '../ui/SegmentBlock.js'
import { type SegmentOption } from '../ui/SegmentedControl.js'
import { useSettings } from '../../data/use-settings.js'
import { OverlayPositionPicker } from './overlay/OverlayPositionPicker.js'
import {
  REEL_THUMB_SIZES,
  TILE_LABEL_MODES,
  type ReelThumbSize,
  type TileLabelMode,
} from '../../store/settings-store.js'
import { SheetHeader } from '../ui/SheetHeader.js'

export interface CamerasDisplaySheetProps {
  readonly visible: boolean
  readonly onClose: () => void
}

export const CamerasDisplaySheet = memo(function CamerasDisplaySheet({
  visible,
  onClose,
}: CamerasDisplaySheetProps) {
  const { colors } = useTheme()
  const { t } = useTranslation()
  const insets = useSafeAreaInsets()
  const { settings, setEvents, setCameraList } = useSettings()

  const reelSizeLabel: Readonly<Record<ReelThumbSize, string>> = {
    small: t('v2.settings.reelSizeSmall'),
    medium: t('v2.settings.reelSizeMedium'),
    large: t('v2.settings.reelSizeLarge'),
  }
  const reelSizeOptions: readonly SegmentOption<ReelThumbSize>[] = REEL_THUMB_SIZES.map((s) => ({
    value: s,
    label: reelSizeLabel[s],
  }))

  const reelLabelModeOptions: readonly SegmentOption<TileLabelMode>[] = TILE_LABEL_MODES.map((mode) => ({
    value: mode,
    label: t(`v2.settings.reelLabelMode${mode === 'off' ? 'Off' : mode === 'icon' ? 'Icon' : 'Label'}`),
  }))

  return (
    <SheetModal
      visible={visible}
      onClose={onClose}
      sheetStyle={[styles.sheet, { backgroundColor: colors.backgroundElevated }]}
    >
      <SheetHeader
        title={t('v2.events.displayTitle')}
        onClose={onClose}
      />

      <ScrollView contentContainerStyle={styles.scroll}>
        <Section title={t('v2.settings.listOverlays')}>
          <ToggleRow
            icon={Zap}
            label={t('v2.settings.listMotionBorder')}
            description={t('v2.settings.listMotionBorderHint')}
            value={settings.cameraList.motionBorder}
            onValueChange={(v) => setCameraList('motionBorder', v)}
          />
          <View style={styles.positionRow}>
            <Text style={[styles.positionLabel, { color: colors.foreground }]}>
              {t('v2.settings.listOccupancy')}
            </Text>
            <OverlayPositionPicker
              value={settings.cameraList.occupancy}
              onChange={(position) => setCameraList('occupancy', position)}
              allowOff
            />
          </View>
        </Section>

        <Section title={t('v2.settings.reel')}>
          <SegmentBlock<ReelThumbSize>
            label={t('v2.settings.reelThumbSize')}
            options={reelSizeOptions}
            value={settings.events.reelThumbSize}
            onChange={(v) => setEvents('reelThumbSize', v)}
          />
          <SegmentBlock<TileLabelMode>
            label={t('v2.settings.reelLabelMode')}
            options={reelLabelModeOptions}
            value={settings.events.reelLabelMode}
            onChange={(v) => setEvents('reelLabelMode', v)}
          />
        </Section>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + SPACING.md }]}>
        <Pressable onPress={onClose} style={[styles.footerBtn, { backgroundColor: colors.primary }]}>
          <Text style={[styles.footerBtnText, { color: colors.primaryForeground }]}>
            {t('v2.events.done', 'Done')}
          </Text>
        </Pressable>
      </View>
    </SheetModal>
  )
})

const styles = StyleSheet.create({
  sheet: { maxHeight: '85%', borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl, paddingHorizontal: SPACING.md, paddingTop: SPACING.md },
  scroll: { gap: SPACING.xl, paddingVertical: SPACING.sm },
  positionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.md,
  },
  positionLabel: { flexShrink: 1, fontSize: 15, fontWeight: '500' },
  footer: { flexDirection: 'row', gap: SPACING.sm, paddingTop: SPACING.sm },
  footerBtn: { flex: 1, alignItems: 'center', paddingVertical: SPACING.md, borderRadius: RADIUS.md },
  footerBtnText: { fontSize: 15, fontWeight: '700' },
})
