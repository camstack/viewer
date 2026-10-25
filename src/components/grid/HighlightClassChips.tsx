/**
 * HighlightClassChips — multiselect of detection macro classes for the highlight
 * settings (grid wall menu, grid builder, camera menu). Empty selection = any
 * class. Classes come from @camstack/types (`DETECTION_MACRO_CLASSES`).
 *
 * Drawn as the Library's ONE picker idiom — the checkbox list of the filter
 * menus (`SectionMultiselect`) — so choosing which classes light a wall reads
 * exactly like choosing which classes filter a page (operator, 2026-10-21).
 * This file is the class vocabulary, nothing more.
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { SectionMultiselect } from '../events/EventKindTree.js'
import { DETECTION_MACRO_CLASSES } from '../../store/grid-store.js'

type MacroClass = (typeof DETECTION_MACRO_CLASSES)[number]

const LABEL_KEY: Readonly<Record<MacroClass, string>> = {
  person: 'v2.library.macroClass.person',
  vehicle: 'v2.library.macroClass.vehicle',
  animal: 'v2.library.macroClass.animal',
  face: 'v2.library.macroClass.face',
  plate: 'v2.library.macroClass.plate',
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
    const cls = DETECTION_MACRO_CLASSES.find((c) => c === key)
    if (cls === undefined) return
    onChange(selected.includes(cls) ? selected.filter((c) => c !== cls) : [...selected, cls])
  }
  return (
    <SectionMultiselect
      title={t('v2.events.classes')}
      emptyLabel={t('v2.events.all')}
      items={DETECTION_MACRO_CLASSES.map((cls) => ({
        key: cls,
        label: t(LABEL_KEY[cls]),
        selected: selected.includes(cls),
      }))}
      onToggle={toggle}
    />
  )
}
