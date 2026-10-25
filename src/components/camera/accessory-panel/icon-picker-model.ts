/**
 * The icon picker's data: the whole catalog (D854) in sections by primary
 * category, or the sections a search leaves standing. Pure — no React.
 *
 * Search is the catalog's own `searchIcons` (key, lucide tags and the Italian
 * and English room words), best hit first inside a section. An icon sits in
 * exactly one section, its PRIMARY category (`iconsInCategory` also returns
 * the icons that merely list the category).
 */
import {
  ICON_CATEGORIES,
  iconsInCategory,
  searchIcons,
} from '@camstack/types/client'
import type { IconCategoryId, IconKey } from '@camstack/types'

export interface IconSection {
  readonly category: IconCategoryId
  readonly keys: readonly IconKey[]
}

/** A flat row of the virtualised list: a section header or up to N tiles. */
export type IconListRow =
  | { readonly kind: 'header'; readonly id: string; readonly category: IconCategoryId }
  | { readonly kind: 'tiles'; readonly id: string; readonly keys: readonly IconKey[] }

const ALL_SECTIONS: readonly IconSection[] = ICON_CATEGORIES.map((category) => ({
  category,
  keys: iconsInCategory(category)
    .filter((entry) => entry.primaryCategory === category)
    .map((entry) => entry.key),
})).filter((section) => section.keys.length > 0)

export function iconSections(query: string): readonly IconSection[] {
  if (query.trim().length === 0) return ALL_SECTIONS
  const byCategory = new Map<IconCategoryId, IconKey[]>()
  for (const hit of searchIcons(query)) {
    const list = byCategory.get(hit.entry.primaryCategory) ?? []
    list.push(hit.entry.key)
    byCategory.set(hit.entry.primaryCategory, list)
  }
  return ICON_CATEGORIES.flatMap((category) => {
    const keys = byCategory.get(category)
    return keys === undefined ? [] : [{ category, keys }]
  })
}

/** Sections as list rows, `columns` tiles per row. */
export function iconListRows(
  sections: readonly IconSection[],
  columns: number,
): readonly IconListRow[] {
  const per = Math.max(1, columns)
  const rows: IconListRow[] = []
  for (const section of sections) {
    rows.push({ kind: 'header', id: `h:${section.category}`, category: section.category })
    for (let i = 0; i < section.keys.length; i += per) {
      rows.push({
        kind: 'tiles',
        id: `t:${section.category}:${i}`,
        keys: section.keys.slice(i, i + per),
      })
    }
  }
  return rows
}
