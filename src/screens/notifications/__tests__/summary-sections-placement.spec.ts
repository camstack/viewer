/**
 * Where the digest editor puts its controls — the controller's ruling on the
 * Task 13 review (m5): `rank` and `maxTiles` sit under Mosaic, as in the
 * admin's `NC_SUMMARY_TABS`; `subject` stays under "What goes in" (the phone
 * may offer more than the admin).
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SOURCE = readFileSync(
  fileURLToPath(new URL('../rule-editor/SummaryFormSections.tsx', import.meta.url)),
  'utf8',
)

/** The body of one section component, from its declaration to the next one. */
function sectionBody(name: string): string {
  const start = SOURCE.indexOf(`function ${name}(`)
  expect(start, name).toBeGreaterThan(-1)
  const next = SOURCE.indexOf('\nfunction ', start + 1)
  return SOURCE.slice(start, next === -1 ? undefined : next)
}

describe('digest editor section placement', () => {
  it('Mosaic holds the tile budget and the ranking', () => {
    const mosaic = sectionBody('MosaicSection')
    expect(mosaic).toContain('maxTilesLabel')
    expect(mosaic).toContain('rankLabel')
  })

  it('"What goes in" holds neither of those two, and no longer offers a subject (D680)', () => {
    const content = sectionBody('ContentSection')
    expect(content).not.toContain('subjectLabel')
    expect(SOURCE).not.toContain('NcSummarySubject')
    expect(content).not.toContain('maxTilesLabel')
    expect(content).not.toContain('rankLabel')
  })
})
