/**
 * The reel row height contract — hero-only cards with list padding.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  cardEdgePx,
  reelCardHeightPx,
  reelRowHeightPx,
  REEL_LIST_PADDING_V,
  type EventsThumbSize,
} from '../events-config'

const EMBED_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const SIZES: readonly EventsThumbSize[] = ['small', 'medium', 'large']

function read(relative: string): string {
  return readFileSync(path.join(EMBED_ROOT, relative), 'utf8')
}

describe('the reel row height contract', () => {
  it('leaves the card no slack at all — only the list padding', () => {
    for (const size of SIZES) {
      expect(reelCardHeightPx(size)).toBe(cardEdgePx(size))
      expect(reelRowHeightPx(size) - reelCardHeightPx(size)).toBe(REEL_LIST_PADDING_V * 2)
    }
  })

  it('mirrors the height the VIEWER reserves, exactly', () => {
    for (const size of SIZES) {
      expect(reelRowHeightPx(size)).toBe(cardEdgePx(size) + 8)
    }
  })
})

describe('the reel scroller refuses the scrollbar', () => {
  it('carries the class only in reel mode', () => {
    const page = read('pages/EmbedEventsPage.tsx')
    expect(page).toContain("className={isReel ? 'events-reel-scroller' : undefined}")
    expect(page).toContain("overflowY: isReel ? 'hidden' : 'auto'")
  })

  it('hides it in every engine, not just the one the author tested', () => {
    const css = read('index.css')
    expect(css).toContain('.events-reel-scroller')
    expect(css).toContain('scrollbar-width: none')
    expect(css).toContain('.events-reel-scroller::-webkit-scrollbar')
    expect(css).toContain('display: none')
  })
})
