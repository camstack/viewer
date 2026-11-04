import { describe, expect, it } from 'vitest'
import {
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
    ).toEqual({ layoutTemplateId: 'tpl', roles: ['power', 'custom:netflix'] })
  })
  it('has no layout when none is linked, and is null when unreadable', () => {
    expect(parseRemoteCommandList({ layoutTemplateId: null, commands: [] })).toEqual({
      layoutTemplateId: null,
      roles: [],
    })
    expect(parseRemoteCommandList('nope')).toBeNull()
    expect(parseRemoteCommandList({ layoutTemplateId: null })).toBeNull()
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
