/**
 * The reel filter, from the fan menu to the request — and the three stores
 * that must share a shape without sharing a value.
 *
 * The strip on the Cameras screen had no filter and no affordance. Giving it a
 * narrowing default without a control would have been the failure we spent the
 * day removing from three other surfaces: a list quietly shorter than reality,
 * with nothing on screen to ask.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(__dirname, '..', '..', '..', '..')
const read = (rel: string): string => readFileSync(join(SRC, rel), 'utf8')

const reelEmbed = read('components/events/track/TrackReel.tsx')
const reelBlock = read('components/events/track/RecentReelBlock.tsx')
const sheet = read('components/events/track/ReelFilterSheet.tsx')
const camerasFab = read('components/cameras/CamerasFab.tsx')
const eventsStore = read('store/events-filter-store.ts')
const reelStore = read('store/reel-filter-store.ts')

describe('the filter reaches the request', () => {
  it('rides listRecentTracks as excludeSources, not a client-side drop', () => {
    // A reel is one row: dropping rows after the read empties the strip while
    // a day of markers sits in memory. The exclusion narrows the READ.
    expect(reelEmbed).toContain('    excludeSources,')
    expect(reelEmbed).toContain('resolveReelExcludeSources(reelFilter, eventKinds.data)')
  })

  it('sends the class selection too, resolved against the live taxonomy', () => {
    expect(reelEmbed).toContain('    classes,')
    expect(reelEmbed).toContain('resolveReelClasses(reelFilter, eventKinds.data)')
  })

  it('hydrates its own store, so the default is not lost on a cold Cameras tab', () => {
    // The Cameras screen is often the first thing mounted; the events page,
    // which hydrates its own filter, may never have been opened.
    expect(reelEmbed).toContain('void hydrateFilter()')
  })
})

describe('the condition is visible without opening anything', () => {
  it('is drawn on the fan action that changes it', () => {
    // One word for the active set — not "Recent events · Detections" (the
    // strip title is a leftover; the menu names what is ON).
    expect(camerasFab).toContain('label: reelSuffix')
    expect(camerasFab).toContain("t('v2.cameras.reelFilterDefaultTag'")
    expect(camerasFab).not.toContain('reelFilter ·')
  })

  it('is a dot on the COLLAPSED button, which is all the operator normally sees', () => {
    // A speed-dial is shut almost all of the time, so the label alone would
    // explain a short strip only to someone already looking for the reason.
    expect(camerasFab).toContain('REEL_FILTER_DOT_TEST_ID')
    expect(camerasFab).toContain('!open && reelNarrowed')
  })

  it('counts the DEFAULT as narrowed on both of those', () => {
    expect(camerasFab).toContain("const reelNarrowed = reelCondition.kind !== 'all'")
  })

  it('is also in the strip caption, directly above the rows it describes', () => {
    expect(reelBlock).toContain('reelFilterCondition')
    expect(reelBlock).toContain("t('v2.cameras.reelFilterDefaultTag'")
  })

  it('costs the fixed block no height — only the caption TEXT changes', () => {
    // The block is `reelBlockHeight(cardWidth)` tall whatever the reel says; a
    // fixed header whose height moves is the defect it was introduced to fix.
    expect(reelBlock).toContain('height: reelBlockHeight(cardWidth)')
    expect(reelBlock).not.toContain('REEL_CAPTION_LINE_HEIGHT * 2')
  })

  it('spells the condition out inside the sheet as well', () => {
    expect(sheet).toContain('reel-filter-condition')
    expect(sheet).toContain("'v2.cameras.reelFilterDefaultHint'")
  })
})

describe('the picker is the taxonomy, not a list written here', () => {
  it('uses the shared EventKindTreeSection', () => {
    expect(sheet).toContain('EventKindTreeSection')
    expect(sheet).toContain('descriptors={eventKinds.data}')
  })

  it('offers no hand-written observed vocabulary', () => {
    // The events page and the timeline hand the tree the classes of the rows
    // they have loaded; this surface loads no rows of its own and hands it
    // none. Inventing a list here is how a second source of truth is born.
    expect(sheet).toContain('observedClasses={NO_OBSERVED_CLASSES}')
    expect(sheet).toContain('const NO_OBSERVED_CLASSES: readonly string[] = []')
  })
})

describe('three stores, one shape, three values', () => {
  it('the reel and the events page BOTH build on track-filter.ts', () => {
    expect(reelStore).toContain("from './track-filter.js'")
    expect(eventsStore).toContain("from './track-filter.js'")
  })

  it('and keep separate storage keys, so neither can move the other', () => {
    expect(reelStore).toContain("'camstack.v2.reel-filter'")
    expect(eventsStore).toContain("'camstack.v2.events-filter'")
  })

  it('the reel never reads the events page filter', () => {
    // The scopes are genuinely different: a 24 h strip above the camera grid
    // is a glance, the events page is an investigation.
    for (const file of [reelEmbed, reelBlock, sheet, reelStore]) {
      expect(file).not.toContain('useEventsFilterStore')
    }
  })

  it('the toggle reducer and the source derivation have ONE definition', () => {
    // Both stores import them; neither re-implements them.
    expect(eventsStore).toContain('toggleMember(')
    expect(reelStore).toContain('toggleMember(')
    expect(eventsStore).not.toContain('function toggleStr')
    expect(reelStore).not.toContain('function toggleMember')
  })
})
