/**
 * The end of a file is not an ERROR, and both hosts must say so.
 *
 * The broker's clip feeder emits `state: 'ended'` when the file plays out
 * (`clip-stream-feeder.ts`: `emitState('ended', 'stream-played-out')`), the
 * embed forwards it as `{type:'recState',state:'ended'}` — and BOTH app seams
 * dropped it onto their `default:` arm, which is `'error'`. So a clip that
 * simply finished rang the playback bar's danger ring, and on a recorded
 * session the machine adopted `error` as its mode: a fault notice for a file
 * that did exactly what it was asked to.
 *
 * It also meant the app had no end-of-clip fact at all, which is what the loop
 * switch is decided from (`clips/clip-loop.ts`).
 *
 * ONE mapper, in one module, for both platforms: the two switches were
 * hand-copies of each other ("Mirrors the iOS `mapRecState` 1:1" said the web
 * one) and a hand-copy is a second opinion waiting to drift.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { mapRecState } from '../rec-state.js'

const SRC = join(process.cwd(), 'src')
const read = (rel: string): string => readFileSync(join(SRC, rel), 'utf8')

describe('mapRecState — what the embed says, as the app understands it', () => {
  it('carries the END of a file through as itself, never as an error', () => {
    expect(mapRecState('ended')).toBe('ended')
  })

  it('passes every other state the embed can report', () => {
    for (const state of ['live', 'loading', 'playing', 'paused', 'gap', 'error'] as const) {
      expect(mapRecState(state), state).toBe(state)
    }
  })

  it('collapses anything it has never heard of to an error', () => {
    // A state from a NEWER embed is not a state this build can act on, and
    // pretending it is `playing` would be a claim about the picture.
    for (const state of ['', 'ENDED', 'buffering', 'idle']) {
      expect(mapRecState(state), state).toBe('error')
    }
  })
})

describe('both hosts read that one mapper', () => {
  it('the iOS WebView host', () => {
    expect(read('live/LiveViewWebView.tsx')).toContain("from './rec-state.js'")
  })

  it('the web iframe host', () => {
    expect(read('live/LiveView.web.tsx')).toContain("from './rec-state.js'")
  })

  it('and neither keeps a switch of its own', () => {
    for (const rel of ['live/LiveViewWebView.tsx', 'live/LiveView.web.tsx']) {
      expect(read(rel), rel).not.toContain("case 'paused':")
    }
  })
})
