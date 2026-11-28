/**
 * Which message fields the rule editor shows for the selected targets (#483).
 *
 * The viewer's port of the hub's `deliverableFields` / `fieldSupportForTargets`
 * (`@dominevo/types`, not on the `/client` entry): the fields come from each
 * target kind's DECLARATION (`caps`), never from its kind string — a kind named
 * anything that declares "title only" is treated as a speaker.
 */
import { describe, expect, it } from 'vitest'
import {
  deliverableFields,
  fieldSupportForSelection,
} from '../rule-field-support.js'
import {
  TargetKindSchema,
  type Target,
  type TargetKind,
  type TargetKindCaps,
} from '../../../data/notification-center.js'

const PHONE_CAPS: TargetKindCaps = {
  attachments: { mediaTypes: ['image', 'video'], mode: 'url', max: 1 },
  actions: 3,
  levels: [
    { id: 'low', label: 'Low', ordinal: 1 },
    { id: 'high', label: 'High', ordinal: 5 },
  ],
  format: ['text'],
  clickUrl: true,
  sound: true,
  ttl: false,
  bodyMaxLen: 1024,
}

/** A speaker: says a title and nothing else. Deliberately NOT named "alexa". */
const SPEAKER_CAPS: TargetKindCaps = {
  text: { title: true, body: false },
  attachments: { mediaTypes: [], mode: 'url', max: 0 },
  actions: 0,
  levels: [{ id: 'normal', label: 'Normal', ordinal: 3 }],
  format: ['text'],
  clickUrl: false,
  sound: false,
  ttl: false,
  bodyMaxLen: 200,
}

function kindOf(kind: string, caps: TargetKindCaps): TargetKind {
  return { kind, label: kind, icon: 'bell', addonId: 'notifiers', configSchema: {}, supportsDiscovery: false, caps }
}

const KINDS: readonly TargetKind[] = [kindOf('phone-push', PHONE_CAPS), kindOf('house-voice', SPEAKER_CAPS)]

function target(id: string, name: string, kind: string): Target {
  return { id, name, kind, addonId: 'notifiers', enabled: true, config: {} }
}

const TARGETS: readonly Target[] = [
  target('p', 'Phone', 'phone-push'),
  target('s', 'Kitchen speaker', 'house-voice'),
  target('x', 'Mystery', 'not-in-catalog'),
]

describe('deliverableFields — the one reading of a kind declaration', () => {
  it('a speaker that declares a title only delivers the title only', () => {
    expect(deliverableFields(SPEAKER_CAPS)).toEqual(['title'])
  })

  it('absent text caps mean title AND body (every kind declared before #483)', () => {
    expect(deliverableFields(PHONE_CAPS)).toEqual(['title', 'body', 'attachments', 'actions', 'priority', 'sound', 'clickUrl'])
  })

  it('a single priority level is no priority choice', () => {
    expect(deliverableFields({ ...PHONE_CAPS, levels: [{ id: 'n', label: 'N', ordinal: 3 }] })).not.toContain('priority')
  })
})

describe('fieldSupportForSelection — what the rule-level editor shows', () => {
  it('every target a speaker: only the title shows', () => {
    const support = fieldSupportForSelection(['s'], TARGETS, KINDS)
    const shown = [...support.values()].filter((entry) => entry.shown).map((entry) => entry.field)
    expect(shown).toEqual(['title'])
  })

  it('mixed targets: the union shows, and each field names who drops it', () => {
    const support = fieldSupportForSelection(['p', 's'], TARGETS, KINDS)
    expect(support.get('body')).toEqual({ field: 'body', shown: true, droppedBy: ['Kitchen speaker'] })
    expect(support.get('title')).toEqual({ field: 'title', shown: true, droppedBy: [] })
    expect(support.get('priority')?.shown).toBe(true)
  })

  it('no selection shows every field', () => {
    const support = fieldSupportForSelection([], TARGETS, KINDS)
    expect([...support.values()].every((entry) => entry.shown)).toBe(true)
  })

  it('a kind the catalog does not describe is UNKNOWN, never narrowed', () => {
    const support = fieldSupportForSelection(['s', 'x'], TARGETS, KINDS)
    expect(support.get('body')).toEqual({ field: 'body', shown: true, droppedBy: ['Kitchen speaker'] })
  })

  it('an unanswered kinds query narrows nothing (not-yet-known is not unsupported)', () => {
    const support = fieldSupportForSelection(['s'], TARGETS, undefined)
    expect([...support.values()].every((entry) => entry.shown && entry.droppedBy.length === 0)).toBe(true)
  })
})

describe('the viewer mirror keeps the declaration the hub sends', () => {
  it('parses `caps.text` instead of stripping it', () => {
    const parsed = TargetKindSchema.parse(kindOf('house-voice', SPEAKER_CAPS))
    expect(parsed.caps.text).toEqual({ title: true, body: false })
  })
})
