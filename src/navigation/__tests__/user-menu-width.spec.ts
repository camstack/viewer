import { describe, it, expect } from 'vitest'

import {
  USER_MENU_MAX_WIDTH,
  USER_MENU_MIN_WIDTH,
  textWidth,
  userMenuWidth,
  type UserMenuWidthInput,
} from '../user-menu-width.js'

const BASE: UserMenuWidthInput = {
  headerName: 'alice',
  headerServer: 'Home',
  entryLabels: ['Settings', 'Sign out'],
  serverLabels: [],
}

describe('the account menu width', () => {
  it('fits the content: far narrower than the old 320 px floor for short rows', () => {
    const width = userMenuWidth(BASE)
    expect(width).toBeLessThan(320)
    expect(width).toBeGreaterThanOrEqual(USER_MENU_MIN_WIDTH)
  })

  it('is never narrower than a touch-friendly minimum', () => {
    expect(userMenuWidth({ ...BASE, headerName: 'a', headerServer: '', entryLabels: ['Ok'] })).toBe(USER_MENU_MIN_WIDTH)
  })

  it('grows with the longest row', () => {
    const short = userMenuWidth(BASE)
    const longer = userMenuWidth({ ...BASE, entryLabels: ['Settings', 'Sign out of this server for good'] })
    expect(longer).toBeGreaterThan(short)
  })

  it('counts the server list: a long server name widens the menu', () => {
    const without = userMenuWidth(BASE)
    const withServers = userMenuWidth({ ...BASE, serverLabels: ['Home', 'Warehouse north gate'] })
    expect(withServers).toBeGreaterThan(without)
  })

  it('reserves room for the current-server check on every server row', () => {
    const plain = userMenuWidth({ ...BASE, serverLabels: ['A fairly long server label here'] })
    // 16 px glyph + 12 px gap beyond the bare text row.
    const bareRow = 32 + 16 + 12 + textWidth('A fairly long server label here', 14)
    expect(plain).toBeGreaterThanOrEqual(Math.min(USER_MENU_MAX_WIDTH, Math.ceil(bareRow + 28)))
  })

  it('is capped at a sensible maximum however long a name is', () => {
    const huge = 'x'.repeat(200)
    expect(userMenuWidth({ ...BASE, headerName: huge })).toBe(USER_MENU_MAX_WIDTH)
    expect(userMenuWidth({ ...BASE, serverLabels: [huge, huge] })).toBe(USER_MENU_MAX_WIDTH)
  })

  it('is handed to the menu as its exact width, not as a floor against the anchor', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const menu = readFileSync(join(process.cwd(), 'src/navigation/UserMenuButton.tsx'), 'utf8')
    expect(menu).toContain('width={menuWidth}')
    expect(menu).not.toContain('POPOVER_MIN_WIDTH')
    const anchored = readFileSync(join(process.cwd(), 'src/components/ui/AnchoredMenu.tsx'), 'utf8')
    expect(anchored).toContain('width !== undefined')
  })
})
