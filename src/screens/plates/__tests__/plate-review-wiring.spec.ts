/**
 * Source guards for the Plates page and the Scenes preparation: what no value
 * spec can see is whether the SCREEN reaches for the pieces (the queue, the
 * confirm, the shared header and panels) and whether the shell gates it.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import enLocale from '../../../../locales/en.json'
import itLocale from '../../../../locales/it.json'

const read = (rel: string): string => readFileSync(join(process.cwd(), rel), 'utf8')
const screen = read('src/screens/plates/PlateReviewScreen.tsx')
const library = read('src/screens/LibraryScreen.tsx')
const scenes = read('src/screens/scenes/ScenesScreen.tsx')

function lookup(tree: unknown, key: string): string | undefined {
  let node: unknown = tree
  for (const part of key.split('.')) {
    if (node === null || typeof node !== 'object' || !(part in node)) return undefined
    node = { ...node }[part as never]
  }
  return typeof node === 'string' ? node : undefined
}

describe('the Plates page mirrors People', () => {
  it('wears the one Library header row, the shared filter bar and selection bar', () => {
    expect(screen).not.toContain('<ScreenHeader')
    expect(screen).toContain('<LibraryFilterBar')
    expect(screen).toContain('more={overflowItems}')
    expect(screen).toContain("id: 'new-vehicle'")
    expect(screen).toContain('reviewFilterBar(')
    expect(screen).not.toContain('ReviewFilterPanel')
    expect(screen).toContain('<PlateReviewSelectionBar')
    expect(screen).toContain('<PlateReviewDetailModal')
    expect(screen).toContain('<PlateSimilarModal')
  })

  it('queues every long action, and keeps no banner', () => {
    for (const call of ['jobs.assign(', 'jobs.assignToNewVehicle(', 'jobs.deletePlates(', 'jobs.applySuggestions(']) {
      expect(screen).toContain(call)
    }
    expect(screen).not.toContain('resultBanner')
  })

  it('confirms before the irreversible delete', () => {
    const confirmAt = screen.indexOf("t('v2.plateReview.deleteConfirmTitle'")
    const writeAt = screen.indexOf('jobs.deletePlates(')
    expect(confirmAt).toBeGreaterThan(-1)
    expect(writeAt).toBeGreaterThan(confirmAt)
  })

  it('pages on the FEED, not the filtered rows', () => {
    expect(screen).toContain('onEndReached={hasMore ? loadMore : undefined}')
  })

  it('has every key it asks for in BOTH locales', () => {
    const keys = [...new Set([...screen.matchAll(/'(v2\.plateReview\.[A-Za-z.]+)'/g)].map((m) => m[1]!))]
    for (const key of keys) {
      const present = (tree: unknown): boolean =>
        lookup(tree, key) !== undefined || lookup(tree, `${key}_other`) !== undefined
      expect(present(enLocale), `en ${key}`).toBe(true)
      expect(present(itLocale), `it ${key}`).toBe(true)
    }
  })
})

describe('the shell gates the new sections', () => {
  it('mounts Plates and Scenes only through the section list the session is offered', () => {
    expect(library).toContain('<PlateReviewScreen />')
    expect(library).toContain('<ScenesScreen />')
    expect(library).toContain('librarySectionsFor(granted).includes(section)')
  })

  it('the Scenes page bakes in NO access rule', () => {
    expect(scenes).not.toContain('useIsAdmin')
    expect(scenes).not.toContain('isAdmin')
    expect(scenes).toContain('useScenesLibrary')
  })
})
