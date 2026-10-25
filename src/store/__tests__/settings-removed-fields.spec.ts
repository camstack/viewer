/**
 * Guards for two settings fields RETIRED on 2026-08-18.
 *
 *  1. `events.useEmbedRenderer` — the viewer used to carry two events
 *     renderers and a switch between them. The hub-hosted embed is now THE
 *     renderer and the onboard one is deleted, so the flag has nothing left to
 *     select. A persisted value of either polarity must be dropped: a `false`
 *     resurrecting a path whose components no longer exist is a mount crash,
 *     not a preference.
 *  2. `clusters.minImportance` — the global "hide events below N% importance"
 *     filter, removed with the Settings → Events section that set it. The
 *     surfaces that read it (events page, theater timeline) no longer filter.
 *
 * NOTE the namesake that must SURVIVE: `minImportance` is also a notification
 * RULE condition (`components/notifications/rule-editor.ts`,
 * `data/notification-center.ts`). Different feature, asserted here so a future
 * sweep of the name cannot quietly take it too.
 */
import { describe, it, expect } from 'vitest'
import { DEFAULTS, parseSettings } from '../settings-store.js'

describe('retired settings fields are not resurrected by a persisted blob', () => {
  it('the defaults document carries neither field', () => {
    expect(Object.prototype.hasOwnProperty.call(DEFAULTS.events, 'useEmbedRenderer')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(DEFAULTS.clusters, 'minImportance')).toBe(false)
  })

  it('drops a persisted useEmbedRenderer, whichever way it was set', () => {
    for (const stored of [true, false]) {
      const parsed = parseSettings(JSON.stringify({ events: { useEmbedRenderer: stored } }))
      expect(Object.prototype.hasOwnProperty.call(parsed.events, 'useEmbedRenderer')).toBe(false)
    }
  })

  it('drops a persisted clusters.minImportance', () => {
    const parsed = parseSettings(JSON.stringify({ clusters: { minImportance: 0.5 } }))
    expect(Object.prototype.hasOwnProperty.call(parsed.clusters, 'minImportance')).toBe(false)
  })

  it('keeps every other events/cluster preference the same blob carried', () => {
    // The removal must not take its neighbours with it.
    const parsed = parseSettings(
      JSON.stringify({
        events: { useEmbedRenderer: true, gridDensity: 'large', tileShowLabels: false, tileLabelMode: 'off' },
        clusters: { minImportance: 0.5, showClass: false, gapPercent: 22 },
      }),
    )
    expect(parsed.events.gridDensity).toBe('large')
    expect(parsed.events.tileLabelMode).toBe('off')
    expect(parsed.clusters.showClass).toBe(false)
    expect(parsed.clusters.gapPercent).toBe(22)
  })
})

describe('the notification-rule minImportance is a different feature and survives', () => {
  it('the rule condition schema still declares it', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const nc = readFileSync(join(process.cwd(), 'src/data/notification-center.ts'), 'utf8')
    expect(nc).toContain('minImportance: z.number().min(0).max(1).optional()')
  })
})
