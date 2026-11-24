import { describe, expect, it } from 'vitest'

import { parseAppInfos, type AppCatalog } from '../app-catalog.js'
import { launchChoices, launchValueLabel } from '../launch-choices.js'

const catalog: AppCatalog = {
  status: 'answered',
  apps: parseAppInfos([
    {
      addonId: 'a',
      app: {
        id: 'x',
        label: { key: 'apps.x', fallback: 'Ex' },
        icon: 'monitor',
        entry: { kind: 'web', path: '/', auth: 'handoff' },
        reach: { kind: 'hub' },
        adminOnly: false,
        nav: [],
        takesSharedSearch: false,
        settings: null,
      },
    },
  ]) ?? [],
}
const translate = (l: { fallback: string }): string => l.fallback

describe('the open-at-launch rows', () => {
  it('last used, then one row per offered app, by its label', () => {
    expect(launchChoices(catalog, translate)).toEqual([
      { preference: 'last', label: null },
      { preference: 'x', label: 'Ex' },
    ])
  })
  it('before the list answers there is only last used', () => {
    expect(launchChoices({ status: 'pending' }, translate)).toEqual([{ preference: 'last', label: null }])
  })
  it('a stored preference the list cannot name has no label (never a guessed one)', () => {
    expect(launchValueLabel('gone', catalog, translate)).toBeNull()
    expect(launchValueLabel('x', catalog, translate)).toBe('Ex')
  })
})
