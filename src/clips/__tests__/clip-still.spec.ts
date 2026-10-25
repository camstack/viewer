import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  CLIP_STILL_DISPOSITION_HEADER,
  CLIP_STILL_REASON_CODE_HEADER,
  CLIP_STILL_REASON_HEADER,
  CLIP_STILL_RETRY_ATTEMPTS,
  CLIP_STILL_RETRY_BASE_MS,
  CLIP_STILL_RETRY_MAX_WAIT_MS,
  planClipStillRetry,
  readClipStillAnswer,
  clipStillMessageKey,
} from '../clip-still.js'

/**
 * The wire, captured from the LIVE hub on 2026-09-20 — `@camstack/server@1.2.357`
 * with `provider-reolink` deployed — by firing ONE page of 60 mint URLs in
 * parallel, exactly as a first paint does, and then coming back under D563's
 * ladder until every tile was answered.
 *
 * A hand-written fixture is written to the reading the author already has, and
 * that is precisely how the prose-classification defect shipped: the spec fed
 * the bare token the route never sends. These are the bytes the hub really
 * sent, headers and all.
 */
const FIXTURE = join(process.cwd(), 'src', 'clips', '__tests__', 'fixtures', 'live-592-first-paint-stills.json')

interface WireHeaders {
  readonly 'x-camstack-disposition': string | null
  readonly 'x-camstack-reason-code': string | null
  readonly 'x-camstack-reason': string | null
  readonly 'retry-after': string | null
}

interface WireAnswer {
  readonly attempt: number
  readonly status: number
  readonly headers: WireHeaders
}

interface WireTile {
  readonly outcome: string
  readonly requests: number
  readonly answers: readonly WireAnswer[]
}

interface WirePaint {
  readonly deviceId: number
  readonly elapsedMs: number
  readonly totalRequests: number
  readonly tiles: readonly WireTile[]
}

const PAINT: WirePaint = JSON.parse(readFileSync(FIXTURE, 'utf8'))

/** The captured headers, as a `Headers`-shaped reader. */
function headersOf(answer: WireAnswer): Headers {
  const h = new Headers()
  for (const [name, value] of Object.entries(answer.headers)) {
    if (typeof value === 'string') h.set(name, value)
  }
  return h
}

describe('a real first paint of 60 tiles', () => {
  const firstRound = PAINT.tiles.map((t) => t.answers[0])

  it('is 17 stills and 43 queued — the majority answer is “come back”, not “no”', () => {
    const answers = firstRound.map((a) => readClipStillAnswer(a.status, headersOf(a)))
    expect(answers.filter((a) => a.kind === 'served')).toHaveLength(17)
    expect(answers.filter((a) => a.kind === 'deferred')).toHaveLength(43)
    expect(answers.filter((a) => a.kind === 'refused')).toHaveLength(0)
  })

  it('reads the code and the wait off the headers, never off the prose', () => {
    // The live defect this guards: the route sends the whole SENTENCE in
    // `x-camstack-reason` — `queue-full: 16 thumbnail mints already waiting
    // for host …` — while the surface keyed its table on the bare token. No
    // key ever matched. Assert from the real bytes that the two differ, so a
    // client that went back to matching the prose goes red here.
    const deferred = firstRound.filter((a) => a.status === 204)
    expect(deferred.length).toBeGreaterThan(0)
    for (const answer of deferred) {
      const prose = answer.headers[CLIP_STILL_REASON_HEADER]
      const code = answer.headers[CLIP_STILL_REASON_CODE_HEADER]
      expect(code).toBe('queue-full')
      expect(prose).not.toBe(code)
      expect(prose?.startsWith('queue-full:')).toBe(true)

      const read = readClipStillAnswer(answer.status, headersOf(answer))
      expect(read.kind).toBe('deferred')
      if (read.kind !== 'deferred') return
      expect(read.code).toBe('queue-full')
      expect(read.reason).toBe(prose)
      // `retry-after: 16` — seconds on the wire, ms in the app.
      expect(read.retryAfterMs).toBe(16_000)
      // The words the tile shows come from the CODE. A tile keyed on the
      // sentence would fall through to rendering the sentence.
      expect(clipStillMessageKey(read.code)).toBe('v2.clips.still.queueFull')
    }
  })

  it('never ran out of budget on the real drain: every tile was served, none gave up', () => {
    let requests = 0
    for (const tile of PAINT.tiles) {
      let attempt = 0
      for (const answer of tile.answers) {
        requests += 1
        const read = readClipStillAnswer(answer.status, headersOf(answer))
        if (read.kind === 'served') break
        expect(read.kind).toBe('deferred')
        if (read.kind !== 'deferred') return
        // The policy still had budget at every deferred answer the hub gave.
        const plan = planClipStillRetry({
          attempt,
          serverHintMs: read.retryAfterMs,
          random: () => 0.5,
        })
        expect(plan).not.toBeNull()
        attempt += 1
      }
      expect(tile.answers[tile.answers.length - 1]?.status).toBe(200)
    }
    // 103 requests served all 60 tiles in 20.6 s, against 17 served and 43
    // blank for ever. If the lane depth or the page size moves, this is the
    // number to re-measure.
    expect(requests).toBe(PAINT.totalRequests)
    expect(requests).toBe(103)
    expect(PAINT.elapsedMs).toBeLessThan(60_000)
  })
})

