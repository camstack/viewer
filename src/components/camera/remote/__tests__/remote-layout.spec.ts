import { describe, expect, it } from 'vitest'
import {
  isSourceSelect,
  parseRemoteSources,
  sourceKeyVisible,
  sourceSections,
  type RemoteLayoutButton,
  colourKeyOf,
  keyIcon,
  keyLegend,
  keyName,
  parseRemoteCommandList,
  parseRemoteLayout,
  remoteLayoutFromTemplates,
  rowSpanBox,
  slimRows,
  totalRows,
  vocabLocale,
} from '../remote-layout.js'
import { REMOTE_CUSTOM_ROLE_ICON, REMOTE_ROLE_VOCABULARY } from '@camstack/types/client'
import { ICON_NODES } from '../../../../lib/icon-nodes.generated.js'
import { iconNodeFor } from '../../../../lib/icon-node-for.js'

const button = (id: string, role: string, row: number, col: number) => ({
  id, role, row, col, rowSpan: 1, colSpan: 1,
})

const layout = {
  columns: 3,
  rows: 3,
  buttons: [button('p', 'power', 0, 0), { ...button('v', 'volume_up', 2, 1), label: 'Louder', tone: 'accent' }],
  groups: [{ id: 'd', componentId: 'sep', frame: 'divider', row: 1, col: 0, rowSpan: 1, colSpan: 3 }],
}

describe('parseRemoteLayout', () => {
  it('reads the grid, its buttons and its groups', () => {
    const parsed = parseRemoteLayout(layout)
    expect(parsed?.columns).toBe(3)
    expect(parsed?.buttons.map((b) => b.id)).toEqual(['p', 'v'])
    expect(parsed?.buttons[1]).toMatchObject({ label: 'Louder', tone: 'accent' })
    expect(parsed?.groups).toHaveLength(1)
  })
  it('is null for anything that is not a remote layout, never an empty remote', () => {
    expect(parseRemoteLayout(null)).toBeNull()
    expect(parseRemoteLayout({ columns: 3, rows: 2 })).toBeNull()
    expect(parseRemoteLayout({ columns: 0, rows: 2, buttons: [] })).toBeNull()
    expect(parseRemoteLayout({ columns: 3, rows: 2, buttons: [{ id: 'x' }] })).toBeNull()
  })
})

describe('parseRemoteCommandList', () => {
  it('keeps the layout id and the bound roles', () => {
    expect(
      parseRemoteCommandList({
        layoutTemplateId: 'tpl',
        power: { mode: 'toggle' },
        commands: [{ role: 'power', custom: false }, { role: 'custom:netflix', custom: true }],
      }),
    ).toEqual({ layoutTemplateId: 'tpl', roles: ['power', 'custom:netflix'], names: new Map(), sources: [] })
  })
  it('has no layout when none is linked, and is null when unreadable', () => {
    expect(parseRemoteCommandList({ layoutTemplateId: null, commands: [] })).toEqual({
      layoutTemplateId: null,
      roles: [],
      names: new Map(),
      sources: [],
    })
    expect(parseRemoteCommandList('nope')).toBeNull()
    expect(parseRemoteCommandList({ layoutTemplateId: null })).toBeNull()
  })
})

describe('parseRemoteCommandList names', () => {
  it('keeps the name of a command by role', () => {
    const list = parseRemoteCommandList({
      layoutTemplateId: null,
      commands: [{ role: 'custom:x', name: 'Red' }, { role: 'custom:y', label: 'Blue' }, { role: 'power' }],
    })
    expect(list?.names).toEqual(new Map([['custom:x', 'Red'], ['custom:y', 'Blue']]))
  })
})

describe('colourKeyOf', () => {
  const key = (role: string, label?: string) => ({ ...button('k', role, 0, 0), ...(label === undefined ? {} : { label }) })
  it('maps the colour key ids A-D to red, green, yellow, blue', () => {
    expect(['color_a', 'color_b', 'color_c', 'color_d'].map((id) => colourKeyOf(key(`custom:${id}`)))).toEqual(['red', 'green', 'yellow', 'blue'])
    expect(colourKeyOf(key('custom:Colour-B'))).toBe('green')
  })
  it('maps the names A-D and Red/Green/Yellow/Blue, any case, from the label or the command name', () => {
    expect(colourKeyOf(key('custom:k1', 'a'))).toBe('red')
    expect(colourKeyOf(key('custom:k2', ' D '))).toBe('blue')
    expect(colourKeyOf(key('custom:k3', 'GREEN'))).toBe('green')
    expect(colourKeyOf(key('custom:k4'), 'Yellow')).toBe('yellow')
  })
  it('leaves every other key alone, a built-in role included', () => {
    expect(colourKeyOf(key('custom:netflix', 'Netflix'))).toBeNull()
    expect(colourKeyOf(key('custom:color_e'))).toBeNull()
    expect(colourKeyOf(key('power', 'Red'))).toBeNull()
    expect(colourKeyOf(key('custom:k', 'AB'))).toBeNull()
  })
})

