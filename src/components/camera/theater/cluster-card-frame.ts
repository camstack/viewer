/**
 * cluster-card-frame — which border of a `ClusterCard` wears the accent.
 *
 * Clips mode holds one thumbnail, and that thumbnail is already the tilted
 * pill: lighting the card's border AND the pill's drew two concentric squares
 * around the selected clip (#443). There, the pill alone is the frame. The
 * event gallery keeps two levels — the card names the selected group, the
 * pill the member tapped inside it.
 */

export interface ClusterCardFrameInput {
  /** The event gallery (true) or clips mode's single thumbnail (false). */
  readonly paging: boolean
  /** The card is the timeline's selected one. */
  readonly selected: boolean
  /** The card's clip is the one playing. */
  readonly playing: boolean
  /** This thumbnail is the card's selected member (gallery) / its only one (clips). */
  readonly active: boolean
}

export interface ClusterCardFrame {
  /** The card's own border is the accent. */
  readonly card: boolean
  /** The thumbnail pill's border is the accent. */
  readonly pill: boolean
}

export function clusterCardFrame(input: ClusterCardFrameInput): ClusterCardFrame {
  if (!input.paging) {
    return { card: false, pill: input.selected || input.playing }
  }
  return { card: input.selected || input.playing, pill: input.active }
}