describe('what the disposition header decides, and nothing else', () => {
  it('a 200 is a still', () => {
    expect(readClipStillAnswer(200, new Headers()).kind).toBe('served')
  })

  it('a 204 with NO disposition is final — byte-for-byte the pre-D563 behaviour', () => {
    const h = new Headers({ [CLIP_STILL_REASON_HEADER]: 'queue-full: 16 waiting' })
    const read = readClipStillAnswer(204, h)
    expect(read.kind).toBe('refused')
  })

  it('a disposition this build has never heard of is final, never a retry loop', () => {
    const h = new Headers({ [CLIP_STILL_DISPOSITION_HEADER]: 'maybe-later' })
    expect(readClipStillAnswer(204, h).kind).toBe('refused')
  })

  it('a final refusal keeps the camera’s own words and its code', () => {
    const h = new Headers({
      [CLIP_STILL_DISPOSITION_HEADER]: 'final',
      [CLIP_STILL_REASON_CODE_HEADER]: 'sleeping',
      [CLIP_STILL_REASON_HEADER]: 'sleeping: a still would cost a wake',
    })
    const read = readClipStillAnswer(204, h)
    expect(read.kind).toBe('refused')
    if (read.kind !== 'refused') return
    expect(read.code).toBe('sleeping')
    expect(read.reason).toBe('sleeping: a still would cost a wake')
    expect(clipStillMessageKey(read.code)).toBe('v2.clips.still.sleeping')
  })

  it('a code no build knows has no key — the tile falls back to the provider’s words', () => {
    expect(clipStillMessageKey('something-new')).toBeNull()
    expect(clipStillMessageKey(null)).toBeNull()
  })
})

describe('the ladder: bounded, jittered, and the server’s hint is a FLOOR', () => {
  const mid = (): number => 0.5

  it('doubles from the base', () => {
    const waits = [0, 1, 2].map(
      (attempt) => planClipStillRetry({ attempt, serverHintMs: null, random: mid })?.waitMs,
    )
    expect(waits).toEqual([
      CLIP_STILL_RETRY_BASE_MS,
      CLIP_STILL_RETRY_BASE_MS * 2,
      CLIP_STILL_RETRY_BASE_MS * 4,
    ])
  })

  it('caps every single wait, whatever the server hints', () => {
    const plan = planClipStillRetry({ attempt: 0, serverHintMs: 600_000, random: mid })
    expect(plan?.waitMs).toBe(CLIP_STILL_RETRY_MAX_WAIT_MS)
  })

  it('takes the hub’s real `retry-after: 16` because it is LONGER than the 4 s curve', () => {
    expect(planClipStillRetry({ attempt: 0, serverHintMs: 16_000, random: mid })?.waitMs).toBe(16_000)
  })

  it('ignores a hint SHORTER than the curve — 43 tiles told “1 s” must not become 43 req/s', () => {
    expect(planClipStillRetry({ attempt: 0, serverHintMs: 1_000, random: mid })?.waitMs).toBe(
      CLIP_STILL_RETRY_BASE_MS,
    )
  })

  it('stops — a tile that asks for ever is the other way to show nothing', () => {
    expect(planClipStillRetry({ attempt: CLIP_STILL_RETRY_ATTEMPTS, serverHintMs: null, random: mid })).toBeNull()
    expect(planClipStillRetry({ attempt: -1, serverHintMs: null, random: mid })).toBeNull()
  })

  it('jitters for real: the 43 tiles refused in ONE paint do not come back together', () => {
    // The collision that caused this: 43 tiles deferred in the same instant,
    // returning in the same instant, refusing together again. Driven by the
    // real `Math.random`, not a stub, because a stub cannot fail this way.
    const waits = PAINT.tiles
      .filter((t) => t.answers.length > 1)
      .map(
        () =>
          planClipStillRetry({ attempt: 0, serverHintMs: 16_000, random: Math.random })?.waitMs ?? 0,
      )
    expect(waits).toHaveLength(43)
    expect(new Set(waits).size).toBeGreaterThan(30)
    expect(Math.min(...waits)).toBeGreaterThanOrEqual(12_000)
    expect(Math.max(...waits)).toBeLessThanOrEqual(20_000)
    // Spread across at least a second of real time, not clustered in one tick.
    expect(Math.max(...waits) - Math.min(...waits)).toBeGreaterThan(1_000)
  })
})
