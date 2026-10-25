import { describe, it, expect } from 'vitest'
import { parseGridUrlConfig } from '../embed-url-config'
import { encodeBase64UrlJson } from '../share-url'

const ORIGIN = 'https://hub.example.com'

describe('parseGridUrlConfig', () => {
  it('returns null for a non-share URL (no v=, no #t=) — classic error path stays', () => {
    expect(parseGridUrlConfig('', '', ORIGIN)).toBeNull()
    expect(parseGridUrlConfig('?mode=grid', '', ORIGIN)).toBeNull()
    expect(parseGridUrlConfig('?mode=grid&devices=1,2', '', ORIGIN)).toBeNull()
  })

  it('builds a full GridConfig from a share URL (defaults injected)', () => {
    const result = parseGridUrlConfig(
      '?mode=grid&v=1&devices=1,5,9&layout=3&q=high&names=1',
      '#t=tok_tok',
      ORIGIN,
    )
    expect(result).toEqual({
      ok: true,
      config: {
        serverUrl: ORIGIN,
        token: 'tok_tok',
        devices: [1, 5, 9],
        layout: 3,
        quality: 'high',
        showName: true,
        showBadges: true,
        muted: true,
        paused: false,
      },
    })
  })

  it('applies schema defaults when only devices are given', () => {
    const result = parseGridUrlConfig('?v=1&devices=2', '#t=tok_tok', ORIGIN)
    expect(result).toEqual({
      ok: true,
      config: {
        serverUrl: ORIGIN,
        token: 'tok_tok',
        devices: [2],
        layout: 'auto',
        quality: 'auto',
        showName: false,
        showBadges: true,
        muted: true,
        paused: false,
      },
    })
  })

  it('carries highlight / activeOnly / audio through to the config', () => {
    const hl = {
      enabled: true,
      motion: true,
      audio: 'off' as const,
      audioDb: -30,
      audioHoldSec: 3,
      detection: false,
      detectionHoldSec: 3,
    }
    const result = parseGridUrlConfig(
      `?v=1&devices=1,2&audio=2&activeOnly=1&hl=${encodeBase64UrlJson(hl)}`,
      '#t=tok_tok',
      ORIGIN,
    )
    expect(result).not.toBeNull()
    expect(result?.ok).toBe(true)
    if (result?.ok) {
      expect(result.config.highlight).toEqual(hl)
      expect(result.config.activeOnly).toBe(true)
      expect(result.config.audioOnIds).toEqual([2])
    }
  })

  it('maps boxes=1 to showBoxes in the config (absent otherwise)', () => {
    const withBoxes = parseGridUrlConfig('?v=1&devices=1,2&boxes=1', '#t=tok_tok', ORIGIN)
    expect(withBoxes?.ok).toBe(true)
    if (withBoxes?.ok) expect(withBoxes.config.showBoxes).toBe(true)

    const without = parseGridUrlConfig('?v=1&devices=1,2', '#t=tok_tok', ORIGIN)
    expect(without?.ok).toBe(true)
    if (without?.ok) expect(without.config.showBoxes).toBeUndefined()
  })

  it('reports a DISTINCT error for a share URL with no token', () => {
    const result = parseGridUrlConfig('?v=1&devices=1', '', ORIGIN)
    expect(result).toEqual({
      ok: false,
      error: 'share token missing — the link must end with #t=<token>',
    })
  })

  it('surfaces decode errors (unsupported version) instead of falling through', () => {
    const result = parseGridUrlConfig('?v=42&devices=1', '#t=tok_tok', ORIGIN)
    expect(result).toEqual({ ok: false, error: 'unsupported share-link version "42"' })
  })

  it('surfaces a devices error for a share attempt with a bad list', () => {
    const result = parseGridUrlConfig('?v=1&devices=1,junk', '#t=tok_tok', ORIGIN)
    expect(result).toEqual({ ok: false, error: 'invalid or missing devices list' })
  })
})
