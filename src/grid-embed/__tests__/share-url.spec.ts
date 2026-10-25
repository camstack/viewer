/**
 * share-url spec — encode/decode round-trip + the SHARED test-vector table.
 *
 * VECTOR TABLE MIRROR: the `VECTORS` constant below is copied VERBATIM from the
 * Canonical vectors for the Viewer-owned embed URL contract.
 * `packages/addon-pipeline/embed/src/embed/__tests__/share-url.spec.ts` (which
 * tests the canonical module). Any change to a vector MUST land in both files
 * in the same change — the table is what keeps the two copies of the module
 * locked to one wire format.
 */
import { describe, it, expect } from 'vitest'
import {
  SHARE_URL_VERSION,
  GRID_EMBED_PATH,
  encodeGridShareQuery,
  buildGridShareUrl,
  decodeGridShareUrl,
  readShareToken,
  isShareUrl,
  encodeBase64UrlJson,
  decodeBase64UrlJson,
  type GridShareParams,
} from '../share-url.js'

// ── SHARED VECTOR TABLE (keep byte-identical with the viewer spec) ───────────

const VECTOR_HIGHLIGHT = {
  enabled: true,
  motion: true,
  audio: 'level' as const,
  audioDb: -30,
  audioHoldSec: 3,
  detection: true,
  detectionHoldSec: 5,
  detectionClasses: ['person', 'vehicle'],
  appearance: {
    motionColor: '#f59e0b',
    audioColor: '#3b82f6',
    detectionColor: '#ef4444',
    thickness: 3,
  },
}

const VECTOR_HL_B64 =
  'eyJlbmFibGVkIjp0cnVlLCJtb3Rpb24iOnRydWUsImF1ZGlvIjoibGV2ZWwiLCJhdWRpb0RiIjotMzAsImF1ZGlvSG9sZFNlYyI6MywiZGV0ZWN0aW9uIjp0cnVlLCJkZXRlY3Rpb25Ib2xkU2VjIjo1LCJkZXRlY3Rpb25DbGFzc2VzIjpbInBlcnNvbiIsInZlaGljbGUiXSwiYXBwZWFyYW5jZSI6eyJtb3Rpb25Db2xvciI6IiNmNTllMGIiLCJhdWRpb0NvbG9yIjoiIzNiODJmNiIsImRldGVjdGlvbkNvbG9yIjoiI2VmNDQ0NCIsInRoaWNrbmVzcyI6M319'

interface Vector {
  readonly name: string
  readonly params: GridShareParams
  readonly query: string
  readonly hash: string
  readonly token: string | null
}

const VECTORS: readonly Vector[] = [
  {
    name: 'minimal (defaults, single device)',
    params: { devices: [1], layout: 'auto', quality: 'auto', showName: false },
    query: 'mode=grid&v=1&devices=1&layout=auto&q=auto&names=0',
    hash: '#t=tok_tok_minimal',
    token: 'tok_tok_minimal',
  },
  {
    name: 'fixed columns + quality + names',
    params: { devices: [7, 8], layout: 2, quality: 'mid', showName: true },
    query: 'mode=grid&v=1&devices=7,8&layout=2&q=mid&names=1',
    hash: '#t=tok_abc123',
    token: 'tok_abc123',
  },
  {
    name: 'full (audio + activeOnly + highlight)',
    params: {
      devices: [1, 5, 9],
      layout: 3,
      quality: 'high',
      showName: true,
      audioOnIds: [1, 5],
      activeOnly: true,
      highlight: VECTOR_HIGHLIGHT,
    },
    query: `mode=grid&v=1&devices=1,5,9&layout=3&q=high&names=1&audio=1,5&activeOnly=1&hl=${VECTOR_HL_B64}`,
    hash: '#t=tok_full_0aB9',
    token: 'tok_full_0aB9',
  },
  {
    name: 'bounding boxes overlay',
    params: { devices: [2, 3], layout: 'auto', quality: 'auto', showName: false, boxes: true },
    query: 'mode=grid&v=1&devices=2,3&layout=auto&q=auto&names=0&boxes=1',
    hash: '#t=tok_tok_boxes',
    token: 'tok_tok_boxes',
  },
  {
    name: 'no token in the fragment',
    params: { devices: [4], layout: 'auto', quality: 'low', showName: false },
    query: 'mode=grid&v=1&devices=4&layout=auto&q=low&names=0',
    hash: '',
    token: null,
  },
]

// ── vector-driven encode/decode ───────────────────────────────────────────────

describe('share-url vectors (mirrored table)', () => {
  for (const vector of VECTORS) {
    it(`encodes: ${vector.name}`, () => {
      expect(encodeGridShareQuery(vector.params)).toBe(vector.query)
    })

    it(`decodes: ${vector.name}`, () => {
      const result = decodeGridShareUrl(`?${vector.query}`, vector.hash)
      expect(result).toEqual({ ok: true, params: vector.params, token: vector.token })
    })
  }

  it('round-trips every vector through encode → decode', () => {
    for (const vector of VECTORS) {
      const result = decodeGridShareUrl(`?${encodeGridShareQuery(vector.params)}`, vector.hash)
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.params).toEqual(vector.params)
    }
  })
})

// ── full URL builder ─────────────────────────────────────────────────────────

