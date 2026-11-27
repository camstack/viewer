/**
 * HighlightClassChips — multiselect of detection macro classes for the highlight
 * settings (grid wall menu, grid builder, camera menu). The stored empty list
 * (= any class) shows as every class ticked; the caller maps the edit back
 * (`highlight-classes.ts`). The class list is `shared/highlight-classes.ts`.
 *
 * Drawn as the Library's ONE picker idiom — the checkbox list of the filter
 * menus (`SectionMultiselect`) — so choosing which classes light a wall reads
 * exactly like choosing which classes filter a page (operator, 2026-10-21).
 * This file is the class vocabulary, nothing more.
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { SectionMultiselect } from '../events/EventKindTree.js'
import { HIGHLIGHT_DETECTION_CLASSES, classesForEditor } from '../../../shared/highlight-classes.js'

/** The label of a class: `person`, `vehicle`, `animal`, `package`, `face`, `plate`. */
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
  // The stored empty list means "any class": shown as every class ticked.
  const ticked = classesForEditor(selected)
  const toggle = (key: string): void => {
    const cls = HIGHLIGHT_DETECTION_CLASSES.find((c) => c === key)
    if (cls === undefined) return
    onChange(ticked.includes(cls) ? ticked.filter((c) => c !== cls) : [...ticked, cls])
  }
  return (
    <SectionMultiselect
      title={t('v2.events.classes')}
      emptyLabel={t('v2.events.all')}
      items={HIGHLIGHT_DETECTION_CLASSES.map((cls) => ({
        key: cls,
        label: labelOf(cls, t),
        selected: ticked.includes(cls),
      }))}
      onToggle={toggle}
    />
  )
}
