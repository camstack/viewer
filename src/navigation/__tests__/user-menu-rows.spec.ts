import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (rel: string): string => readFileSync(join(process.cwd(), rel), 'utf8')

describe('the app drawer has ONE row structure', () => {
  const drawer = read('src/apps/AppDrawer.tsx')
  const row = read('src/components/ui/MenuRow.tsx')

  it('apps, nodes, servers and the account entries all render through MenuRow, with no row layout of their own', () => {
    expect(drawer).toContain('<MenuRow')
    expect(drawer).not.toContain('styles.entry')
    expect(drawer).not.toContain('styles.serverRow')
  })

  it('a destructive row only changes colour', () => {
    expect(drawer).toMatch(/testID="drawer-sign-out"[\s\S]*destructive/)
    expect(row).toContain('destructive ? colors.danger')
  })

  it('the layout sits on an inner View, so a wrapper cannot re-style it', () => {
    const pressable = row.slice(row.indexOf('<Pressable'), row.indexOf('<View style={styles.row}'))
    expect(pressable).not.toContain('style=')
    expect(row).toContain("justifyContent: 'flex-start'")
    expect(row).toContain("textAlign: 'left'")
  })
})