describe('remoteLayoutFromTemplates', () => {
  it('finds the linked template by id', () => {
    const list = [{ id: 'a', payload: {} }, { id: 'tpl', payload: layout }]
    expect(remoteLayoutFromTemplates(list, 'tpl')?.rows).toBe(3)
    expect(remoteLayoutFromTemplates(list, 'missing')).toBeNull()
    expect(remoteLayoutFromTemplates(null, 'tpl')).toBeNull()
  })
})

describe('names', () => {
  it('a role is named from the shared vocabulary in the app locale', () => {
    const power = button('p', 'power', 0, 0)
    expect(keyName(power, 'en')).toBe('Power')
    expect(keyName(power, 'it')).toBe('Accensione')
    expect(keyName(button('v', 'volume_down', 0, 0), 'it')).toBe('Volume giù')
  })
  it('the app language maps to a vocabulary locale', () => {
    expect(vocabLocale('it-IT')).toBe('it')
    expect(vocabLocale('en')).toBe('en')
    expect(vocabLocale('fr')).toBe('en')
    expect(vocabLocale(undefined)).toBe('en')
  })
  it('a custom role is named by its key and wears the circle', () => {
    const custom = button('c', 'custom:pre_ch', 0, 0)
    expect(keyName(custom, 'it')).toBe('pre ch')
    expect(keyIcon(custom)).toBe(REMOTE_CUSTOM_ROLE_ICON)
  })
  it('a label wins over the role, an icon of the layout wins over the vocabulary', () => {
    const parsed = parseRemoteLayout(layout)
    expect(parsed === null ? '' : keyName(parsed.buttons[1]!, 'it')).toBe('Louder')
    expect(keyIcon({ ...button('x', 'power', 0, 0), icon: 'star' })).toBe('star')
  })
  it('a digit prints its legend instead of a glyph', () => {
    expect(keyLegend(button('d', 'digit_7', 0, 0))).toBe('7')
    expect(keyLegend(button('p', 'power', 0, 0))).toBeUndefined()
  })
})

describe('vocabulary icons', () => {
  it.each(Object.keys(REMOTE_ROLE_VOCABULARY))('role %s resolves to an icon the viewer draws', (role) => {
    expect(iconNodeFor(keyIcon(button('k', role, 0, 0)), ICON_NODES)).toBeDefined()
  })
  it('the custom-role icon is drawn too', () => {
    expect(iconNodeFor(REMOTE_CUSTOM_ROLE_ICON, ICON_NODES)).toBeDefined()
  })
})

describe('row geometry', () => {
  it('a row that holds only a divider is thin', () => {
    const parsed = parseRemoteLayout(layout)!
    expect([...slimRows(parsed)]).toEqual([1])
    expect(totalRows(parsed, 0.4)).toBeCloseTo(2.4)
    expect(rowSpanBox(parsed, 2, 1, 0.4)).toEqual({ top: 1.4, height: 1 })
  })
})

const SRC_KEY: RemoteLayoutButton = { id: 's', role: 'source_select', row: 0, col: 0, rowSpan: 1, colSpan: 2 }

describe('remote sources', () => {
  const raw = [
    { kind: 'digits', id: 'rai-2', name: 'Rai 2', number: '2' },
    { kind: 'digits', id: 'rai-1', name: 'Rai 1', number: '1' },
    { kind: 'sequence', id: 'hdmi', name: 'HDMI 1', steps: ['source', 'down', 'ok'] },
  ]

  it('parses both kinds and drops what is malformed', () => {
    expect(parseRemoteSources([...raw, { kind: 'digits', id: 'x', name: 'X' }, { kind: 'sequence', id: 'y', name: 'Y', steps: [] }, 7])).toHaveLength(3)
  })

  it('an absent or non-array sources field is none, not an error', () => {
    expect(parseRemoteSources(undefined)).toEqual([])
    expect(parseRemoteCommandList({ commands: [], layoutTemplateId: null })?.sources).toEqual([])
    expect(parseRemoteCommandList({ commands: [], sources: raw })?.sources).toHaveLength(3)
  })

  it('splits into Channels (by number) and Inputs', () => {
    const { channels, inputs } = sourceSections(parseRemoteSources(raw))
    expect(channels.map((c) => c.number)).toEqual(['1', '2'])
    expect(inputs.map((i) => i.name)).toEqual(['HDMI 1'])
  })

  it('the key shows only with declared sources; unanswered and none both draw nothing', () => {
    expect(sourceKeyVisible(undefined)).toBe(false)
    expect(sourceKeyVisible(null)).toBe(false)
    expect(sourceKeyVisible({ sources: [] })).toBe(false)
    expect(sourceKeyVisible({ sources: parseRemoteSources(raw) })).toBe(true)
  })

  it('names the role locally, in both languages, and honours a layout label', () => {
    expect(isSourceSelect(SRC_KEY)).toBe(true)
    expect(keyName(SRC_KEY, 'en')).toBe('Sources')
    expect(keyName(SRC_KEY, 'it')).toBe('Sorgenti')
    expect(keyName({ ...SRC_KEY, label: 'Input' }, 'en')).toBe('Input')
  })
})
