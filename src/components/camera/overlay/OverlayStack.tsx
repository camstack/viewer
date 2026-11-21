/**
 * OverlayStack — lays the overlays of a stream out in their anchors' stacks.
 *
 * Takes the overlays that are DRAWN (the caller has already dropped the ones
 * a `fade` flag hides) and renders one stack per anchor, in the container's
 * coordinate space. The rules — order, direction, budgets — are the pure
 * `overlay-stack.ts`; this component only turns them into views. It never
 * takes a touch itself (`box-none`): the picture's gestures reach through it,
 * and a node that wants touches (the control groups) takes them.
 */
import React, { useMemo } from 'react'
import { StyleSheet, View } from 'react-native'
import { SPACING } from '../../../theme/tokens.js'
import type { OverlayItemId } from './overlay-config.js'
import type { OverlayAnchor } from './overlay-position.js'
import { buildStacks, stackBox, type StackInset } from './overlay-stack.js'

/** One overlay to draw: who it is, where it goes, and what it renders. */
export interface OverlayStackEntry {
  readonly id: OverlayItemId
  readonly anchor: OverlayAnchor
  readonly node: React.ReactNode
}

export interface OverlayStackProps {
  readonly entries: readonly OverlayStackEntry[]
  /** `OverlayConfig.order` — the operator's stacking order. */
  readonly userOrder: readonly OverlayItemId[]
  /** Safe-area insets to add to the base gutter (fill / landscape pass the
   *  window's; portrait omits them — its box is already clear of the notch). */
  readonly edgePad?: { readonly left: number; readonly right: number; readonly bottom: number; readonly top?: number }
}

export function OverlayStack({ entries, userOrder, edgePad }: OverlayStackProps): React.JSX.Element {
  const inset = useMemo<StackInset>(
    () => ({
      top: SPACING.md + (edgePad?.top ?? 0),
      bottom: SPACING.md + (edgePad?.bottom ?? 0),
      left: SPACING.md + (edgePad?.left ?? 0),
      right: SPACING.md + (edgePad?.right ?? 0),
    }),
    [edgePad?.top, edgePad?.bottom, edgePad?.left, edgePad?.right],
  )
  const stacks = useMemo(
    () => buildStacks(entries.map(({ id, anchor }) => ({ id, anchor })), userOrder),
    [entries, userOrder],
  )
  const occupied = useMemo(() => new Set(stacks.map((s) => s.anchor)), [stacks])
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {stacks.map((stack) => (
        <View key={stack.anchor} style={stackBox(stack.anchor, occupied, inset)} pointerEvents="box-none">
          {stack.ids.map((id) => (
            <React.Fragment key={id}>{entries.find((e) => e.id === id)?.node}</React.Fragment>
          ))}
        </View>
      ))}
    </View>
  )
}
