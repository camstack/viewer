/**
 * The row rule: server rows follow the hub, local additions are independent,
 * customisations apply to both, orphans are ignored on read, and the icon
 * precedence is local → display override → role default → built-in role →
 * type.
 */
import { describe, expect, it } from 'vitest'
import {
  composeAccessoryRows,
  resolveAccessoryIconKey,
  shownOrder,
  type AccessoryPanelDevice,
  type ComposeAccessoryRowsInput,
} from '../accessory-panel-rows.js'
import {
  EMPTY_ACCESSORY_PREFS,
  addAccessoriesEntry,
  setAccessoryHiddenEntry,
  setAccessoryIconEntry,
  setAccessoryNameEntry,
  setAccessoryOrderEntry,
  type CameraAccessoryPrefs,
} from '../accessory-prefs.js'

function device(id: number, name: string, over: Partial<AccessoryPanelDevice> = {}): AccessoryPanelDevice {
  return {
    id,
    name,
    type: 'light',
    online: true,
    features: ['switch'],
    location: null,
    role: null,
    displayIcon: null,
    ...over,
  }
}

const LIGHT = device(500, 'Garden light')
const SIREN = device(501, 'Siren', { type: 'siren' })
const SENSOR = device(502, 'Temperature', { type: 'sensor', features: ['temperature-sensor'] })
const LOCAL_PLUG = device(12, 'Fountain plug', { type: 'switch' })
const LOCAL_LAMP = device(13, 'Desk lamp', { type: 'light' })

function compose(
  over: Partial<ComposeAccessoryRowsInput> & { readonly prefs?: CameraAccessoryPrefs },
): ReturnType<typeof composeAccessoryRows> {
  return composeAccessoryRows({
    server: [LIGHT, SENSOR, SIREN],
    local: [],
    prefs: EMPTY_ACCESSORY_PREFS,
    roleIcons: {},
    actuates: (d) => d.type !== 'sensor',
    stripParent: (name) => name.replace(/^Garden /, ''),
    editing: false,
    ...over,
  })
}

describe('two sources, one list', () => {
  it('server rows come first as the hub sorted them, additions follow by name', () => {
    const rows = compose({ local: [LOCAL_PLUG, LOCAL_LAMP] })
    expect(rows.map((r) => [r.device.id, r.origin])).toEqual([
      [500, 'server'],
      [501, 'server'],
      [13, 'local'],
      [12, 'local'],
    ])
  })

  it('a device the hub links AND the operator added is ONE row, of server origin', () => {
    const rows = compose({ local: [device(500, 'Garden light')] })
    expect(rows.filter((r) => r.device.id === 500)).toHaveLength(1)
    expect(rows[0]?.origin).toBe('server')
  })

  it('a server device the hub stops linking disappears; a local addition does not depend on the hub', () => {
    const rows = compose({ server: [], local: [LOCAL_PLUG] })
    expect(rows.map((r) => r.device.id)).toEqual([12])
  })

  it('actuators only — a reading is not a row, in either mode, from either source', () => {
    const localSensor = device(14, 'Humidity', { type: 'sensor', features: ['humidity-sensor'] })
    for (const editing of [false, true]) {
      const ids = compose({ local: [localSensor], editing }).map((r) => r.device.id)
      expect(ids).not.toContain(502)
      expect(ids).not.toContain(14)
    }
  })
})

