/**
 * hero-card-view — what the hero CARD of a device draws from a `HeroModel`, as
 * pure data: the scene, the facts under it, the device's own power, the rows
 * with their controls, and whether the remote button is offered.
 *
 * `gated` lists the parts this session must not act on; they are dropped here,
 * never shown disabled (a greyed control claims a capability the session lacks).
 */
import type { HeroControl, HeroModel, HeroRow, HeroSideTile } from '@camstack/types'
import { heroText, statusLineText, type HeroLocale } from './hero-view.js'

export interface HeroCardView {
  readonly title: string
  readonly icon: string
  readonly tone: HeroModel['look']['tone']
  readonly level: number | null
  readonly muted: boolean
  /** The facts under the scene, as text, never wrapping past the card. */
  readonly facts: readonly { readonly text: string; readonly icon: string | null; readonly tone: HeroModel['look']['tone'] }[]
  readonly tiles: readonly { readonly label: string; readonly value: string }[]
  /** The device's own power as a toggle, or `null` (absent or gated). */
  readonly power: HeroControl | null
  readonly rows: readonly { readonly id: string; readonly icon: string; readonly status: string; readonly controls: readonly HeroControl[] }[]
  /** The remote button is offered (the device has a remote and the session may press it). */
  readonly remote: boolean
  /** Some actuating part is drawn: the legacy primary stage is not needed. */
  readonly hasControls: boolean
}

function powerControl(model: HeroModel): HeroControl | null {
  const power = model.ownPower
  if (power === null || model.gated.includes('own-power')) return null
  return { kind: 'toggle', id: 'own-power', label: power.turnOn.label, on: power.on, turnOn: power.turnOn, turnOff: power.turnOff }
}

function rowView(row: HeroRow, model: HeroModel, locale: HeroLocale): HeroCardView['rows'][number] {
  return {
    id: row.id,
    icon: row.icon,
    status: row.status === null ? '' : heroText(row.status, locale),
    controls: model.gated.includes(row.id) ? [] : row.controls,
  }
}

function tileView(tile: HeroSideTile, locale: HeroLocale): { label: string; value: string } {
  return { label: heroText(tile.label, locale), value: heroText(tile.value, locale) }
}

export function heroCardView(model: HeroModel, locale: HeroLocale): HeroCardView {
  const power = powerControl(model)
  const rows = model.rows.map((row) => rowView(row, model, locale)).filter((r) => r.status !== '' || r.controls.length > 0)
  return {
    title: statusLineText([model.title], locale),
    icon: model.look.icon,
    tone: model.look.tone,
    level: model.scene.level,
    muted: model.state === 'offline',
    facts: model.facts.map((f) => ({ text: heroText(f.text, locale), icon: f.icon, tone: f.tone })),
    tiles: [...model.sideTiles.left, ...model.sideTiles.right].map((t) => tileView(t, locale)),
    power,
    rows,
    remote: model.remote !== null && !model.gated.includes('remote'),
    hasControls: power !== null || rows.some((r) => r.controls.length > 0),
  }
}

/**
 * Does the hero card already draw the control a legacy primary pick would? Only
 * the two it models: a switch is covered by the power button, a media player by
 * the remote button. Every other pick (climate, lock, cover, brightness ...) is
 * a cap the hero does not cover yet, so its legacy control stays.
 */
export function heroCoversPrimary(kind: string, view: HeroCardView): boolean {
  if (kind === 'switch') return view.power !== null
  if (kind === 'media-player') return view.remote
  return false
}

/** The slots the detail still draws under the hero card: a primary entry the card covers is dropped, an emptied primary slot with it. */
export function slotsUnderHero<S extends { readonly slot: string; readonly entries: readonly { readonly pick?: { readonly kind: string } }[] }>(
  slots: readonly S[],
  view: HeroCardView | null,
): S[] {
  if (view === null) return [...slots]
  return slots
    .map((slot) =>
      slot.slot !== 'primary' ? slot : { ...slot, entries: slot.entries.filter((e) => e.pick === undefined || !heroCoversPrimary(e.pick.kind, view)) },
    )
    .filter((slot) => slot.slot !== 'primary' || slot.entries.length > 0)
}
