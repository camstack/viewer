/**
 * BelowStreamArea — what occupies the space `STREAM_MAX_HEIGHT_FRACTION` has
 * reserved under the picture, in the two states it now has.
 *
 * With one camera on screen it is exactly what shipped: the wrapping rows of
 * snapshot cards. As soon as another camera joins the view the picture above it
 * becomes a WALL (`WorkspaceStage`, in the stream slot) and the snapshots shrink
 * to one horizontally scrolling row, so every point they give up is a point of
 * live picture. The rule is `workspace-grid.ts`, pure and asserted by value; the
 * SCREEN owns the answer, because it is the same answer that decides what goes
 * in the slot above — this file is handed it rather than computing a second one.
 *
 * Until 2026-09-02 the wall was drawn HERE, under a picture that stayed a
 * separate `<LiveView>`. It is not any more; what is left here is the reel.
 *
 * ## It is exactly as wide as the picture, from the picture's own number
 *
 * `width` is `computeWideDetailSizes().streamWidth` — the SAME value the stream
 * slot above is sized with, passed down rather than re-derived. It used to be
 * `alignSelf: 'stretch'`, which is the stream SLOT's width (the column: window
 * minus side nav minus rail), and the two are only equal while the column is
 * the binding cap. The moment the 62% height cap binds — every wide web window,
 * and any tablet whose column outruns `viewportHeight * 16/9 * 0.62` — the
 * picture is centred and narrower while everything below it ran the full
 * column, so the reel overhung the picture on both sides. One number, one edge;
 * a second derivation here is how they drifted.
 *
 * It exists as its own component rather than inline in `CameraDetailScreen` for
 * one reason: it subscribes to the workspace store, and that screen is the most
 * scarred file in the repo. Here the subscription's blast radius is this
 * subtree.
 */
import React, { useEffect, useMemo } from 'react'
import { View, StyleSheet } from 'react-native'

import { useCameras } from '../../data/use-cameras.js'
import { useWorkspaceStore } from '../../store/workspace-store.js'
import type { GridCellPanelKind } from '../../grid/cell-controls.js'
import { CameraShelf } from './CameraShelf.js'
import { shelfVariantFor, workspaceOnScreenCameras } from './workspace-grid.js'

export interface BelowStreamAreaProps {
  /** The picture's width (`computeWideDetailSizes().streamWidth`). This column
   *  takes exactly it, so its right edge is the picture's right edge. */
  readonly width: number
  /** The camera the screen is routed to — the primary, and the head of the
   *  wall when there is one. */
  readonly currentDeviceId: number
  /** Is the slot above showing the WALL? The screen's answer, handed down: the
   *  reel's variant and the wall's existence are one decision, and computing it
   *  twice is how this feature's gate went wrong the first time. */
  readonly wallShowing: boolean
  /** `router.replace('/camera/<id>')` — from a card, or from a cell's own
   *  "open" button. That camera becomes the primary. */
  readonly onGoTo: (deviceId: number) => void
  readonly onCellPanel: (kind: GridCellPanelKind, deviceId: number) => void
  /** Open THAT camera in the on-demand player (D483) — passed straight through
   *  to the reel's cards. The screen resolves the INSTANT; see `CameraShelf`. */
  readonly onOpenPlayback: (deviceId: number) => void
}

export function BelowStreamArea({
  width,
  currentDeviceId,
  wallShowing,
  onGoTo,
  onCellPanel,
  onOpenPlayback,
}: BelowStreamAreaProps): React.JSX.Element {
  const { data: cameras } = useCameras()
  const members = useWorkspaceStore((s) => s.workspace.members)
  const reconcile = useWorkspaceStore((s) => s.reconcile)

  // A member that is no longer a camera we know about (removed, hidden, a
  // permission narrowed) must leave the view, or the wall reserves a cell for
  // a device nothing can draw. Guarded on a list that actually ARRIVED: an
  // empty `cameras` while the query is still in flight is not the claim "none
  // of these exist", and acting on it would empty the view on every cold open.
  useEffect(() => {
    if (cameras === undefined || cameras.length === 0) return
    reconcile(cameras.map((c) => c.id))
  }, [cameras, reconcile])

  // What the reel must NOT list, because it is already drawn above. The same
  // list the wall is built from, so a camera can never be on screen and offered
  // at the same time. The shelf drops `currentDeviceId` on its own too; passing
  // the whole on-screen list rather than a trimmed copy is one derivation
  // instead of two.
  const onScreen = useMemo(
    () => workspaceOnScreenCameras(members, currentDeviceId),
    [members, currentDeviceId],
  )

  return (
    <View style={[wallShowing ? styles.rootStrip : styles.root, { width }]}>
      <CameraShelf
        currentDeviceId={currentDeviceId}
        contentWidth={width}
        variant={shelfVariantFor(wallShowing)}
        alreadyOnScreen={onScreen}
        onGoTo={onGoTo}
        onCellPanel={onCellPanel}
        onOpenPlayback={onOpenPlayback}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  /** Under the single PICTURE: the picture's box is explicit, so this takes
   *  everything left over and the wrapping rows fill it.
   *
   *  `alignSelf: 'center'` and not `'stretch'`: the stream slot centres its
   *  children (`streamSlotStyle`), so a column that is the picture's WIDTH has
   *  to be centred by the same rule to land under it. The width itself arrives
   *  as a prop — see the module docblock. */
  root: { flex: 1, minHeight: 0, alignSelf: 'center' },
  /** Under the WALL: no flex at all. The wall is the slot's flexing child, so a
   *  second `flex: 1` here would split the column with it 50/50 instead of
   *  leaving it everything above `SHELF_STRIP_HEIGHT` — which the strip already
   *  states, fixed, on its own root (`CameraShelf.rootStrip`). */
  rootStrip: { alignSelf: 'center' },
})
