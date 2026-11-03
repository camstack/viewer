/**
 * The remote layout the viewer draws: the saved grid of a `remote` extension
 * (columns × rows, buttons, group frames), read from the hub's template store.
 * The admin UI draws the same payload; here it is parsed STRUCTURALLY, because
 * the schema's value is not part of the viewer's `@camstack/types/client` entry.
 * A payload that is not a remote layout is `null` — "we cannot draw it", never
 * an empty remote.
 *
 * Pure: no React, no hub. The sheet (`RemoteSheet.tsx`) places what this returns.
 */

import { remoteRoleIcon, remoteRoleLabel, remoteRoleLegend, type VocabLocale } from '@camstack/types'

export interface RemoteLayoutButton {
  readonly id: string
  readonly role: string
  readonly row: number
  readonly col: number
  readonly rowSpan: number
  readonly colSpan: number
  readonly icon?: string
  readonly label?: string
  readonly shape?: string
  readonly tone?: string
}

export interface RemoteLayoutGroup {
  readonly id: string
  readonly frame: string
  readonly row: number
  readonly col: number
  readonly rowSpan: number
  readonly colSpan: number
}

export interface RemoteLayout {
  readonly columns: number
  readonly rows: number
  readonly buttons: readonly RemoteLayoutButton[]
  readonly groups: readonly RemoteLayoutGroup[]
}

/** The answer of `remote.listCommands`: the layout it points at and the roles a press can reach. */
export interface RemoteCommandList {
  readonly layoutTemplateId: string | null
  readonly roles: readonly string[]
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

function posInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0
}

function spanInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1
}

function optString(v: unknown): string | undefined {
  return typeof v === 'string' && v !== '' ? v : undefined
}

function parseButton(raw: unknown): RemoteLayoutButton | null {
  if (!isRecord(raw)) return null
  const { id, role, row, col, rowSpan, colSpan } = raw
  if (typeof id !== 'string' || typeof role !== 'string') return null
  if (!posInt(row) || !posInt(col) || !spanInt(rowSpan) || !spanInt(colSpan)) return null
  const icon = optString(raw.icon)
  const label = optString(raw.label)
  const shape = optString(raw.shape)
  const tone = optString(raw.tone)
  return {
    id, role, row, col, rowSpan, colSpan,
    ...(icon === undefined ? {} : { icon }),
    ...(label === undefined ? {} : { label }),
    ...(shape === undefined ? {} : { shape }),
    ...(tone === undefined ? {} : { tone }),
  }
}

function parseGroup(raw: unknown): RemoteLayoutGroup | null {
  if (!isRecord(raw)) return null
  const { id, frame, row, col, rowSpan, colSpan } = raw
  if (typeof id !== 'string' || typeof frame !== 'string') return null
  if (!posInt(row) || !posInt(col) || !spanInt(rowSpan) || !spanInt(colSpan)) return null
  return { id, frame, row, col, rowSpan, colSpan }
}

/** A stored template payload as a layout, or `null` when it is not a remote layout. */
export function parseRemoteLayout(payload: unknown): RemoteLayout | null {
  if (!isRecord(payload)) return null
  const { columns, rows, buttons, groups } = payload
  if (!spanInt(columns) || !spanInt(rows) || !Array.isArray(buttons)) return null
  const parsedButtons = buttons.map(parseButton)
  if (parsedButtons.some((b) => b === null)) return null
  const parsedGroups = Array.isArray(groups) ? groups.map(parseGroup) : []
  if (parsedGroups.some((g) => g === null)) return null
  return {
    columns,
    rows,
    buttons: parsedButtons.filter((b): b is RemoteLayoutButton => b !== null),
    groups: parsedGroups.filter((g): g is RemoteLayoutGroup => g !== null),
  }
}

/** The `remote.listCommands` answer, or `null` when it is not that shape (unknown, not "no commands"). */
export function parseRemoteCommandList(raw: unknown): RemoteCommandList | null {
  if (!isRecord(raw) || !Array.isArray(raw.commands)) return null
  const roles: string[] = []
  for (const entry of raw.commands) {
    if (isRecord(entry) && typeof entry.role === 'string') roles.push(entry.role)
  }
  const id = raw.layoutTemplateId
  return { layoutTemplateId: typeof id === 'string' && id !== '' ? id : null, roles }
}

/** The payload of the remote template `templateId` out of a `template.list` answer. */
export function remoteLayoutFromTemplates(raw: unknown, templateId: string): RemoteLayout | null {
  if (!Array.isArray(raw)) return null
  for (const entry of raw) {
    if (isRecord(entry) && entry.id === templateId) return parseRemoteLayout(entry.payload)
  }
  return null
}

/** The vocabulary's locales: the app language as `it` or `en` (anything else is English). */
export function vocabLocale(language: string | undefined): VocabLocale {
  return typeof language === 'string' && language.slice(0, 2).toLowerCase() === 'it' ? 'it' : 'en'
}

/** A key's name: its own label, else the shared vocabulary's name for its role in `locale`. */
export function keyName(button: RemoteLayoutButton, locale: VocabLocale): string {
  return button.label ?? remoteRoleLabel(button.role, locale)
}

/** A key's glyph: the layout's own icon, else the vocabulary's (a custom or unknown role wears the circle). */
export function keyIcon(button: RemoteLayoutButton): string {
  return button.icon ?? remoteRoleIcon(button.role)
}

/** Text printed on a key instead of a glyph (a digit), or `undefined`. */
export function keyLegend(button: RemoteLayoutButton): string | undefined {
  return button.icon === undefined ? remoteRoleLegend(button.role) : undefined
}

/** The buttons that do something: a role the remote has a bound command for. */
export function isBound(button: RemoteLayoutButton, bound: ReadonlySet<string>): boolean {
  return bound.has(button.role)
}

/** A divider takes a thin row of its own; every other group frames its cells. */
export function isDividerFrame(frame: string): boolean {
  return frame === 'divider'
}

/** Rows that hold only dividers: drawn as a thin strip, as the admin remote does. */
export function slimRows(layout: RemoteLayout): ReadonlySet<number> {
  const slim = new Set<number>()
  for (const group of layout.groups) {
    if (!isDividerFrame(group.frame) || group.rowSpan !== 1) continue
    const row = group.row
    const shared =
      layout.buttons.some((b) => b.row <= row && row < b.row + b.rowSpan) ||
      layout.groups.some((g) => g !== group && g.row <= row && row < g.row + g.rowSpan)
    if (!shared) slim.add(row)
  }
  return slim
}

/** The vertical offset and height of a row span, in units of one full row (a slim row is `slimUnit`). */
export function rowSpanBox(
  layout: RemoteLayout,
  row: number,
  rowSpan: number,
  slimUnit: number,
): { readonly top: number; readonly height: number } {
  const slim = slimRows(layout)
  const unit = (r: number): number => (slim.has(r) ? slimUnit : 1)
  let top = 0
  for (let r = 0; r < row; r += 1) top += unit(r)
  let height = 0
  for (let r = row; r < row + rowSpan; r += 1) height += unit(r)
  return { top, height }
}

/** The height of the whole grid in full-row units. */
export function totalRows(layout: RemoteLayout, slimUnit: number): number {
  return rowSpanBox(layout, 0, layout.rows, slimUnit).height
}
