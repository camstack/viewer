/**
 * How tall the device sheet is. The hub card inside it is a web page in a
 * WebView / iframe, which does not size itself to its content, so the sheet
 * gives it a fixed share of the window: enough for the card's own dialogs
 * (power confirm, timed run) to open inside it, never the whole screen.
 */
import type { SheetPresentation } from '../components/ui/SheetModal.js'

/** Share of the window a phone sheet takes. */
export const DEVICE_SHEET_RATIO = 0.7
/** Share of the window a web dialog takes, before its cap. */
export const DEVICE_DIALOG_RATIO = 0.75
/** Tallest a web dialog grows, px. */
export const DEVICE_DIALOG_MAX_HEIGHT = 640

export function deviceSheetHeight(presentation: SheetPresentation, windowHeight: number): number {
  return presentation === 'sheet'
    ? Math.round(windowHeight * DEVICE_SHEET_RATIO)
    : Math.min(Math.round(windowHeight * DEVICE_DIALOG_RATIO), DEVICE_DIALOG_MAX_HEIGHT)
}
