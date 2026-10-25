/**
 * The gallery-panel thumbnail caption names the RICHEST label the event carries:
 * identity / plate (verbatim) > sub-class (translated) > class (translated), and
 * an audio event names what was heard. Translation is always the shared
 * resolver's — the spec injects one whose output is distinguishable from its input.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { thumbCaptionLabel, type ThumbCaptionResolver } from '../thumb-caption-label.js'
import { trackToTimelineEvent } from '../../../../data/use-device-tracks.js'
import type { TrackSummary } from '../../../../data/track-events.js'

const resolver: ThumbCaptionResolver = {
  resolveLabel: (id) => `T(${id})`,
  resolveAudioLabel: (id) => `A(${id})`,
}

describe('thumbCaptionLabel', () => {
  it('shows the identity name verbatim, never translated', () => {
    expect(thumbCaptionLabel({ className: 'person', subLabel: 'Carol' }, resolver)).toBe('Carol')
  })

  it('shows a plate text verbatim over the sub-class and class', () => {
    expect(
      thumbCaptionLabel({ className: 'vehicle', label: 'van', subLabel: 'AB123CD' }, resolver),
    ).toBe('AB123CD')
  })

  it('translates the sub-class through the shared resolver when no instance label exists', () => {
    expect(thumbCaptionLabel({ className: 'animal', label: 'dog' }, resolver)).toBe('T(dog)')
  })

  it('translates the class last', () => {
    expect(thumbCaptionLabel({ className: 'person' }, resolver)).toBe('T(person)')
  })

  it('ignores empty enrichment strings', () => {
    expect(thumbCaptionLabel({ className: 'person', subLabel: '', label: '' }, resolver)).toBe(
      'T(person)',
    )
  })

  it('names what was heard on an audio event, via the audio resolver', () => {
    expect(
      thumbCaptionLabel({ className: 'audio', audioLabels: ['baby_cry', 'speech'] }, resolver),
    ).toBe('A(baby_cry)')
  })

  it('keeps the class for an audio event that carries no audio label', () => {
    expect(thumbCaptionLabel({ className: 'audio' }, resolver)).toBe('T(audio)')
  })

  it('does not let incidental audio rename a video track', () => {
    expect(
      thumbCaptionLabel({ className: 'person', audioLabels: ['speech'] }, resolver),
    ).toBe('T(person)')
  })
})

describe('the timeline event carries the instance label', () => {
  const track = {
    bestEventId: 'e1',
    deviceId: 1,
    firstSeen: 10,
    lastSeen: 20,
    className: 'person',
    label: undefined,
    subLabel: 'Carol',
    importance: undefined,
    trackId: 't1',
    audioLabels: [],
  } as unknown as TrackSummary

  it('copies subLabel from the track (no extra hub call)', () => {
    expect(trackToTimelineEvent(track).subLabel).toBe('Carol')
  })
})

describe('ClusterCard caption wiring', () => {
  const src = readFileSync(
    join(process.cwd(), 'src/components/camera/theater/ClusterCard.tsx'),
    'utf8',
  )

  it('draws the caption from thumbCaptionLabel, ellipsised on one line', () => {
    expect(src).toContain('thumbCaptionLabel(event, resolver)')
    expect(src).toMatch(/numberOfLines=\{1\}\s+ellipsizeMode="tail"/)
  })

  it('puts the full label in the accessibility label', () => {
    expect(src).toContain('accessibilityLabel={`${formatHHMM(event.timestamp)} ${caption}`}')
  })
})
