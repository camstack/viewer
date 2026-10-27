/**
 * The Home Assistant cards the share dialogs offer: the same frozen view as
 * the link, and no token (the integration injects its own).
 */
import { describe, expect, it } from 'vitest'
import { eventsCardYaml, gridCardYaml } from '../share-snippets.js'
import { DEFAULT_EVENTS_FIELDS } from '../../../shared/events/events-share-url.js'

describe('gridCardYaml', () => {
  it('writes the grid card with the view, quoting the title', () => {
    const yaml = gridCardYaml('Front: door #1', {
      devices: [7, 8],
      layout: 3,
      quality: 'mid',
      showName: true,
      boxes: true,
      activeOnly: true,
    })
    expect(yaml).toBe(
      [
        'type: custom:camstack-grid-card',
        'title: "Front: door #1"',
        'device_ids:',
        '  - 7',
        '  - 8',
        'layout_mode: fit',
        'columns: 3',
        'quality: mid',
        'show_names: true',
        'show_boxes: true',
        'active_only: true',
        '',
      ].join('\n'),
    )
  })

  it('an auto layout lets the card decide, and carries no token', () => {
    const yaml = gridCardYaml('Wall', { devices: [1], layout: 'auto', quality: 'auto', showName: false })
    expect(yaml).toContain('layout_mode: auto')
    expect(yaml).not.toContain('columns')
    expect(yaml).not.toMatch(/token/i)
  })
})

describe('gridCardYaml — every highlight trigger the dialog edits', () => {
  const highlight = {
    enabled: true,
    motion: false,
    audio: 'level' as const,
    audioDb: -24,
    audioHoldSec: 5,
    detection: true,
    detectionHoldSec: 5,
    detectionClasses: ['person', 'vehicle'],
  }

  it('writes the audio trigger as the card\'s low / mid / high preset', () => {
    const yaml = gridCardYaml('Wall', { devices: [1], layout: 'auto', quality: 'auto', showName: true, highlight })
    expect(yaml).toContain('highlight: true\nhighlight_motion: false\n')
    expect(yaml).toContain('highlight_audio: high\n')
  })

  it('writes the detection classes and the hold', () => {
    const yaml = gridCardYaml('Wall', { devices: [1], layout: 'auto', quality: 'auto', showName: true, highlight })
    expect(yaml).toContain(
      ['highlight_detection: true', 'highlight_detection_classes:', '  - person', '  - vehicle', 'highlight_detection_hold: 5'].join('\n'),
    )
  })

  it('an audio trigger that is off, and "any class", stay out of the card', () => {
    const yaml = gridCardYaml('Wall', {
      devices: [1],
      layout: 'auto',
      quality: 'auto',
      showName: true,
      highlight: { ...highlight, audio: 'off', detectionClasses: [] },
    })
    expect(yaml).not.toContain('highlight_audio')
    expect(yaml).not.toContain('highlight_detection_classes')
    expect(yaml).toContain('highlight_detection_hold: 5')
  })

  it('no detection trigger ⇒ no detection hold either', () => {
    const yaml = gridCardYaml('Wall', {
      devices: [1],
      layout: 'auto',
      quality: 'auto',
      showName: true,
      highlight: { ...highlight, detection: false },
    })
    expect(yaml).not.toContain('highlight_detection')
  })
})

