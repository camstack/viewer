/**
 * No control on the events surface carries its own words.
 *
 * The injected-labels design has one failure mode that no behavioural test
 * catches: a NEW pill added later with `title="stale"` written inline. It looks
 * right, it reads right in review, and it is a permanently English tooltip in
 * an Italian app — the exact drift the design was chosen to avoid. The only
 * thing that notices is a source guard, so this is one.
 *
 * It is deliberately narrow. It does not ask that a word never appears in the
 * file (styles, testids and comments legitimately contain words); it asks that
 * the two attributes that BECOME an accessible name — `title` and `aria-label`
 * — are never given a string literal in the card or the page.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { DEFAULT_EVENTS_LABELS } from '../../../../shared/events/events-labels'

const CARD = readFileSync(join(__dirname, '..', 'EventsCard.tsx'), 'utf8')
const PAGE = readFileSync(join(__dirname, '..', '..', 'pages', 'EmbedEventsPage.tsx'), 'utf8')

const SOURCES: readonly (readonly [string, string])[] = [
  ['EventsCard.tsx', CARD],
  ['EmbedEventsPage.tsx', PAGE],
]

describe('the events surface draws no word of its own', () => {
  for (const [name, source] of SOURCES) {
    it(`${name} — every \`title=\` is an expression, never a string literal`, () => {
      const literals = [...source.matchAll(/\btitle="([^"]*)"/g)].map((m) => m[1])
      expect(literals).toEqual([])
    })

    it(`${name} — every \`aria-label=\` is an expression, never a string literal`, () => {
      const literals = [...source.matchAll(/\baria-label="([^"]*)"/g)].map((m) => m[1])
      expect(literals).toEqual([])
    })

    it(`${name} — and the English lives only in the fallback module`, () => {
      // The defaults ARE the compatibility contract; a copy of one of them
      // inside a component means a control that stopped reading the injected
      // map. Checked against the quoted form so a comment mentioning the word
      // stays legal.
      for (const word of Object.values(DEFAULT_EVENTS_LABELS)) {
        expect(source.includes(`"${word}"`), `"${word}" is hardcoded in ${name}`).toBe(false)
        expect(source.includes(`'${word}'`), `'${word}' is hardcoded in ${name}`).toBe(false)
      }
    })
  }
})
