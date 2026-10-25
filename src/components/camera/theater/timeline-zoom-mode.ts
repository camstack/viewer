/**
 * timeline-zoom-mode — Auto vs a fixed ladder index for the theater range chip.
 *
 * Lives outside `TimelineFooterBar` on purpose: the docked-chrome guard allows
 * exactly one importer of that band (`TimelineView`). The host still needs the
 * mode type to own Auto state, so the type cannot ride on the bar's module.
 */

export type TimelineZoomMode = 'auto' | 'fixed'
