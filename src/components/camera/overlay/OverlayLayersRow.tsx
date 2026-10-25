/**
 * OverlayLayersRow — the ONE control that decides what the box overlay draws.
 *
 * Four independent layers (motion / objects / discarded / stationary), rendered
 * as a checkable chip set. It replaced an ordered `off / kept / all` selector
 * plus a separate motion toggle: the scale forced `discarded ⊃ objects` and had
 * no state at all for the parked objects, which therefore rode the object
 * switch — a switch that defaults OFF, so a fresh install could never draw a
 * parked car and "parked only" was inexpressible.
 *
 * The caller passes the layers ITS context offers (`visibleLayers(context)` for
 * a per-camera surface, `BAR_LAYERS` for the grid bar), so this component never
 * needs to know where it is mounted — and a layer can never be offered in two
 * places at once.
 */
import React from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { SquareDashed } from '../../../lib/icons.js'
import { useTheme } from '../../../theme/theme-provider.js'
import { SPACING } from '../../../theme/tokens.js'
import { ChipMultiselect, type ChipOption } from '../../ui/ChipMultiselect.js'
import { LAYER_LABEL_KEY, type OverlayLayer } from './overlay-config.js'

export interface OverlayLayersRowProps {
  /** Which layers this surface offers, in display order. */
  readonly layers: readonly OverlayLayer[]
  /** Which of them are currently drawn. */
  readonly selected: readonly OverlayLayer[]
  readonly onToggle: (layer: OverlayLayer) => void
}

/** A layer whose meaning is not obvious from one word gets one line of prose,
 *  and only while it is ON — a panel that explains four things at once is the
 *  wall of text this control was made to replace. */
const LAYER_HINT_KEY: Partial<Readonly<Record<OverlayLayer, string>>> = {
  discarded: 'v2.overlay.layerDiscardedHint',
  stationary: 'v2.overlay.layerStationaryHint',
}

export function OverlayLayersRow({
  layers,
  selected,
  onToggle,
}: OverlayLayersRowProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const { colors } = useTheme()
  if (layers.length === 0) return null

  const options: readonly ChipOption<OverlayLayer>[] = layers.map((layer) => ({
    value: layer,
    label: t(LAYER_LABEL_KEY[layer]),
  }))

  return (
    <View style={styles.block}>
      <View style={styles.head}>
        <SquareDashed size={18} color={colors.foregroundMuted} />
        <Text style={[styles.label, { color: colors.foreground }]}>
          {t('v2.overlay.layersLabel')}
        </Text>
      </View>
      <ChipMultiselect options={options} selected={selected} onToggle={onToggle} />
      {layers.map((layer) => {
        const hint = LAYER_HINT_KEY[layer]
        if (hint === undefined || !selected.includes(layer)) return null
        return (
          <Text key={layer} style={[styles.hint, { color: colors.foregroundSubtle }]}>
            {t(hint)}
          </Text>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  block: { paddingVertical: SPACING.xs },
  head: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingTop: SPACING.sm },
  label: { fontSize: 15, fontWeight: '500' },
  hint: { fontSize: 12, lineHeight: 16, paddingBottom: SPACING.xs },
})
