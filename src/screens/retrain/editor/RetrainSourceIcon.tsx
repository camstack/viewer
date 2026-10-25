/**
 * Who proposed a box, as a small glyph — on the canvas label and in the list
 * row. The review diff owns the colour; the source is only an icon, so the two
 * never compete for the same signal.
 */
import React from 'react'
import { Bot, PenLine, ScanSearch, Workflow, type LucideIcon } from '../../../lib/icons.js'
import type { EditorBox } from '../../../retrain/editor.js'

export type BoxSource = EditorBox['source']

const ICONS: Readonly<Record<BoxSource, LucideIcon>> = {
  operator: PenLine,
  pipeline: Workflow,
  assist: ScanSearch,
  llm: Bot,
}

export const SOURCE_LABEL: Readonly<Record<BoxSource, { key: string; fallback: string }>> = {
  operator: { key: 'v2.retrain.source.operator', fallback: 'Drawn' },
  pipeline: { key: 'v2.retrain.source.pipeline', fallback: 'Pipeline' },
  assist: { key: 'v2.retrain.source.assist', fallback: 'Detector' },
  llm: { key: 'v2.retrain.source.llm', fallback: 'AI vision' },
}

export function RetrainSourceIcon({
  source,
  size = 12,
  color,
}: {
  readonly source: BoxSource
  readonly size?: number
  readonly color: string
}): React.JSX.Element {
  const Icon = ICONS[source]
  return <Icon size={size} color={color} />
}
