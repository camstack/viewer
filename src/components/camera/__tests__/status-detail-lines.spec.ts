/**
 * The popover's CONTENT, as a pure derivation — the part that must not invent a
 * number.
 *
 * Three tri-states meet here and each has been shown, in this codebase, as a
 * fabricated figure at some point: `signalPercent: null` is not 0 % (a wire has
 * no signal at all), `binary: true` is a camera that reports ok/low and no
 * percentage, and `charging: 'unknown'` is the absence of a read, never "not
 * charging". Asserted over keys and literal text so the claim survives a
 * wording change in `locales/`.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  batteryDetailLines,
  networkLinkDetailLines,
  streamDetailLines,
  STATUS_DETAIL_KEY,
  type StatusDetailLine,
} from '../status-detail-lines.js'
import type { StreamDebugSample, StreamDebugServer } from '../../../live/stream-debug-sample.js'

const text = (lines: readonly StatusDetailLine[], labelKey: string): string | null => {
  const line = lines.find((l) => l.labelKey === labelKey)
  return line !== undefined && line.kind === 'text' ? line.text : null
}
const valueKey = (lines: readonly StatusDetailLine[], labelKey: string): string | null => {
  const line = lines.find((l) => l.labelKey === labelKey)
  return line !== undefined && line.kind === 'key' ? line.valueKey : null
}

describe('battery detail lines', () => {
  it('states the charge as a figure, and the power source in words', () => {
    const lines = batteryDetailLines({ percentage: 87.4, charging: 'dc', sleeping: false })
    expect(text(lines, STATUS_DETAIL_KEY.label.charge)).toBe('87%')
    expect(valueKey(lines, STATUS_DETAIL_KEY.label.charging)).toBe(STATUS_DETAIL_KEY.value.chargingDc)
    // Not sleeping is not a line: the popover states what IS, not what is not.
    expect(lines.some((l) => l.labelKey === STATUS_DETAIL_KEY.label.state)).toBe(false)
  })

  it('a binary battery gets no percentage at all', () => {
    const lines = batteryDetailLines({ percentage: 100, charging: 'none', sleeping: false, binary: true })
    expect(text(lines, STATUS_DETAIL_KEY.label.charge)).toBeNull()
    expect(valueKey(lines, STATUS_DETAIL_KEY.label.charge)).toBe(STATUS_DETAIL_KEY.value.binary)
    expect(JSON.stringify(lines)).not.toContain('100')
  })

  it("`unknown` charging is unknown, never 'not charging'", () => {
    const lines = batteryDetailLines({ percentage: 12, charging: 'unknown', sleeping: false })
    expect(valueKey(lines, STATUS_DETAIL_KEY.label.charging)).toBe(STATUS_DETAIL_KEY.value.unknown)
    expect(valueKey(lines, STATUS_DETAIL_KEY.label.charging)).not.toBe(STATUS_DETAIL_KEY.value.chargingNone)
  })

  it('says so when the camera is asleep', () => {
    const lines = batteryDetailLines({ percentage: 40, charging: 'none', sleeping: true })
    expect(valueKey(lines, STATUS_DETAIL_KEY.label.state)).toBe(STATUS_DETAIL_KEY.value.sleeping)
  })

  it('a percentage that is not a number is unknown, not zero', () => {
    const lines = batteryDetailLines({ percentage: Number.NaN, charging: 'none', sleeping: false })
    expect(valueKey(lines, STATUS_DETAIL_KEY.label.charge)).toBe(STATUS_DETAIL_KEY.value.unknown)
  })
})

describe('network link detail lines', () => {
  it('names the link and states the signal with its figure, plus the SSID', () => {
    const lines = networkLinkDetailLines({ type: 'wifi', signalPercent: 62.6, ssid: 'CasaWifi' })
    expect(valueKey(lines, STATUS_DETAIL_KEY.label.linkType)).toBe(STATUS_DETAIL_KEY.value.wifi)
    expect(text(lines, STATUS_DETAIL_KEY.label.signal)).toBe('63%')
    expect(text(lines, STATUS_DETAIL_KEY.label.ssid)).toBe('CasaWifi')
  })

  it('a wire has no signal — not applicable, never 0 %', () => {
    const lines = networkLinkDetailLines({ type: 'ethernet', signalPercent: null })
    expect(valueKey(lines, STATUS_DETAIL_KEY.label.signal)).toBe(STATUS_DETAIL_KEY.value.notApplicable)
    expect(JSON.stringify(lines)).not.toContain('0%')
  })

  it('a wireless link whose signal was not read is unknown, never 0 %', () => {
    const lines = networkLinkDetailLines({ type: 'cellular', signalPercent: null })
    expect(valueKey(lines, STATUS_DETAIL_KEY.label.signal)).toBe(STATUS_DETAIL_KEY.value.unknown)
    expect(JSON.stringify(lines)).not.toContain('0%')
  })

  it('no SSID, no line — an absent name is not an empty one', () => {
    const lines = networkLinkDetailLines({ type: 'wifi', signalPercent: 10 })
    expect(lines.some((l) => l.labelKey === STATUS_DETAIL_KEY.label.ssid)).toBe(false)
  })

  it('an unknown link type stays unknown', () => {
    const lines = networkLinkDetailLines({ type: 'unknown', signalPercent: null })
    expect(valueKey(lines, STATUS_DETAIL_KEY.label.linkType)).toBe(STATUS_DETAIL_KEY.value.linkUnknown)
  })
})

describe('the quality-ladder line', () => {
  const server = (over: Partial<StreamDebugServer>): StreamDebugServer => ({
    alive: true,
    servedTier: 'low',
    adaptive: true,
    camStreamId: 'native:sub',
    sourceKind: 'native',
    ingestNodeId: 'hub',
    egressLeg: 'copy',
    lastDecision: null,
    climbHold: null,
    ...over,
  })
  const sample = (s: StreamDebugServer): StreamDebugSample => ({
    at: 1,
    verdict: 'decoding',
    sessionId: 's',
    stats: null,
    server: s,
    serverError: null,
    serverWired: true,
  })

  it('says WHY it is holding instead of "never moved" when the server names a reason', () => {
    const lines = streamDetailLines(
      sample(
        server({
          climbHold: {
            code: 'capacity',
            summary: 'held: probe 1400 kbps, REMB 480 kbps < mid needs 2160 kbps (1800 × 1.2)',
          },
        }),
      ),
    )
    expect(valueKey(lines, STATUS_DETAIL_KEY.label.ladder)).toBe(STATUS_DETAIL_KEY.value.ladderHeldCapacity)
    expect(text(lines, STATUS_DETAIL_KEY.label.ladderWhy)).toBe(
      'held: probe 1400 kbps, REMB 480 kbps < mid needs 2160 kbps (1800 × 1.2)',
    )
  })

  it('names a reverted try and its backoff, with the hub\'s own numbers beside it', () => {
    const lines = streamDetailLines(
      sample(
        server({
          climbHold: { code: 'try-backoff', summary: 'held: tried mid, reverted: delivery 0.60; next try in 30.0s' },
        }),
      ),
    )
    expect(valueKey(lines, STATUS_DETAIL_KEY.label.ladder)).toBe(STATUS_DETAIL_KEY.value.ladderHeldTryBackoff)
    expect(text(lines, STATUS_DETAIL_KEY.label.ladderWhy)).toBe(
      'held: tried mid, reverted: delivery 0.60; next try in 30.0s',
    )
  })

  it('names a reverted try by its own cause, not the legacy "loss" it is carried as', () => {
    const lines = streamDetailLines(
      sample(server({ lastDecision: { cause: 'loss', causeDetail: 'trial-revert', tier: 'low' } })),
    )
    expect(text(lines, STATUS_DETAIL_KEY.label.ladder)).toBe('trial-revert → low')
  })

  it('still says "never moved" when the server gives no reason (an older hub)', () => {
    const lines = streamDetailLines(sample(server({})))
    expect(valueKey(lines, STATUS_DETAIL_KEY.label.ladder)).toBe(STATUS_DETAIL_KEY.value.ladderNeverMoved)
    expect(lines.some((l) => l.labelKey === STATUS_DETAIL_KEY.label.ladderWhy)).toBe(false)
  })

  it('keeps the last move on the ladder line and the current hold beside it', () => {
    const lines = streamDetailLines(
      sample(
        server({
          lastDecision: { cause: 'healthy', causeDetail: null, tier: 'mid' },
          climbHold: { code: 'delivery', summary: 'held: delivery 0.62 over 6.0s < 0.90' },
        }),
      ),
    )
    expect(text(lines, STATUS_DETAIL_KEY.label.ladder)).toBe('healthy → mid')
    expect(text(lines, STATUS_DETAIL_KEY.label.ladderWhy)).toBe('held: delivery 0.62 over 6.0s < 0.90')
  })
})

describe('every key the popover can render exists in both languages', () => {
  const load = (lang: string): Record<string, unknown> =>
    JSON.parse(readFileSync(new URL(`../../../../locales/${lang}.json`, import.meta.url), 'utf8')) as Record<string, unknown>
  const at = (bag: Record<string, unknown>, key: string): unknown =>
    key.split('.').reduce<unknown>((node, part) => (node !== null && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined), bag)

  const KEYS: readonly string[] = [
    ...Object.values(STATUS_DETAIL_KEY.label),
    ...Object.values(STATUS_DETAIL_KEY.value),
    STATUS_DETAIL_KEY.batteryTitle,
    STATUS_DETAIL_KEY.linkTitle,
  ]

  for (const lang of ['en', 'it']) {
    it(`${lang} translates all of them`, () => {
      const bag = load(lang)
      for (const key of KEYS) expect(typeof at(bag, key), key).toBe('string')
    })
  }
})
