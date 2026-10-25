import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { estimateMenuHeight } from '../UserMenuButton.js'

const read = (rel: string): string => readFileSync(join(process.cwd(), rel), 'utf8')

describe('the account menu has ONE row structure', () => {
  const menu = read('src/navigation/UserMenuButton.tsx')
  const row = read('src/components/ui/MenuRow.tsx')

  it('every entry and every server renders through MenuRow, with no row layout of its own', () => {
    expect(menu.match(/<MenuRow/g)?.length).toBe(2)
    expect(menu).not.toContain('styles.entry')
    expect(menu).not.toContain('styles.serverRow')
  })

  it('a destructive row only changes colour', () => {
    expect(menu).toContain("destructive={entry === 'signOut'}")
    expect(row).toContain('destructive ? colors.danger')
  })

  it('the layout sits on an inner View, so a TabTrigger wrapper cannot re-style it', () => {
    const pressable = row.slice(row.indexOf('<Pressable'), row.indexOf('<View style={styles.row}'))
    expect(pressable).not.toContain('style=')
    expect(row).toContain("justifyContent: 'flex-start'")
    expect(row).toContain("textAlign: 'left'")
  })

  it('the placement estimate follows the tightened rows', () => {
    expect(estimateMenuHeight(2, 0)).toBe(58 + 2 * 38)
  })
})
