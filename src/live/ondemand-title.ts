/**
 * What the on-demand overlay writes in its header.
 *
 * It used to write `v2.onDemandPlayer.title` — the window's KIND. That names
 * the feature, not its subject, and the subject is the whole reason the window
 * exists: a second camera playing beside the primary one. Two overlays, or an
 * overlay beside the stream it was opened from, were indistinguishable.
 *
 * Pure, so the fallback cases are pinned rather than discovered: the camera list
 * arrives from a query and is empty before it answers, a camera can be removed
 * while its overlay is open, and a name the operator cleared is a real row that
 * would otherwise render as a blank strip.
 */

/** The slice of a camera this needs — `id`, as `CameraInfo` spells it.
 *  Narrowed so a test needs no fixture and no cast at the call site. */
export interface NamedCamera {
  readonly id: number
  readonly name: string
}

export function onDemandTitle(
  cameras: readonly NamedCamera[],
  deviceId: number,
  fallback: string,
): string {
  const name = cameras.find((c) => c.id === deviceId)?.name?.trim()
  return name !== undefined && name.length > 0 ? name : fallback
}
