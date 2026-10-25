/**
 * display-menu — the declaration behind {@link DisplayMenu}: the ONE menu every
 * Library page opens from its eye (Events, People, Plates). Operator,
 * 2026-10-23: the eyes were two different menus (white cards with segments on
 * Events, a long checkbox list on People and Plates); they are now one
 * pattern in the Events style.
 *
 * A menu is a list of {@link DisplayMenuSection}s; each draws as one card under
 * an uppercase title that says what the card is about. Inside it:
 *
 * - a `choice` — ONE of a few answers, drawn as a segmented control (the
 *   card's title is its label, so a choice carries none of its own);
 * - a `toggle` — on / off, drawn as a switch row with its label.
 *
 * Pages build the list with a pure function next to their state
 * (`events-display-menu.ts`, `review-filter-bar.ts`), which is what the specs
 * pin. Pure and RN-free.
 */

/** One answer of a choice. */
export interface DisplayMenuOption {
  readonly value: string
  readonly label: string
}

/** One of a few answers, as a segmented control. */
export interface DisplayMenuChoice {
  readonly kind: 'choice'
  readonly id: string
  readonly options: readonly DisplayMenuOption[]
  readonly value: string
  /** Called with the picked option's `value` (one of `options`). */
  readonly onChange: (value: string) => void
}

/** On / off, as a switch row. */
export interface DisplayMenuToggle {
  readonly kind: 'toggle'
  readonly id: string
  readonly label: string
  readonly value: boolean
  readonly onChange: (value: boolean) => void
}

export type DisplayMenuItem = DisplayMenuChoice | DisplayMenuToggle

/** One card: its title and what it holds. */
export interface DisplayMenuSection {
  readonly id: string
  /** Drawn uppercase above the card — every card has one. */
  readonly title: string
  readonly items: readonly DisplayMenuItem[]
}

/**
 * The menu's width on every page: a three-way choice of the longest Italian
 * words ("Decrescente | Crescente", "Piccola | Media | Grande") fits at the
 * chips' type size, and it stays inside a 390 pt phone with the gutters.
 */
export const DISPLAY_MENU_WIDTH = 300

/** Typed lookup of a choice's picked value among a closed set. */
export function pickValue<T extends string>(values: readonly T[], value: string): T | undefined {
  return values.find((v) => v === value)
}
