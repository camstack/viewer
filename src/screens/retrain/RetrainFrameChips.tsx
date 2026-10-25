/**
 * The review chips on a frame tile: one filled badge per (state, class) — the
 * class glyph, the count — painted with the SAME look as the editor's list
 * (`boxLook`), dashed when the verdict is approximate. Filled, so they read
 * over the thumbnail.
 */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import type { RetrainFrame, RetrainMacroClass } from '@camstack/types'
import { Badge } from '../../components/ui/Badge.js'
import {
  Box,
  Car,
  HelpCircle,
  Package,
  PawPrint,
  PersonStanding,
  ScanFace,
} from '../../lib/icons.js'
import { boxLook } from '../../retrain/box-look.js'
import { summarizeFrameReview } from '../../retrain/frame-review-chips.js'
import { SPACING } from '../../theme/tokens.js'

type Glyph = typeof Car

const GLYPH: Readonly<Record<RetrainMacroClass, Glyph>> = {
  person: PersonStanding,
  vehicle: Car,
  animal: PawPrint,
  package: Package,
  face: ScanFace,
  plate: Box,
}

export function RetrainFrameChips({ review }: { readonly review: RetrainFrame['review'] }) {
  const { shown, more } = summarizeFrameReview(review)
  if (shown.length === 0) return null
  return (
    <View style={styles.row} pointerEvents="none" testID="retrain-frame-chips">
      {shown.map((chip) => {
        const look = boxLook(chip.kind)
        const Icon = chip.macroClass === null ? HelpCircle : GLYPH[chip.macroClass]
        return (
          <Badge
            key={`${chip.kind}|${chip.macroClass ?? ''}|${String(chip.approximate)}`}
            label={`${chip.approximate ? '≈' : ''}${String(chip.count)}`}
            tone={look.tone}
            look={look.badgeLook}
            dashed={look.badgeLook === 'outline' || chip.approximate}
            size="sm"
            renderIcon={(color, size) => <Icon size={size} color={color} />}
          />
        )
      })}
      {more > 0 ? <Badge label={`+${String(more)}`} size="sm" /> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  // Placed by the tile (`LibraryTile`'s image-corner slot), so no position here.
  row: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: SPACING.xs },
})
