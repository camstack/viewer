import { describe, expect, it } from 'vitest'
import {
  formatTrackSpan,
  parseTrackDetailQuery,
  selectTrackDetailMedia,
} from '../events-track-detail'

describe('parseTrackDetailQuery', () => {
  it('reads the three ids a trackClick carries', () => {
    expect(parseTrackDetailQuery('?mode=track&v=1&id=t-1&device=7&best=e-9')).toEqual({
      trackId: 't-1',
      deviceId: 7,
      bestEventId: 'e-9',
    })
  })
  it('accepts the long spellings', () => {
    expect(parseTrackDetailQuery('?id=t-1&deviceId=3&bestEventId=b')).toEqual({
      trackId: 't-1',
      deviceId: 3,
      bestEventId: 'b',
    })
  })
  it('has no device when it is missing or not a number', () => {
    expect(parseTrackDetailQuery('?id=t-1')?.deviceId).toBeNull()
    expect(parseTrackDetailQuery('?id=t-1&device=abc')?.deviceId).toBeNull()
  })
  it('is null without an id', () => {
    expect(parseTrackDetailQuery('?mode=track')).toBeNull()
    expect(parseTrackDetailQuery('?id=%20')).toBeNull()
  })
})

describe('selectTrackDetailMedia', () => {
  const raw = [
    { mediaId: 1, kind: 'keyFrame', timestamp: 1, url: '/addon/pipeline-analytics/event-media/m/1' },
    { mediaId: 2, kind: 'clip', timestamp: 2, url: '/addon/pipeline-analytics/event-media/m/2' },
    { mediaId: 3, kind: 'crop', timestamp: 3 },
  ]
  it('splits stills from the clip and thumbs the stills against the hub', () => {
    const set = selectTrackDetailMedia(raw, 'https://hub.test')
    expect(set.stills.map((s) => s.kind)).toEqual(['keyFrame'])
    expect(set.stills[0]?.url).toBe(
      'https://hub.test/addon/pipeline-analytics/event-media/m/1?variant=thumb&size=240',
    )
    expect(set.clip?.url).toBe('https://hub.test/addon/pipeline-analytics/event-media/m/2')
  })
  it('drops a row that names no address of its own', () => {
    expect(selectTrackDetailMedia(raw, 'https://hub.test').stills.some((s) => s.kind === 'crop')).toBe(false)
  })
  it('is empty for a non-array answer', () => {
    expect(selectTrackDetailMedia(null, 'https://hub.test')).toEqual({ stills: [], clip: null })
  })
})

describe('formatTrackSpan', () => {
  it('formats seconds and minutes', () => {
    expect(formatTrackSpan(0, 12_000)).toBe('12 s')
    expect(formatTrackSpan(0, 120_000)).toBe('2 min')
    expect(formatTrackSpan(0, 184_000)).toBe('3 min 4 s')
  })
})

import { parseEventsUrlConfig } from '../events-url-config'

describe('track URL shares the events config path', () => {
  it('parses as a whole relayed config, ignoring the track ids', () => {
    const r = parseEventsUrlConfig(
      '?mode=track&v=1&id=t-1&device=7&theme=dark',
      '',
      'https://ha.test',
      '/api/camstack/p/grant/viewer/camstack/embed/index.html',
    )
    expect(r?.ok).toBe(true)
  })
})
