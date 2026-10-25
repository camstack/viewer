/**
 * Overlay play/pause vs the docked playback bar.
 *
 * The bar already carries play/pause whenever it is on screen. The overlay
 * disc exists for the cases where the bar is NOT, and showing both at once was
 * the operator's "due pulsanti play" report.
 *
 * So the question is purely a LAYOUT one: the bar rides in the timeline, the
 * timeline rides in the landscape drawer while the picture owns the window
 * (`detail-layout.ts`), and the disc covers exactly the gap — `fill` with that
 * drawer shut.
 *
 * ## The battery short-circuit, and why it is gone (D606)
 *
 * For one release this also answered true whenever the camera sat on the
 * battery hold, in every layout. The reason was real: the NATIVE clips surface
 * withdrew the transport band, so a held camera inside its own clip list had
 * no way to start the live at all — poster, no disc, no band.
 *
 * But the cause was in the other file, and its own docstring said so: *a
 * battery hold is a STREAM state, not a time control.* A body of files has no
 * time axis; the PLAYER it sits under still has a picture and still has a
 * transport. `resolveClipsSurface` now answers `transport: true` on every
 * surface, the band is on screen wherever it was before, and the same camera
 * in the same stopped state gets the same control — which is what the operator
 * could not get: *"quando una camera a batteria non dorme non è la stessa
 * modalità di stop: invece della playback bar abbiamo il pulsante sullo
 * stream. È inconsistente."*
 *
 * A workaround left behind after its cause is fixed reads as verification that
 * the cause is still there, so it is deleted rather than kept "in case".
 */
export function shouldShowOverlayPlayPause(args: {
  readonly fill: boolean
  readonly landscapeDrawerOpen: boolean
}): boolean {
  return args.fill && !args.landscapeDrawerOpen
}
