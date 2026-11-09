/**
 * A hero row keeps the shortcut cluster of the types whose legacy row drew one
 * (a cover's up / stop / down): the hub's row model carries ONE contextual
 * control, which replaced the three icon buttons.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { heroRowKeepsShortcuts } from '../control-registry.js'

const keeps = (type: string, features: readonly string[] = []): boolean =>
  heroRowKeepsShortcuts({ type, features })

describe('heroRowKeepsShortcuts, per device kind', () => {
  it.each([
    ['cover', []],
    ['valve', []],
    ['light', ['brightness']],
    ['fan', []],
    ['lock', []],
    ['alarm-panel', []],
    ['climate', []],
    ['media-player', []],
    ['vacuum', []],
    ['lawn-mower', []],
    ['pet-feeder', []],
    ['humidifier', []],
    ['water-heater', []],
  ])('%s keeps its legacy inline control on a hero row', (type, features) => {
    expect(keeps(type, features)).toBe(true)
  })

  it.each([
    ['switch', []],
    ['siren', []],
    ['light', []],
    ['button', []],
    ['camera', []],
  ])('%s keeps the hero primary control', (type, features) => {
    expect(keeps(type, features)).toBe(false)
  })
})

describe('the hero row draws the shortcuts instead of the model primary', () => {
  const root = join(process.cwd(), 'src')
  const body = readFileSync(join(root, 'hero', 'HeroRowBody.tsx'), 'utf8')
  const row = readFileSync(join(root, 'components', 'camera', 'accessory-panel', 'AccessoryRow.tsx'), 'utf8')

  it('HeroRowBody tests the shortcuts before model.primary', () => {
    expect(body.indexOf('shortcuts !== null')).toBeGreaterThan(-1)
    expect(body.indexOf('shortcuts !== null')).toBeLessThan(body.indexOf('model.primary !== null'))
  })

  it('AccessoryRow hands the registry control to the hero row for those kinds', () => {
    expect(row).toContain('shortcuts={heroRowKeepsShortcuts(row.device) ?')
  })
})
