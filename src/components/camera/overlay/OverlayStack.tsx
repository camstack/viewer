/**
 * OverlayStack — lays the overlays of a stream out in their anchors' stacks.
 *
 * Takes the overlays of a stream (the ones a `fade` flag hides are flagged
 * `hidden`: kept mounted in place with `display: none`, so their data keeps
 * flowing and a fade toggle never remounts them)
 * and renders one stack per anchor, in the container's coordinate space. The rules — order, direction, budgets — are the pure
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
  /** Faded out: not laid out and not drawn, but still MOUNTED so its data
   *  hooks keep receiving — hiding is visual only. */
  readonly hidden?: boolean
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
  // Every entry lives in ITS anchor's stack, hidden or not, so a fade toggle
  // only flips a style: the node is never moved to another parent, and its
  // state (a meter's smoothing, a probe's subscription) survives. Only the
  // visible entries decide how much room the corners share.
  const stacks = useMemo(
    () => buildStacks(entries.map(({ id, anchor }) => ({ id, anchor })), userOrder),
    [entries, userOrder],
  )
  const occupied = useMemo(
    () => new Set(entries.filter((e) => e.hidden !== true).map((e) => e.anchor)),
    [entries],
  )
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {stacks.map((stack) => (
        <View key={stack.anchor} style={stackBox(stack.anchor, occupied, inset)} pointerEvents="box-none">
          {stack.ids.map((id) => {
            const entry = entries.find((e) => e.id === id)
            return (
              <View
                key={id}
                style={entry?.hidden === true ? styles.hidden : undefined}
                pointerEvents={entry?.hidden === true ? 'none' : 'box-none'}
              >
                {entry?.node}
              </View>
            )
          })}
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  hidden: { display: 'none' },
})
