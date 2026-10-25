/**
 * Every string the face review tab asks for, in BOTH locales — same guard
 * shape as `family-editors-i18n.spec.ts`. A missing key does not throw;
 * i18next renders the dotted key itself, invisible to a typecheck.
 */
import { describe, expect, it } from 'vitest'
import enLocale from '../../../../locales/en.json'
import itLocale from '../../../../locales/it.json'

function lookupLocale(tree: unknown, key: string): string | undefined {
  let node: unknown = tree
  for (const part of key.split('.')) {
    if (node === null || typeof node !== 'object' || !(part in node)) return undefined
    const record: Record<string, unknown> = { ...node }
    node = record[part]
  }
  return typeof node === 'string' ? node : undefined
}

const FACE_REVIEW_KEYS: readonly string[] = [
  'v2.faceReview.loading',
  'v2.faceReview.loadError',
  'v2.faceReview.empty',
  'v2.faceReview.previewClose',
  'v2.faceReview.pickIdentityTitle',
  'v2.faceReview.assignFailed',
  'v2.faceReview.assign',
  'v2.faceReview.assignedSuccess',
  'v2.faceReview.confirmAssignTitle',
  'v2.faceReview.confidence',
  'v2.faceReview.groupSize',
  'v2.faceReview.filterAssigned',
  'v2.faceReview.filterSuggested',
  'v2.faceReview.filterUnassigned',
  'v2.faceReview.certaintyCertain',
  'v2.faceReview.certaintyProbable',
  'v2.faceReview.certaintyUncertain',
  'v2.faceReview.analyzeButton',
  'v2.faceReview.analyzeModalTitle',
  'v2.faceReview.analyzeLoading',
  'v2.faceReview.analyzeEmpty',
  'v2.faceReview.analyzeConfirmBody',
  'v2.faceReview.analyzeResult',
  'v2.faceReview.recomputeButton',
  'v2.faceReview.recomputeDone',
  // Density, sorting and filtering
  'v2.faceReview.sortLabel',
  'v2.faceReview.sortByCertainty',
  'v2.faceReview.sortByDate',
  'v2.faceReview.sortAscending',
  'v2.faceReview.sortDescending',
  'v2.faceReview.dateLabel',
  // The Library date chip + its calendar, and the eye's cards
  'v2.library.allDates',
  'v2.calendar.today',
  'v2.calendar.yesterday',
  'v2.calendar.prevMonth',
  'v2.calendar.nextMonth',
  'v2.library.onEachTile',
  'v2.faceReview.cameraLabel',
  'v2.faceReview.cameraNone',
  'v2.faceReview.filtersButton',
  'v2.faceReview.filtersButtonActive',
  'v2.faceReview.emptyFiltered',
  'v2.faceReview.partialWindowHint',
  // Multi-selection + the unified detail modal
  'v2.faceReview.selectButton',
  'v2.faceReview.selectDone',
  'v2.faceReview.selectionCount',
  'v2.faceReview.detailTitleMany',
  'v2.faceReview.knownPeople',
  'v2.faceReview.assignedManySuccess',
  // Analyze: honest coverage + per-face exclusion
  'v2.faceReview.analyzeCoverage',
  'v2.faceReview.groupExcludeFace',
  'v2.faceReview.groupIncludeFace',
  // Analyze: the group's person is PICKED from the known people now — the
  // free-text field (and `analyzeNamePlaceholder`) is gone with it.
  'v2.faceReview.groupPickPerson',
  // Analyze: the long-press detail overlay that replaces what the carousel
  // used to give for free, plus the screen-reader action that reaches it.
  'v2.faceReview.groupShowDetail',
  'v2.faceReview.groupDetailExclude',
  'v2.faceReview.groupDetailInclude',
  // Selection: apply each face's OWN suggestion
  'v2.faceReview.applySuggestions',
  'v2.faceReview.applySuggestionsBlocked',
  'v2.faceReview.applySuggestionsResult',
]

const REUSED_KEYS: readonly string[] = [
  'v2.library.sections.review',
  'v2.settings.cancel',
  'v2.tracks.noPersons',
  'v2.tracks.newPersonPlaceholder',
  'v2.common.offline',
  // The shared `CarouselPager` narrates its arrows with the timeline cluster
  // card's strings — the same component, so the same words.
  'v2.theater.clusterPrevImage',
  'v2.theater.clusterNextImage',
]

describe.each([
  ['face review tab', FACE_REVIEW_KEYS],
  ['reused strings (not duplicated)', REUSED_KEYS],
])('%s', (_label, keys) => {
  it.each(keys)('%s is in both locales', (key) => {
    expect(lookupLocale(enLocale, key), `en is missing ${key}`).toBeTruthy()
    expect(lookupLocale(itLocale, key), `it is missing ${key}`).toBeTruthy()
  })
})

