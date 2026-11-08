import { describe, expect, it } from 'vitest'
import type { HeroAction, HeroModel } from '@camstack/types'
import { heroCardView, slotsUnderHero } from '../hero-card-view.js'

const action = (id: string): HeroAction => ({
  id, label: { en: id, it: id }, icon: 'power', call: { cap: 'media-player', method: id, args: {} }, emphasis: 'normal', confirm: null,
})

const tv = (over: Partial<HeroModel> = {}): HeroModel => ({
  deviceId: 7, type: 'media-player', role: null, name: 'Living room TV', state: 'on', stateAssumed: true,
  look: { icon: 'tv', tone: 'success', background: 'plain', animation: 'none' },
  background: { kind: 'state', token: 'plain', animation: 'none' },
  scene: { id: 'tv', mode: null, level: 0.4 },
  facts: [], sideTiles: { left: [], right: [] },
  title: { en: 'On', it: 'Acceso' },
  badges: [], remote: { commands: 12 }, consumables: null, consumption: null,
  ownPower: { source: 'media-player', on: true, assumed: true, turnOn: action('turnOn'), turnOff: action('turnOff') },
  timedRun: null, powerSupply: null, rows: [], gated: [], provenance: [],
  ...over,
})

describe('heroCardView: the TV detail opens the hero, the remote is a button on it', () => {
  it('draws the power and offers the remote', () => {
    const view = heroCardView(tv(), 'it')
    expect(view.title).toBe('Acceso')
    expect(view.power?.kind).toBe('toggle')
    expect(view.remote).toBe(true)
    expect(view.hasControls).toBe(true)
  })

  it('hides what the session may not act on', () => {
    const view = heroCardView(tv({ gated: ['own-power', 'remote'] }), 'en')
    expect(view.power).toBeNull()
    expect(view.remote).toBe(false)
    expect(view.hasControls).toBe(false)
  })

  it('a device without a remote offers no button', () => {
    expect(heroCardView(tv({ remote: null }), 'en').remote).toBe(false)
  })
})

describe('slotsUnderHero: a legacy primary control goes only when the card draws it', () => {
  const slot = (kinds: string[]) => ({ slot: 'primary', entries: kinds.map((kind) => ({ pick: { kind } })) })
  const header = { slot: 'header', entries: [] }

  it('an AC keeps its mode and temperature while the hero draws power', () => {
    const view = heroCardView(tv({ type: 'switch' }), 'en')
    const kept = slotsUnderHero([header, slot(['climate'])], view)
    expect(kept.map((s) => s.slot)).toEqual(['header', 'primary'])
  })

  it('a switch pick is dropped when the card has a power button, kept when it has none', () => {
    const withPower = heroCardView(tv(), 'en')
    expect(slotsUnderHero([slot(['switch'])], withPower)).toEqual([])
    const noPower = heroCardView(tv({ ownPower: null }), 'en')
    expect(slotsUnderHero([slot(['switch'])], noPower)).toHaveLength(1)
  })

  it('a TV with remote:null, or the remote gated, keeps its remote', () => {
    expect(slotsUnderHero([slot(['media-player'])], heroCardView(tv({ remote: null }), 'en'))).toHaveLength(1)
    expect(slotsUnderHero([slot(['media-player'])], heroCardView(tv({ gated: ['remote'] }), 'en'))).toHaveLength(1)
    expect(slotsUnderHero([slot(['media-player'])], heroCardView(tv(), 'en'))).toEqual([])
  })

  it('no hero model leaves every slot as it was', () => {
    expect(slotsUnderHero([slot(['switch', 'climate'])], null)).toHaveLength(1)
  })
})