describe('eventsCardYaml', () => {
  it('writes the events card; "every camera" leaves device_ids out', () => {
    expect(
      eventsCardYaml({ view: 'reel', rows: 2, thumb: 'small', deviceIds: [], fields: DEFAULT_EVENTS_FIELDS, theme: 'auto' }),
    ).toBe(
      [
        'type: custom:camstack-events-card',
        'view: reel',
        'thumb: small',
        'rows: 2',
        'theme: auto',
        'fields:',
        '  - label',
        '  - camera',
        '  - time',
        '  - badges',
        '',
      ].join('\n'),
    )
  })

  it('carries the theme the dialog picked', () => {
    const yaml = eventsCardYaml({ view: 'gallery', columns: 3, thumb: 'large', deviceIds: [4], fields: DEFAULT_EVENTS_FIELDS, theme: 'dark' })
    expect(yaml).toContain('theme: dark\n')
    expect(yaml).toContain('columns: 3\n')
  })

  it('carries the fields as the card\'s list, and an all-off set as an EMPTY list (images only)', () => {
    const off = { label: false, sublabel: false, camera: true, time: false, badges: false, importance: false }
    expect(eventsCardYaml({ view: 'gallery', thumb: 'medium', deviceIds: [], fields: off, theme: 'auto' })).toContain(
      'fields:\n  - camera\n',
    )
    const none = { ...off, camera: false }
    expect(eventsCardYaml({ view: 'gallery', thumb: 'medium', deviceIds: [], fields: none, theme: 'auto' })).toContain(
      'fields: []\n',
    )
  })

  it('never writes an order: the card is newest first, always', () => {
    const yaml = eventsCardYaml({ view: 'gallery', thumb: 'medium', deviceIds: [], fields: DEFAULT_EVENTS_FIELDS, theme: 'auto' })
    expect(yaml).not.toContain('sort')
  })
})

describe('gridCardYaml — the audio set and the border appearance', () => {
  const base = { devices: [1, 2, 3], layout: 'auto' as const, quality: 'auto' as const, showName: true }
  const highlight = {
    enabled: true,
    motion: true,
    audio: 'off' as const,
    audioDb: -39,
    audioHoldSec: 5,
    detection: false,
    detectionHoldSec: 3,
    appearance: { motionColor: '#22c55e', audioColor: '#3b82f6', detectionColor: '#f59e0b', thickness: 4 },
  }

  it('writes the cameras whose audio starts on, as the link\'s audio= does', () => {
    expect(gridCardYaml('Wall', { ...base, audioOnIds: [2, 3] })).toContain('audio_on:\n  - 2\n  - 3\n')
    expect(gridCardYaml('Wall', base)).not.toContain('audio_on')
  })

  it('writes the border colours (quoted) and thickness while the highlight is on', () => {
    const yaml = gridCardYaml('Wall', { ...base, highlight })
    expect(yaml).toContain(
      [
        'highlight_motion_color: "#22c55e"',
        'highlight_audio_color: "#3b82f6"',
        'highlight_detection_color: "#f59e0b"',
        'highlight_thickness: 4',
      ].join('\n'),
    )
  })

  it('a thickness outside the card\'s 1–8 is clamped, never written out of range', () => {
    const wide = { ...highlight, appearance: { ...highlight.appearance, thickness: 12.4 } }
    expect(gridCardYaml('Wall', { ...base, highlight: wide })).toContain('highlight_thickness: 8\n')
  })

  it('no appearance once the highlight is off', () => {
    const yaml = gridCardYaml('Wall', { ...base, highlight: { ...highlight, enabled: false } })
    expect(yaml).not.toContain('_color')
    expect(yaml).not.toContain('highlight_thickness')
  })

  it('never names cameras through labels', () => {
    expect(gridCardYaml('Wall', { ...base, highlight })).not.toContain('labels')
  })
})

describe('eventsCardYaml — the operator\'s camera names', () => {
  const p = { view: 'gallery' as const, thumb: 'medium' as const, deviceIds: [101, 102], fields: DEFAULT_EVENTS_FIELDS, theme: 'auto' as const }

  it('writes camera_names as the link\'s names= does, quoting every name', () => {
    const yaml = eventsCardYaml({ ...p, deviceNames: { '101': 'Garage, retro', '102': 'Front: door #1' } })
    expect(yaml).toContain('camera_names:\n  101: "Garage, retro"\n  102: "Front: door #1"\n')
  })

  it('no renames ⇒ no camera_names; a malformed entry is skipped as the link skips it', () => {
    expect(eventsCardYaml(p)).not.toContain('camera_names')
    expect(eventsCardYaml({ ...p, deviceNames: {} })).not.toContain('camera_names')
    expect(eventsCardYaml({ ...p, deviceNames: { x: 'bad', '101': '  ' } })).not.toContain('camera_names')
  })
})