describe('the retired strings are gone from both locales', () => {
  // The Analyze modal can no longer TYPE a name (it picks a known person), so
  // the placeholder describes a field that does not exist. A leftover string
  // that describes the right design is worse than nothing — it reads as
  // verification that the field is still there.
  it.each(['v2.faceReview.analyzeNamePlaceholder'])('%s is in neither locale', (key) => {
    expect(lookupLocale(enLocale, key), `en still has ${key}`).toBeUndefined()
    expect(lookupLocale(itLocale, key), `it still has ${key}`).toBeUndefined()
  })
})

describe('the interpolations the screen and modal actually pass', () => {
  it('names the target in assignedSuccess', () => {
    expect(lookupLocale(enLocale, 'v2.faceReview.assignedSuccess')).toContain('{{name}}')
    expect(lookupLocale(itLocale, 'v2.faceReview.assignedSuccess')).toContain('{{name}}')
  })

  it('carries the face count in groupSize', () => {
    expect(lookupLocale(enLocale, 'v2.faceReview.groupSize')).toContain('{{count}}')
    expect(lookupLocale(itLocale, 'v2.faceReview.groupSize')).toContain('{{count}}')
  })

  it('carries both the face count and the group count in analyzeConfirmBody', () => {
    for (const locale of [enLocale, itLocale]) {
      const body = lookupLocale(locale, 'v2.faceReview.analyzeConfirmBody')
      expect(body).toContain('{{count}}')
      expect(body).toContain('{{groups}}')
    }
  })

  it('carries the assigned-of-count arithmetic in analyzeResult', () => {
    for (const locale of [enLocale, itLocale]) {
      const body = lookupLocale(locale, 'v2.faceReview.analyzeResult')
      expect(body).toContain('{{assigned}}')
      expect(body).toContain('{{count}}')
    }
  })

  it('carries the face count in recomputeDone', () => {
    expect(lookupLocale(enLocale, 'v2.faceReview.recomputeDone')).toContain('{{count}}')
    expect(lookupLocale(itLocale, 'v2.faceReview.recomputeDone')).toContain('{{count}}')
  })

  // ⚠ LOAD-BEARING, and the rule got STRICTER on 2026-09-13. The label first
  // hardcoded "100", then interpolated the pool size; both named a number that
  // is an implementation detail — and it moved (100 → 1 000) the moment the
  // window was aligned with the hub's own sweep. The operator's instruction was
  // to stop naming it: *"non menzionare 100 ma solo il concetto di gruppi
  // simili"*. So the button carries NO interpolation and NO digits.
  it('names similar groups and no number at all in analyzeButton', () => {
    for (const locale of [enLocale, itLocale]) {
      const body = lookupLocale(locale, 'v2.faceReview.analyzeButton')
      expect(body).not.toContain('{{')
      expect(body).not.toMatch(/[0-9]/)
    }
  })

  // The honest-scope line: how many faces were GROUPED, out of the pool
  // actually fetched, in how many groups. `requested` is gone with the second
  // window it described — the pool IS the window now.
  it('carries grouped/pool/groups in analyzeCoverage', () => {
    for (const locale of [enLocale, itLocale]) {
      const body = lookupLocale(locale, 'v2.faceReview.analyzeCoverage')
      expect(body).toContain('{{grouped}}')
      expect(body).toContain('{{pool}}')
      expect(body).toContain('{{groups}}')
      expect(body).not.toContain('{{requested}}')
    }
  })

  // The button says how many suggestions it would apply, and the disabled
  // state says how many of the selected faces are the reason it cannot. A
  // count-less blocked string is the mute dead end this action exists to
  // avoid.
  it('counts the suggestions applied, and the faces that block them', () => {
    for (const locale of [enLocale, itLocale]) {
      expect(lookupLocale(locale, 'v2.faceReview.applySuggestions')).toContain('{{count}}')
      expect(lookupLocale(locale, 'v2.faceReview.applySuggestionsBlocked')).toContain('{{count}}')
      const result = lookupLocale(locale, 'v2.faceReview.applySuggestionsResult')
      expect(result).toContain('{{count}}')
      expect(result).toContain('{{total}}')
      expect(result).toContain('{{groups}}')
    }
  })

  it('carries the count in the selection bar and the multi-assign confirmation', () => {
    for (const locale of [enLocale, itLocale]) {
      expect(lookupLocale(locale, 'v2.faceReview.selectionCount')).toContain('{{count}}')
      expect(lookupLocale(locale, 'v2.faceReview.detailTitleMany')).toContain('{{count}}')
      expect(lookupLocale(locale, 'v2.faceReview.assignedManySuccess')).toContain('{{count}}')
      expect(lookupLocale(locale, 'v2.faceReview.assignedManySuccess')).toContain('{{name}}')
      expect(lookupLocale(locale, 'v2.faceReview.filtersButtonActive')).toContain('{{count}}')
      expect(lookupLocale(locale, 'v2.faceReview.partialWindowHint')).toContain('{{count}}')
    }
  })
})
