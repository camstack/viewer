/**
 * hero-view — what the hero model DRAWS in the viewer, as pure data.
 *
 * The model says what exists (a toggle, a slider, a status line); this module
 * decides the viewer's reading of it, so every row and every hero card draws
 * the same control the same way and a spec can pin it without rendering.
 *
 * ## One rule for every power button
 *
 * `on === true` is the ONLY accented state. Off is neutral, unknown is neutral
 * and dashed ("not known" is never drawn as off or as on, D315/D393). Before
 * this, each device type drew its own: a switch a pill, a media player a text
 * label ("Acceso"), a climate control a filled "Spento" pill that read as active.
 */
import type { HeroAction, HeroControl, HeroFact, HeroRowModel, HeroText, HeroTone } from '@camstack/types'
import type { ColorTokens } from '../theme/tokens.js'

export type HeroLocale = 'en' | 'it'

export function heroLocale(language: string | undefined): HeroLocale {
  return language !== undefined && language.toLowerCase().startsWith('it') ? 'it' : 'en'
}

export function heroText(text: HeroText, locale: HeroLocale): string {
  return text[locale]
}

/** The row's one status line: the parts joined by " · ", empty parts dropped. */
export function statusLineText(parts: readonly HeroText[], locale: HeroLocale): string {
  return parts
    .map((p) => heroText(p, locale).trim())
    .filter((s) => s.length > 0)
    .join(' · ')
}

/** The theme colour a model tone is drawn with. */
export function toneColor(tone: HeroTone, colors: ColorTokens): string {
  switch (tone) {
    case 'success':
      return colors.success
    case 'warning':
      return colors.warning
    case 'danger':
      return colors.danger
    case 'primary':
      return colors.primary
    case 'info':
      return colors.info
    case 'muted':
      return colors.foregroundSubtle
  }
}

// ── power ─────────────────────────────────────────────────────────────────────

export type PowerLook = 'on' | 'off' | 'unknown'

export function powerLook(on: boolean | null): PowerLook {
  return on === true ? 'on' : on === false ? 'off' : 'unknown'
}

export interface PowerPaint {
  readonly background: string
  readonly foreground: string
  readonly border: string
  readonly dashed: boolean
}

/** How a power button is painted. Only `on` takes the accent. */
export function powerPaint(look: PowerLook, colors: ColorTokens): PowerPaint {
  switch (look) {
    case 'on':
      return { background: colors.primary, foreground: colors.primaryForeground, border: colors.primary, dashed: false }
    case 'off':
      return { background: colors.backgroundElevated, foreground: colors.foregroundMuted, border: colors.border, dashed: false }
    case 'unknown':
      return { background: colors.backgroundElevated, foreground: colors.foregroundSubtle, border: colors.border, dashed: true }
  }
}

// ── controls ──────────────────────────────────────────────────────────────────

export type ControlView =
  | {
      readonly kind: 'power'
      readonly id: string
      readonly look: PowerLook
      readonly label: HeroText
      /** The action a tap sends: off while on, on otherwise (an unknown state asks for on). */
      readonly press: HeroAction
    }
  | { readonly kind: 'action'; readonly action: HeroAction }
  | {
      readonly kind: 'stepper'
      readonly id: string
      readonly label: HeroText
      readonly value: number | null
      readonly unit: string
      readonly down: number | null
      readonly up: number | null
      readonly call: { readonly cap: string; readonly method: string; readonly valueArg: string }
    }
  | {
      readonly kind: 'picker'
      readonly id: string
      readonly label: HeroText
      readonly current: string | null
      /** The option a tap selects: the one after the current, wrapping. */
      readonly next: string | null
      readonly call: { readonly cap: string; readonly method: string; readonly valueArg: string }
    }

  | {
      readonly kind: 'value'
      readonly id: string
      readonly label: HeroText
      readonly valueKind: 'number' | 'text'
      readonly value: number | string | null
      readonly unit: string
      readonly step: number | null
      readonly call: { readonly cap: string; readonly method: string; readonly valueArg: string }
    }

/** The value one step from `value`, clamped; `null` when it would not move or the level is unknown. */
export function stepTarget(
  control: Extract<HeroControl, { kind: 'slider' }>,
  direction: -1 | 1,
): number | null {
  if (control.value === null) return null
  const raw = control.value + direction * control.step
  const target = Math.min(control.max, Math.max(control.min, raw))
  return target === control.value ? null : target
}

export function nextOption(options: readonly string[], current: string | null): string | null {
  if (options.length === 0) return null
  const at = current === null ? -1 : options.indexOf(current)
  return options[(at + 1) % options.length] ?? null
}

export function controlView(control: HeroControl): ControlView | null {
  switch (control.kind) {
    case 'toggle':
      return {
        kind: 'power',
        id: control.id,
        look: powerLook(control.on),
        label: control.label,
        press: control.on === true ? control.turnOff : control.turnOn,
      }
    case 'action':
      return { kind: 'action', action: control.action }
    case 'slider':
      return {
        kind: 'stepper',
        id: control.id,
        label: control.label,
        value: control.value,
        unit: control.unit,
        down: stepTarget(control, -1),
        up: stepTarget(control, 1),
        call: { cap: control.call.cap, method: control.call.method, valueArg: control.valueArg },
      }
    case 'picker':
      return {
        kind: 'picker',
        id: control.id,
        label: control.label,
        current: control.current,
        next: nextOption(control.options, control.current),
        call: { cap: control.call.cap, method: control.call.method, valueArg: control.valueArg },
      }
    case 'number':
      return {
        kind: 'value',
        id: control.id,
        label: control.label,
        valueKind: 'number',
        value: control.value,
        unit: control.unit,
        step: control.step,
        call: { cap: control.call.cap, method: control.call.method, valueArg: control.valueArg },
      }
    case 'text':
      return {
        kind: 'value',
        id: control.id,
        label: control.label,
        valueKind: 'text',
        value: control.value,
        unit: '',
        step: null,
        call: { cap: control.call.cap, method: control.call.method, valueArg: control.valueArg },
      }
  }
}

// ── the row ───────────────────────────────────────────────────────────────────

export interface RowView {
  readonly deviceId: number
  readonly name: string
  readonly status: string
  readonly icon: string
  readonly tone: HeroTone
  readonly muted: boolean
  readonly control: ControlView | null
  readonly trailing: { readonly text: string; readonly icon: string | null; readonly tone: HeroTone } | null
}

function trailingView(fact: HeroFact | null, locale: HeroLocale): RowView['trailing'] {
  return fact === null ? null : { text: heroText(fact.text, locale), icon: fact.icon, tone: fact.tone }
}

/** A row model reduced to what the row draws. `offline` and `unknown` states are muted, never accented. */
export function rowView(model: HeroRowModel, locale: HeroLocale): RowView {
  return {
    deviceId: model.deviceId,
    name: model.name,
    status: statusLineText(model.statusLine, locale),
    icon: model.look.icon,
    tone: model.look.tone,
    muted: model.state === 'offline',
    control: model.primary === null ? null : controlView(model.primary),
    trailing: trailingView(model.trailing, locale),
  }
}

/** Cap names on the wire are kebab-case; the tRPC client's router keys are camelCase. */
export function capRouterKey(cap: string): string {
  return cap.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase())
}

/**
 * The row model to draw for a device: only a real model. A pending or failed
 * batch (`byId` undefined) and a hub with no row for the device both give
 * `null`, and the caller draws the legacy row (D315).
 */
export function rowModelFor(byId: ReadonlyMap<number, HeroRowModel> | undefined, deviceId: number): HeroRowModel | null {
  return byId?.get(deviceId) ?? null
}
