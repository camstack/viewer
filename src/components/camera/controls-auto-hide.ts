/**
 * How long the on-video controls that a tap brings up stay on screen with no
 * interaction before the group asks its parent to hide them (a second tap
 * hides them at once, as before).
 *
 * ONE named constant: `OverlayDiscGroup` arms its timer from it on show and
 * re-arms from it on every press, so "interaction restarts the clock" and "how
 * long is the clock" cannot drift apart. It was 3500 ms, which in landscape
 * took the controls away before a thumb could reach the timeline toggle.
 */
export const CONTROLS_AUTO_HIDE_MS = 10_000
