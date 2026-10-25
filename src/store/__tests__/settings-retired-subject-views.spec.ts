/**
 * The subject views are retired (server D680): the hub no longer groups
 * nearby tracks into session summaries, so the three per-page switches that
 * chose between `tracks` and `summaries` (`clusters.subjectView`,
 * `events.reelSubjectView`, `events.gallerySubjectView`) are gone with it.
 *
 * What this file pins down is the migration of a document saved while they
 * existed: a device that stored `summaries` must open on the track views with
 * nothing to clear by hand, and the retired keys must not survive a round trip
 * (a key nothing reads, written back forever, is the leftover that looks like
 * a live setting).
 */
import { describe, it, expect } from 'vitest'
import { DEFAULTS, parseSettings } from '../settings-store.js'

const LEGACY = JSON.stringify({
  clusters: { gapPercent: 12, subjectView: 'summaries' },
  events: { gridDensity: 'compact', reelSubjectView: 'summaries', gallerySubjectView: 'summaries' },
})

describe('a document saved with the retired subject views', () => {
  it('still parses, keeping every setting that still exists', () => {
    const parsed = parseSettings(LEGACY)
    expect(parsed.clusters.gapPercent).toBe(12)
    expect(parsed.events.gridDensity).toBe('compact')
  })

  it('drops the retired keys instead of carrying them forward', () => {
    const parsed = parseSettings(LEGACY)
    expect(parsed.clusters).not.toHaveProperty('subjectView')
    expect(parsed.events).not.toHaveProperty('reelSubjectView')
    expect(parsed.events).not.toHaveProperty('gallerySubjectView')
    expect(JSON.stringify(parsed)).not.toContain('summaries')
  })

  it('the defaults no longer declare them either', () => {
    expect(DEFAULTS.clusters).not.toHaveProperty('subjectView')
    expect(DEFAULTS.events).not.toHaveProperty('reelSubjectView')
    expect(DEFAULTS.events).not.toHaveProperty('gallerySubjectView')
  })
})