describe('customisations apply to both', () => {
  it('hidden rows are dropped in view mode and flagged in edit mode', () => {
    let prefs = setAccessoryHiddenEntry(EMPTY_ACCESSORY_PREFS, 501, true)
    prefs = setAccessoryHiddenEntry(prefs, 12, true)
    const view = compose({ local: [LOCAL_PLUG], prefs })
    expect(view.map((r) => r.device.id)).toEqual([500])
    const edit = compose({ local: [LOCAL_PLUG], prefs, editing: true })
    expect(edit.map((r) => [r.device.id, r.hidden])).toEqual([[500, false], [501, true], [12, true]])
  })

  it('a local name replaces the parent-stripped hub name; without one the strip rule stands', () => {
    const prefs = setAccessoryNameEntry(EMPTY_ACCESSORY_PREFS, 12, 'Fountain')
    const rows = compose({ local: [LOCAL_PLUG], prefs })
    expect(rows.find((r) => r.device.id === 500)?.label).toBe('light')
    expect(rows.find((r) => r.device.id === 12)?.label).toBe('Fountain')
  })

  it('the stored order leads, the rest follow in base order, and an orphan slot is ignored', () => {
    const prefs = setAccessoryOrderEntry(EMPTY_ACCESSORY_PREFS, [12, 999, 501])
    const rows = compose({ local: [LOCAL_PLUG, LOCAL_LAMP], prefs })
    expect(shownOrder(rows)).toEqual([12, 501, 500, 13])
  })

  it('a customisation for a device that is neither linked nor added is discarded on read', () => {
    let prefs = setAccessoryNameEntry(EMPTY_ACCESSORY_PREFS, 777, 'Ghost')
    prefs = setAccessoryHiddenEntry(prefs, 777, true)
    const rows = compose({ prefs, editing: true })
    expect(rows.map((r) => r.device.id)).toEqual([500, 501])
    // …and NOT written back: the document is the caller's, untouched.
    expect(prefs.byId[777]).toEqual({ name: 'Ghost', hidden: true })
  })

  it('an addition the hub cannot resolve draws nothing rather than a guessed row', () => {
    const prefs = addAccessoriesEntry(EMPTY_ACCESSORY_PREFS, [12])
    expect(compose({ prefs, local: [] }).map((r) => r.device.id)).toEqual([500, 501])
  })
})

describe('icon precedence', () => {
  const base = { localIcon: undefined, displayIcon: null, role: null, roleIcons: {}, type: 'light' }

  it('type icon when nothing else names one', () => {
    expect(resolveAccessoryIconKey(base)).toBe('lightbulb')
    expect(resolveAccessoryIconKey({ ...base, type: 'cover' })).toBe('blinds')
    expect(resolveAccessoryIconKey({ ...base, type: 'something-new' })).toBe('cpu')
  })

  it('built-in role glyph beats the type; the operator role default beats the built-in', () => {
    expect(resolveAccessoryIconKey({ ...base, role: 'spotlight' })).toBe('flashlight')
    expect(resolveAccessoryIconKey({ ...base, role: 'spotlight', roleIcons: { spotlight: 'lamp' } })).toBe('lamp')
  })

  it('the admin display override beats every role level; the local pick beats the override', () => {
    const withOverride = { ...base, role: 'spotlight', roleIcons: { spotlight: 'lamp' }, displayIcon: 'zap' }
    expect(resolveAccessoryIconKey(withOverride)).toBe('zap')
    expect(resolveAccessoryIconKey({ ...withOverride, localIcon: 'bell' })).toBe('bell')
  })

  it('a key this viewer cannot draw falls through to the next level, at every level', () => {
    expect(resolveAccessoryIconKey({ ...base, localIcon: 'unicorn', displayIcon: 'zap' })).toBe('zap')
    expect(resolveAccessoryIconKey({ ...base, displayIcon: 'unicorn', role: 'siren' })).toBe('siren')
    // The undrawable fixture must be a spelling the registry will NEVER carry.
    // This line said `alarm-smoke`, which the vocabulary has since grown — the
    // assertion then passed for the wrong reason until the key landed, and
    // then failed while production was right.
    expect(
      resolveAccessoryIconKey({ ...base, role: 'siren', roleIcons: { siren: 'unicorn' } }),
    ).toBe('siren')
    expect(resolveAccessoryIconKey({ ...base, role: 'unknown-role' })).toBe('lightbulb')
  })

  it('composed rows carry the resolved key', () => {
    const prefs = setAccessoryIconEntry(EMPTY_ACCESSORY_PREFS, 501, 'bell')
    const rows = compose({
      server: [device(500, 'Spot', { role: 'spotlight', displayIcon: 'lamp' }), SIREN],
      prefs,
    })
    expect(rows.map((r) => r.iconKey)).toEqual(['lamp', 'bell'])
  })
})
