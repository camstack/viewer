import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  planClipExit,
  reduceClipLoading,
  resolvePauseAuthority,
  shouldEndLiveCapture,
} from '../clip-transport.js'

describe('resolvePauseAuthority — a clip is paused by the RATE, whatever the machine says', () => {
  it('a clip opened from the live edge is NOT paused by the live hold', () => {
    // The failure: the machine still said `live`, so play/pause tore the
    // player down — and the clip with it.
    expect(resolvePauseAuthority({ mode: 'live', clipHeld: true })).toBe('rate')
  })

  it('a clip opened off the live edge is paused by the rate too', () => {
    for (const mode of ['seeking', 'playback', 'gap', 'error'] as const) {
      expect(resolvePauseAuthority({ mode, clipHeld: true })).toBe('rate')
    }
  })

  it('without a clip the rule is exactly what it was: live hold at the edge, rate off it', () => {
    expect(resolvePauseAuthority({ mode: 'live', clipHeld: false })).toBe('live-hold')
    expect(resolvePauseAuthority({ mode: 'playback', clipHeld: false })).toBe('rate')
    expect(resolvePauseAuthority({ mode: 'seeking', clipHeld: false })).toBe('rate')
  })
})

describe('planClipExit — two exits, and only go-live leaves the frame', () => {
  it('go-live closes the stage FIRST and then moves the machine', () => {
    expect(planClipExit('live')).toEqual({ closeStage: true, goLive: true })
  })

  it('prev / next keep the stage — only its clip changes', () => {
    expect(planClipExit('list')).toEqual({ closeStage: false, goLive: false })
  })
})

/**
 * The rule above is only a rule if the screen reads it — for BOTH halves of
 * the one pause binding, and for the go-live handler the bar is given. A
 * decision written where nothing executes it is the shape of every bug this
 * surface has produced (`clips-surface-consumed.spec.ts` says why).
 */
describe('the camera-detail screen consumes the rule', () => {
  const screen = readFileSync(join(process.cwd(), 'src', 'screens', 'CameraDetailScreen.tsx'), 'utf8')

  it('derives the pause authority from resolvePauseAuthority, once, with the clip stage in it', () => {
    expect(screen.match(/resolvePauseAuthority\(/g)?.length).toBe(1)
    expect(screen).toMatch(/resolvePauseAuthority\(\{[^}]*clipHeld/s)
  })

  it('reads that authority for the paused STATE and for the press', () => {
    // The binding the guard `docked-timeline-chrome.spec.ts` already pins…
    expect(screen).toContain('const effectivePaused = pausedByRate ? recPaused : paused')
    // …and the toggle it feeds, branching on the same word.
    expect(screen).toContain('if (pausedByRate) onToggleRecPause()')
  })

  it('the go-live the bar is given closes the clip stage before the machine moves', () => {
    const start = screen.indexOf('const leaveClipToLive = useCallback(')
    expect(start).toBeGreaterThan(-1)
    const body = screen.slice(start, screen.indexOf('}, [', start))
    expect(body.indexOf('closeClipStage()')).toBeGreaterThan(-1)
    expect(body.indexOf('playback.goLive()')).toBeGreaterThan(body.indexOf('closeClipStage()'))
    expect(screen).toContain('onGoLive: leaveClipToLive,')
  })
})

describe('reduceClipLoading — the clip’s own wait, armed by the tap and cleared by the file’s first state', () => {
  it('arms on open, before the player has said anything', () => {
    expect(reduceClipLoading(null, { kind: 'opened', clipId: 'c1' })).toBe('c1')
  })

  it('a `loading` report keeps the wait; the first real state ends it', () => {
    expect(reduceClipLoading('c1', { kind: 'player', state: 'loading' })).toBe('c1')
    for (const state of ['playing', 'paused', 'gap', 'error'] as const) {
      expect(reduceClipLoading('c1', { kind: 'player', state })).toBeNull()
    }
  })

  it('a `live` report ends it too — the session has left the clip', () => {
    expect(reduceClipLoading('c1', { kind: 'player', state: 'live' })).toBeNull()
  })

  it('closing the stage forgets it', () => {
    expect(reduceClipLoading('c1', { kind: 'closed' })).toBeNull()
  })

  it('a report with nothing armed arms nothing', () => {
    expect(reduceClipLoading(null, { kind: 'player', state: 'loading' })).toBeNull()
  })
})

describe('shouldEndLiveCapture — a clip on the frame ends a capture like leaving the live edge does', () => {
  it('ends it when a clip takes the frame, though the machine still says live', () => {
    expect(shouldEndLiveCapture({ mode: 'live', clipHeld: true })).toBe(true)
  })

  it('ends it off the live edge, exactly as before', () => {
    for (const mode of ['seeking', 'playback', 'gap', 'error'] as const) {
      expect(shouldEndLiveCapture({ mode, clipHeld: false })).toBe(true)
    }
  })

  it('leaves a capture of the live picture alone', () => {
    expect(shouldEndLiveCapture({ mode: 'live', clipHeld: false })).toBe(false)
  })
})

/**
 * Both rules are only rules if the screen and the stage read them.
 */
describe('the screen and the stage consume the loading and capture rules', () => {
  const screen = readFileSync(join(process.cwd(), 'src', 'screens', 'CameraDetailScreen.tsx'), 'utf8')
  const stage = readFileSync(join(process.cwd(), 'src', 'clips', 'use-clip-stage.ts'), 'utf8')

  it('the bar’s ring reads the CLIP’s wait while a clip holds the frame, never the session’s', () => {
    expect(screen).toMatch(/const transportLoading = clipStage\.stage\.kind === 'clip'\s*\?\s*!wallShowing && clipStage\.loading/)
  })

  it('every embed state report reaches the stage, or the ring never clears', () => {
    expect(screen).toContain('const reportClipPlayerState = clipStage.reportPlayerState')
    expect(screen).toContain('reportClipPlayerState(embed)')
  })

  it('the stage arms the wait on the native dispatch and routes reports through the reducer', () => {
    expect(stage).toMatch(/reduceClipLoading\(prev, \{ kind: 'opened', clipId: next\.clipId \}\)/)
    expect(stage).toMatch(/reduceClipLoading\(prev, \{ kind: 'player', state \}\)/)
    expect(stage).toMatch(/reduceClipLoading\(prev, \{ kind: 'closed' \}\)/)
    expect(stage).toContain("loading: stage.kind === 'clip' && loadingClipId === stage.clipId")
  })

  it('the capture-ending effect reads shouldEndLiveCapture with the clip stage in it', () => {
    expect(screen).toMatch(/shouldEndLiveCapture\(\{ mode: playback\.state\.mode, clipHeld \}\)/)
    expect(screen).toMatch(/\}, \[playback\.state\.mode, clipHeld\]\)/)
  })

  it('no record control while a clip holds the frame — neither flow is offered', () => {
    expect(screen).toContain('liveCapture={wallShowing || clipHeld ? undefined : liveCaptureBinding}')
    expect(screen).toContain('exportSelection={wallShowing || clipHeld ? undefined : exportSelection}')
  })
})
