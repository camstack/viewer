/**
 * The truncated serve, judged against the clip the stage is HOLDING (D623).
 *
 * The hub sends `clipIncomplete` once, when the stream ends — so by
 * construction it lands at the moment the operator is most likely to have
 * already moved on. Every guard here exists because drawing that sentence
 * against the wrong file blames the wrong camera read.
 */
import { describe, expect, it } from 'vitest'

import { resolveClipIncompleteNotice } from '../clip-incomplete-notice.js'
import type { ClipIncompleteReport } from '../../recording/recording-messages.js'

const SHORT: ClipIncompleteReport = {
  type: 'clipIncomplete',
  clipId: 'file-1',
  code: 'stream-short',
  reason: 'the camera ended this replay early: 4.3 s of 45.0 s arrived, 40.7 s short.',
}

const EMPTY: ClipIncompleteReport = {
  type: 'clipIncomplete',
  clipId: 'file-1',
  code: 'stream-empty',
  reason: 'the camera granted this replay and sent no video at all.',
}

describe('resolveClipIncompleteNotice', () => {
  it('says nothing before a report', () => {
    expect(resolveClipIncompleteNotice('file-1', null)).toBeNull()
  })

  it('says nothing while no clip holds the frame — go-live leaves nothing to blame', () => {
    expect(resolveClipIncompleteNotice(null, SHORT)).toBeNull()
  })

  it('carries the hub SENTENCE verbatim for a short serve', () => {
    expect(resolveClipIncompleteNotice('file-1', SHORT)).toEqual({
      kind: 'stream-short',
      reason: SHORT.reason,
    })
  })

  it('keeps an empty serve its OWN kind — a camera fault is not a short clip', () => {
    expect(resolveClipIncompleteNotice('file-1', EMPTY)).toEqual({
      kind: 'stream-empty',
      reason: EMPTY.reason,
    })
  })

  it('refuses a report about a DIFFERENT clip', () => {
    expect(resolveClipIncompleteNotice('file-2', SHORT)).toBeNull()
  })

  it('refuses a report with no sentence — the hub owns the words and there is no fallback', () => {
    expect(
      resolveClipIncompleteNotice('file-1', { ...SHORT, reason: '' }),
    ).toBeNull()
    expect(
      resolveClipIncompleteNotice('file-1', { ...SHORT, reason: '   ' }),
    ).toBeNull()
  })
})
