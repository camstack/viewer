import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

vi.mock('expo-alternate-app-icons', () => ({
  supportsAlternateIcons: true,
  getAppIconName: () => 'Mint',
  setAlternateAppIcon: async (name: string | null) => name,
}))

import { APP_ICON_IDS, getAppIcon, listAppIcons, setAppIcon } from '../app-icon.js'

const require = createRequire(import.meta.url)
const { ALTERNATE_ICONS } = require('../../../config-alternate-icons.js') as {
  ALTERNATE_ICONS: readonly { name: string; file: string }[]
}

describe('app icons', () => {
  it('mirrors the icon list the config plugin registers', () => {
    expect([...APP_ICON_IDS]).toEqual(ALTERNATE_ICONS.map((i) => i.name))
  })

  it('has a PNG on disk for every icon', () => {
    for (const icon of ALTERNATE_ICONS) {
      expect(existsSync(new URL(`../../../assets/alternate-icons/${icon.file}`, import.meta.url))).toBe(true)
    }
  })

  it('lists, reads and sets through the native module', async () => {
    expect(listAppIcons()).toEqual(APP_ICON_IDS)
    expect(getAppIcon()).toBe('Mint')
    expect(await setAppIcon('Owl')).toBe('Owl')
    expect(await setAppIcon(null)).toBeNull()
  })
})