describe('buildGridShareUrl', () => {
  it('builds embed path + query + fragment token, trimming trailing slashes', () => {
    const url = buildGridShareUrl(
      'https://hub.example.com/',
      { devices: [7, 8], layout: 2, quality: 'mid', showName: true },
      'tok_abc123',
    )
    expect(url).toBe(
      `https://hub.example.com${GRID_EMBED_PATH}?mode=grid&v=${SHARE_URL_VERSION}&devices=7,8&layout=2&q=mid&names=1#t=tok_abc123`,
    )
  })

  it('keeps the token ONLY in the fragment (never the query string)', () => {
    const url = buildGridShareUrl(
      'https://hub.example.com',
      { devices: [1], layout: 'auto', quality: 'auto', showName: false },
      'tok_secret',
    )
    const [beforeFragment, fragment] = url.split('#')
    expect(beforeFragment).not.toContain('tok_secret')
    expect(fragment).toBe('t=tok_secret')
  })
})

// ── decode errors ────────────────────────────────────────────────────────────

describe('decodeGridShareUrl errors', () => {
  it('rejects a missing version', () => {
    const r = decodeGridShareUrl('?mode=grid&devices=1', '#t=tok_x')
    expect(r).toEqual({ ok: false, error: 'missing share-link version (v)' })
  })

  it('rejects an unsupported version', () => {
    const r = decodeGridShareUrl('?mode=grid&v=99&devices=1', '#t=tok_x')
    expect(r).toEqual({ ok: false, error: 'unsupported share-link version "99"' })
  })

  it('rejects a non-grid mode', () => {
    const r = decodeGridShareUrl('?mode=player&v=1&devices=1', '')
    expect(r).toEqual({ ok: false, error: 'unsupported mode "player"' })
  })

  it('rejects a missing / empty / malformed devices list', () => {
    expect(decodeGridShareUrl('?v=1', '').ok).toBe(false)
    expect(decodeGridShareUrl('?v=1&devices=', '').ok).toBe(false)
    expect(decodeGridShareUrl('?v=1&devices=1,x', '').ok).toBe(false)
  })

  it('rejects an invalid layout / names flag', () => {
    expect(decodeGridShareUrl('?v=1&devices=1&layout=zero', '').ok).toBe(false)
    expect(decodeGridShareUrl('?v=1&devices=1&layout=0', '').ok).toBe(false)
    expect(decodeGridShareUrl('?v=1&devices=1&names=yes', '').ok).toBe(false)
  })

  it('an unknown QUALITY is not an error — it normalises, and the link opens', () => {
    // Deliberately not in the list above (2026-09-02). Layout and the names
    // flag describe the wall's SHAPE and a wrong one has no sane fallback; the
    // tier is one preference among a dozen, and `q=medium` — a spelling this
    // build retired — is in links already sent. Failing the link over it would
    // take a working shared wall down with it.
    const r = decodeGridShareUrl('?v=1&devices=1&q=ultra', '#t=tok_x')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.params.quality).toBe('auto')
  })

  it('treats boxes=0 as absent and rejects a malformed boxes flag', () => {
    const r = decodeGridShareUrl('?v=1&devices=1&boxes=0', '#t=tok_x')
    expect(r).toEqual({
      ok: true,
      params: { devices: [1], layout: 'auto', quality: 'auto', showName: false },
      token: 'tok_x',
    })
    expect(decodeGridShareUrl('?v=1&devices=1&boxes=yes', '').ok).toBe(false)
  })

  it('rejects a malformed hl blob', () => {
    const r = decodeGridShareUrl('?v=1&devices=1&hl=!!!notbase64', '')
    expect(r).toEqual({ ok: false, error: 'invalid highlight config (hl)' })
  })

  it('rejects an hl blob whose JSON fails the highlight schema', () => {
    const bad = encodeBase64UrlJson({ enabled: 'yes' })
    const r = decodeGridShareUrl(`?v=1&devices=1&hl=${bad}`, '')
    expect(r).toEqual({ ok: false, error: 'invalid highlight config (hl)' })
  })

  it('applies defaults for absent optional params (layout/q/names)', () => {
    const r = decodeGridShareUrl('?v=1&devices=3,4', '#t=tok_x')
    expect(r).toEqual({
      ok: true,
      params: { devices: [3, 4], layout: 'auto', quality: 'auto', showName: false },
      token: 'tok_x',
    })
  })
})

// ── helpers ──────────────────────────────────────────────────────────────────

describe('readShareToken / isShareUrl', () => {
  it('reads the token from the fragment', () => {
    expect(readShareToken('#t=tok_abc')).toBe('tok_abc')
    expect(readShareToken('t=tok_abc')).toBe('tok_abc')
    expect(readShareToken('')).toBeNull()
    expect(readShareToken('#other=1')).toBeNull()
    expect(readShareToken('#t=')).toBeNull()
  })

  it('detects share URLs by v= or #t=', () => {
    expect(isShareUrl('?mode=grid&v=1&devices=1', '')).toBe(true)
    expect(isShareUrl('?mode=grid', '#t=tok_x')).toBe(true)
    expect(isShareUrl('?mode=grid&devices=1,2', '')).toBe(false)
    expect(isShareUrl('', '')).toBe(false)
  })
})

describe('base64url codec', () => {
  it('round-trips nested JSON including non-ASCII strings', () => {
    const value = { detectionClasses: ['persöna', '猫'], n: -30.5, deep: { a: [1, 2, 3] } }
    expect(decodeBase64UrlJson(encodeBase64UrlJson(value))).toEqual(value)
  })

  it('returns null on malformed input instead of throwing', () => {
    expect(decodeBase64UrlJson('!!!')).toBeNull()
    expect(decodeBase64UrlJson('a')).toBeNull()
    expect(decodeBase64UrlJson('AAAA')).toBeNull() // valid b64, invalid JSON
  })

  it('produces the pinned vector blob for the vector highlight', () => {
    expect(encodeBase64UrlJson(VECTOR_HIGHLIGHT)).toBe(VECTOR_HL_B64)
  })
})
