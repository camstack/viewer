/**
 * The logs viewer is the kit's sheet (operator, 2026-10-21): SheetModal, the
 * sheet header, the empty state, and every level written in a theme token.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { THEME } from '../../../theme/tokens.js'
import { levelTone } from '../LogsModal.js'

describe('levelTone', () => {
  it.each(['light', 'dark'] as const)('writes each level in a %s theme token', (mode) => {
    const colors = THEME[mode]
    expect(levelTone('error', colors)).toBe(colors.danger)
    expect(levelTone('warn', colors)).toBe(colors.warning)
    expect(levelTone('info', colors)).toBe(colors.foregroundMuted)
    expect(levelTone('debug', colors)).toBe(colors.foregroundSubtle)
  })
})

describe('the logs viewer opens in the sheet frame', () => {
  const src = readFileSync(join(process.cwd(), 'src/screens/settings/LogsModal.tsx'), 'utf8')
  it('is a SheetModal, never a raw Modal', () => {
    expect(src).toContain('<SheetModal')
    expect(src).not.toMatch(/import \{[^}]*\bModal\b[^}]*\} from 'react-native'/)
  })
  it('draws the kit header and empty state', () => {
    expect(src).toContain('<SheetHeader')
    expect(src).toContain('<EmptyState')
  })
})
