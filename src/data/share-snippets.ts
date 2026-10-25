/**
 * The Home Assistant card a share dialog offers next to its link: the same
 * frozen view, written as the `camstack-grid-card` / `camstack-events-card`
 * YAML of the CamStack Home Assistant integration.
 *
 * The card carries NO token: the integration mints and injects its own (that
 * is how its relay reaches the hub), so a card needs only the cameras and the
 * view options. The link is the one that needs a token, which is why the
 * dialogs put the token choice under it.
 *
 * Pure: unit tested in `__tests__/share-snippets.spec.ts`.
 */
import type { GridShareParams, ShareHighlight } from '../grid-embed/share-url.js'
import { EVENTS_FIELD_KEYS, type EventsShareParams } from '../../shared/events/events-share-url.js'
import { audioLevelFromStored } from '../components/camera/audio-level.js'

/** A YAML scalar that cannot be misread (a title with `:` or `#` stays a string). */
function yamlString(value: string): string {
  return JSON.stringify(value)
}

/** A YAML list; an empty one is written `key: []`, which the card reads as
 *  "none" — distinct from leaving the key out. */
function listBlock(key: string, items: readonly (string | number)[]): readonly string[] {
  if (items.length === 0) return [`${key}: []`]
  return [`${key}:`, ...items.map((item) => `  - ${item}`)]
}

function deviceIdsBlock(ids: readonly number[]): readonly string[] {
  return listBlock('device_ids', ids)
}

/**
 * The highlight triggers in the card's own vocabulary: the audio trigger as
 * its `low | mid | high` preset (the card has no raw dBFS), the detection
 * classes (absent = any class), the detection hold, and the border colours
 * and thickness the link's `hl=` carries.
 */
function highlightBlock(highlight: ShareHighlight): readonly string[] {
  const lines: string[] = ['highlight: true', `highlight_motion: ${highlight.motion}`]
  if (highlight.audio !== 'off') {
    lines.push(`highlight_audio: ${audioLevelFromStored(highlight.audio, highlight.audioDb)}`)
  }
  if (highlight.detection) {
    lines.push('highlight_detection: true')
    const classes = highlight.detectionClasses ?? []
    if (classes.length > 0) lines.push(...listBlock('highlight_detection_classes', classes))
    lines.push(`highlight_detection_hold: ${highlight.detectionHoldSec}`)
  }
  if (highlight.appearance !== undefined) {
    const { motionColor, audioColor, detectionColor, thickness } = highlight.appearance
    lines.push(
      `highlight_motion_color: ${yamlString(motionColor)}`,
      `highlight_audio_color: ${yamlString(audioColor)}`,
      `highlight_detection_color: ${yamlString(detectionColor)}`,
      `highlight_thickness: ${cardThickness(thickness)}`,
    )
  }
  return lines
}

/** The card's border thickness is an integer 1–8. */
function cardThickness(value: number): number {
  return Math.min(8, Math.max(1, Math.round(value)))
}

/** `camera_names` — the same entries the link's `names=` carries (a numeric id
 *  and a non-blank name), each name quoted. Nothing to carry ⇒ no lines. */
function cameraNamesBlock(names: Readonly<Record<string, string>> | undefined): readonly string[] {
  const entries = Object.entries(names ?? {}).filter(([id, name]) => /^\d+$/.test(id) && name.trim().length > 0)
  if (entries.length === 0) return []
  return ['camera_names:', ...entries.map(([id, name]) => `  ${id}: ${yamlString(name)}`)]
}

/** `camstack-grid-card` for a grid link's view. */
export function gridCardYaml(title: string, params: GridShareParams): string {
  const lines: string[] = ['type: custom:camstack-grid-card', `title: ${yamlString(title)}`, ...deviceIdsBlock(params.devices)]
  if (params.layout === 'auto') {
    lines.push('layout_mode: auto')
  } else {
    lines.push('layout_mode: fit', `columns: ${params.layout}`)
  }
  lines.push(`quality: ${params.quality}`, `show_names: ${params.showName}`)
  if (params.boxes === true) lines.push('show_boxes: true')
  if (params.activeOnly === true) lines.push('active_only: true')
  if (params.audioOnIds !== undefined && params.audioOnIds.length > 0) lines.push(...listBlock('audio_on', params.audioOnIds))
  if (params.highlight?.enabled === true) lines.push(...highlightBlock(params.highlight))
  return `${lines.join('\n')}\n`
}

/**
 * `camstack-events-card` for an events link's view. `fields` is always
 * written, as the link always writes `fields=`: an empty list is "images
 * only", which an absent key is not. No order: the card is newest first.
 */
export function eventsCardYaml(params: EventsShareParams): string {
  const lines: string[] = ['type: custom:camstack-events-card']
  if (params.deviceIds.length > 0) lines.push(...deviceIdsBlock(params.deviceIds))
  lines.push(...cameraNamesBlock(params.deviceNames))
  lines.push(`view: ${params.view}`, `thumb: ${params.thumb}`)
  if (params.view === 'reel' && params.rows !== undefined) lines.push(`rows: ${params.rows}`)
  if (params.view === 'gallery' && params.columns !== undefined) lines.push(`columns: ${params.columns}`)
  lines.push(`theme: ${params.theme}`)
  lines.push(...listBlock('fields', EVENTS_FIELD_KEYS.filter((key) => params.fields[key])))
  return `${lines.join('\n')}\n`
}
