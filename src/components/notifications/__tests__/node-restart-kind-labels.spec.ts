import { describe, expect, it } from 'vitest'
import enLocale from '../../../../locales/en.json'
import itLocale from '../../../../locales/it.json'

/**
 * Hub D723: a node restarting and a node updating are two system-event kinds.
 * Their words ship ahead of the kind mirror (`NcSystemEventKindSchema`), which
 * follows the `@camstack/types` bump that publishes them — a mirror ahead of
 * the published types does not type-check against the functions it feeds.
 */
describe('node-restarting / node-updating have words in both languages', () => {
  it.each([
    ['en', enLocale, 'Node restarting', 'Node updating (restart imminent)'],
    ['it', itLocale, 'Nodo in riavvio', 'Nodo in aggiornamento (riavvio imminente)'],
  ] as const)('%s', (_lang, locale, restarting, updating) => {
    const words: Readonly<Record<string, string>> = locale.v2.nc.rules.editor.systemKinds
    expect(words['node-restarting']).toBe(restarting)
    expect(words['node-updating']).toBe(updating)
  })
})
