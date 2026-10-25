/**
 * user-menu-width — how wide the account menu is drawn, as a pure computation.
 *
 * The menu used to open at the account block's width floor (320 px) whatever it
 * held, so a two-word row sat in half a screen of empty card. Its width is now
 * the widest ROW (padding, glyph, gap and text included), clamped between a
 * touch-friendly minimum and a sensible maximum. Text is measured by an average
 * glyph advance — there is no layout pass before the menu is placed — with a
 * little slack so a real glyph run never ellipsises.
 */
import { SPACING } from '../theme/tokens.js'

/** Narrowest the menu is drawn (px): a comfortable touch target for a short label. */
export const USER_MENU_MIN_WIDTH = 176
/** Widest the menu is drawn (px); a longer name or server ellipsises. */
export const USER_MENU_MAX_WIDTH = 300

/** Average advance of a glyph as a fraction of the font size, with slack. */
const GLYPH_ADVANCE = 0.6

/** Drawn sizes of the menu's rows (see `UserMenuButton`). */
const HEADER_NAME_SIZE = 15
const HEADER_SERVER_SIZE = 12
const ENTRY_SIZE = 15
const SERVER_SIZE = 14
const ENTRY_ICON = 18
const SERVER_ICON = 16
const ROW_PADDING = SPACING.xl * 2
const ICON_GAP = SPACING.lg

export function textWidth(text: string, fontSize: number): number {
  return text.length * fontSize * GLYPH_ADVANCE
}

export interface UserMenuWidthInput {
  /** The signed-in name (or its placeholder). */
  readonly headerName: string
  /** The active server's label; empty when the header omits it. */
  readonly headerServer: string
  /** The Settings / Sign out labels, as drawn. */
  readonly entryLabels: readonly string[]
  /** The inline server list's labels (empty below two servers). */
  readonly serverLabels: readonly string[]
}

function widest(widths: readonly number[]): number {
  return widths.reduce((max, width) => Math.max(max, width), 0)
}

export function userMenuWidth(input: UserMenuWidthInput): number {
  const header = ROW_PADDING + Math.max(
    textWidth(input.headerName, HEADER_NAME_SIZE),
    textWidth(input.headerServer, HEADER_SERVER_SIZE),
  )
  const entries = input.entryLabels.map((label) => ROW_PADDING + ENTRY_ICON + ICON_GAP + textWidth(label, ENTRY_SIZE))
  // A server row reserves the check mark's room: any of them can be the current one.
  const servers = input.serverLabels.map(
    (label) => ROW_PADDING + SERVER_ICON + ICON_GAP + textWidth(label, SERVER_SIZE) + ICON_GAP + SERVER_ICON,
  )
  const content = Math.ceil(widest([header, ...entries, ...servers]))
  return Math.min(USER_MENU_MAX_WIDTH, Math.max(USER_MENU_MIN_WIDTH, content))
}
