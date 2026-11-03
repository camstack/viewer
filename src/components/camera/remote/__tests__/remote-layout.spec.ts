import { describe, expect, it } from 'vitest'
import {
  humanRole,
  keyName,
  parseRemoteCommandList,
  parseRemoteLayout,
  remoteLayoutFromTemplates,
  rowSpanBox,
  slimRows,
  totalRows,
} from '../remote-layout.js'

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
  it('a role reads as words, a custom role as its key', () => {
    expect(humanRole('volume_up')).toBe('Volume up')
    expect(humanRole('custom:pre_ch')).toBe('pre ch')
  })
  it('a label wins over the role', () => {
    const parsed = parseRemoteLayout(layout)
    expect(parsed === null ? '' : keyName(parsed.buttons[1]!)).toBe('Louder')
    expect(parsed === null ? '' : keyName(parsed.buttons[0]!)).toBe('Power')
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
