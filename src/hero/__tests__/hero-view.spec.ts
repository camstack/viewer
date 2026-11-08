import { describe, expect, it } from 'vitest'
import type { HeroAction, HeroControl, HeroRowModel } from '@camstack/types'
import { THEME } from '../../theme/tokens.js'
import { parseHeroRowModels } from '../hero-parse.js'
import {
  capRouterKey,
  controlView,
  heroLocale,
  nextOption,
  powerLook,
  powerPaint,
  rowView,
  statusLineText,
  stepTarget,
} from '../hero-view.js'

const action = (id: string, label: string): HeroAction => ({
  id,
  label: { en: label, it: label },
  icon: 'power',
  call: { cap: 'media-player', method: id, args: {} },
  emphasis: 'normal',
  confirm: null,
})

const toggle = (on: boolean | null): HeroControl => ({
  kind: 'toggle',
  id: 'own-power',
  label: { en: 'Power', it: 'Accensione' },
  on,
  turnOn: action('turnOn', 'Turn on'),
  turnOff: action('turnOff', 'Turn off'),
})

const rowModel = (primary: HeroControl | null, over: Partial<HeroRowModel> = {}): HeroRowModel => ({
  deviceId: 7,
  name: 'Living room TV',
  type: 'media-player',
  state: 'on',
  stateAssumed: true,
  look: { icon: 'tv', tone: 'success', background: 'plain', animation: 'none' },
  scene: { id: 'tv', mode: null, level: null },
  statusLine: [{ en: 'On', it: 'Acceso' }],
  primary,
  trailing: null,
  ...over,
})

describe('power: only ON is accented, on every device type', () => {
  for (const mode of ['dark', 'light'] as const) {
    const colors = THEME[mode]
    it(`${mode}: on is the accent, off and unknown are not`, () => {
      expect(powerPaint('on', colors).background).toBe(colors.primary)
      expect(powerPaint('off', colors).background).not.toBe(colors.primary)
      expect(powerPaint('unknown', colors).background).not.toBe(colors.primary)
      expect(powerPaint('off', colors).foreground).not.toBe(colors.primaryForeground)
    })
    it(`${mode}: unknown is not drawn as off`, () => {
      const off = powerPaint('off', colors)
      const unknown = powerPaint('unknown', colors)
      expect(unknown.dashed).toBe(true)
      expect(off.dashed).toBe(false)
    })
  }

  it('maps null to unknown, never to off', () => {
    expect(powerLook(true)).toBe('on')
    expect(powerLook(false)).toBe('off')
    expect(powerLook(null)).toBe('unknown')
  })
})

describe('controlView', () => {
  it('a toggle that is on presses turnOff; off or unknown presses turnOn', () => {
    const on = controlView(toggle(true))
    const off = controlView(toggle(false))
    const unknown = controlView(toggle(null))
    expect(on.kind === 'power' && on.press.id).toBe('turnOff')
    expect(off.kind === 'power' && off.press.id).toBe('turnOn')
    expect(unknown.kind === 'power' && unknown.press.id).toBe('turnOn')
  })

  it('a slider steps within its range and refuses an unknown level', () => {
    const slider = (value: number | null): Extract<HeroControl, { kind: 'slider' }> => ({
      kind: 'slider', id: 'volume', label: { en: 'Volume', it: 'Volume' }, value, min: 0, max: 100, step: 5, unit: '%',
      call: { cap: 'media-player', method: 'setVolume', args: {} }, valueArg: 'level',
    })
    expect(stepTarget(slider(50), 1)).toBe(55)
    expect(stepTarget(slider(100), 1)).toBeNull()
    expect(stepTarget(slider(0), -1)).toBeNull()
    expect(stepTarget(slider(null), 1)).toBeNull()
  })

  it('a picker selects the next option and wraps', () => {
    expect(nextOption(['a', 'b', 'c'], 'c')).toBe('a')
    expect(nextOption(['a', 'b'], null)).toBe('a')
    expect(nextOption([], null)).toBeNull()
  })
})

describe('rowView', () => {
  it('joins the status line with the locale and carries the control', () => {
    const view = rowView(rowModel(toggle(true), { statusLine: [{ en: 'On', it: 'Acceso' }, { en: '45 W', it: '45 W' }] }), 'it')
    expect(view.status).toBe('Acceso · 45 W')
    expect(view.control?.kind).toBe('power')
    expect(view.icon).toBe('tv')
  })

  it('the TV row has a power control, never only a text label', () => {
    const view = rowView(rowModel(toggle(true)), 'it')
    expect(view.control).not.toBeNull()
  })

  it('a row with no primary has no control and an offline row is muted', () => {
    const view = rowView(rowModel(null, { state: 'offline' }), 'en')
    expect(view.control).toBeNull()
    expect(view.muted).toBe(true)
  })

  it('drops empty status parts', () => {
    expect(statusLineText([{ en: '', it: '' }, { en: 'x', it: 'y' }], 'en')).toBe('x')
  })
})

describe('boundaries', () => {
  it('heroLocale falls back to en', () => {
    expect(heroLocale('it-IT')).toBe('it')
    expect(heroLocale('fr')).toBe('en')
    expect(heroLocale(undefined)).toBe('en')
  })
  it('capRouterKey camelCases a kebab cap', () => {
    expect(capRouterKey('media-player')).toBe('mediaPlayer')
    expect(capRouterKey('switch')).toBe('switch')
  })
  it('parseHeroRowModels keeps order and turns an unusable entry into null', () => {
    const good = rowModel(null)
    const parsed = parseHeroRowModels([good, null, { deviceId: 'x' }])
    expect(parsed).toHaveLength(3)
    expect(parsed[0]).toBe(good)
    expect(parsed[1]).toBeNull()
    expect(parsed[2]).toBeNull()
  })
})
