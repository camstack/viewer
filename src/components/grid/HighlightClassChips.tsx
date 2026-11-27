/**
 * HighlightClassChips — multiselect of detection classes for the highlight
 * settings. On the global highlight the selection IS the detection switch
 * (empty = off); the reel and share surfaces read an empty selection as any
 * class. The vocabulary is `HIGHLIGHT_DETECTION_CLASSES` (the detector's macro
 * labels from `@camstack/types/client`, plus face and plate).
 *
 * Drawn as the Library's ONE picker idiom — the checkbox list of the filter
 * menus (`SectionMultiselect`) — so choosing which classes light a wall reads
 * exactly like choosing which classes filter a page (operator, 2026-10-21).
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { SectionMultiselect } from '../events/EventKindTree.js'
import { HIGHLIGHT_DETECTION_CLASSES } from '../../store/highlight-global.js'

/** The label key of a class; a class this build has no word for shows as is. */
function labelOf(cls: string, t: (key: string) => string): string {
  return t(`v2.library.macroClass.${cls}`)
}

export function HighlightClassChips({
  selected,
  onChange,
}: {
  readonly selected: readonly string[]
  readonly onChange: (next: string[]) => void
}) {
  const { t } = useTranslation()
  const toggle = (key: string): void => {
    const cls = HIGHLIGHT_DETECTION_CLASSES.find((c) => c === key)
    if (cls === undefined) return
    onChange(selected.includes(cls) ? selected.filter((c) => c !== cls) : [...selected, cls])
  }
  return (
    <SectionMultiselect
      title={t('v2.events.classes')}
      emptyLabel={t('v2.events.all')}
      items={HIGHLIGHT_DETECTION_CLASSES.map((cls) => ({
        key: cls,
        label: labelOf(cls, t),
        selected: selected.includes(cls),
      }))}
      onToggle={toggle}
    />
  )
}
