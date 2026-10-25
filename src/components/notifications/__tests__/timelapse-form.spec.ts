/**
 * The phone's SCHEDULED-TIMELAPSE form model.
 *
 * Three things are asserted, and each of them is a way the feature fails
 * silently rather than loudly:
 *
 *  1. **A patch is a DIFF, and an emptied field is a CLEAR.** The phone now
 *     authors every field the admin does (the operator's 2026-09-24 decision
 *     for full parity), but the hub MERGES a patch, so a patch that re-sent
 *     every field would still retune a rule nobody touched on the phone, and an
 *     emptied optional field must travel as `clear` or it silently comes back.
 *  2. **A rule that cannot fire is refused at SAVE.** A timelapse is DEFINED by
 *     its window boundaries, so an absent schedule is not "always on" the way it
 *     is for a detection rule — it is a rule that will never open, never close
 *     and never produce anything, and nobody is present at 06:05 to be told.
 *  3. **Ownership.** A personal rule delivers only to targets the caller owns.
 *     The server re-validates; the form drops them first so the operator never
 *     sees a refusal for a target the picker should not have offered.
 */
import { describe, expect, it } from 'vitest'
import type { TimelapseRule } from '@camstack/types'
import {
  emptyTimelapseForm,
  isTimelapseFormValid,
  timelapseFormProblems,
  timelapseFormToInput,
  timelapseClearsFor,
  timelapseDerivedDenseCadence,
  timelapseFormToPatch,
  timelapseRuleToForm,
  type TimelapseFormState,
} from '../timelapse-form.js'

const SCHEDULE = {
  windows: [{ days: [0, 1, 2, 3, 4, 5, 6], startMinute: 1320, endMinute: 360 }],
  timezone: 'Europe/Rome',
}

const RULE: TimelapseRule = {
  id: 'tl1',
  name: 'Notte retro',
  enabled: true,
  deviceIds: [101, 102],
  schedule: SCHEDULE,
  cadenceSec: 15,
  framerate: 10,
  denseCadenceSec: 0.5,
  minDwellSec: 1,
  template: { title: 'Notte {{camera}}', body: '{{detectionSummary}}' },
  previewText: 'Timelapse {{camera}} {{from}}',
  reportClasses: ['person', 'vehicle'],
  previewMode: 'gif',
  targets: [{ targetId: 't-own' }],
  priority: 3,
  createdBy: 'u1',
  createdAt: 1,
  updatedAt: 2,
}

function form(overrides: Partial<TimelapseFormState> = {}): TimelapseFormState {
  return { ...timelapseRuleToForm(RULE), ...overrides }
}

describe('emptyTimelapseForm', () => {
  it('opens on the schema defaults, so the first save is a valid rule', () => {
    const empty = emptyTimelapseForm()
    expect(empty.cadenceSec).toBe(15)
    expect(empty.framerate).toBe(10)
    expect(empty.enabled).toBe(true)
    expect(empty.previewMode).toBe('image')
  })

  it('opens EMPTY of the four things only the operator can answer', () => {
    const empty = emptyTimelapseForm()
    expect(empty.name).toBe('')
    expect(empty.deviceIds).toEqual([])
    expect(empty.targetIds).toEqual([])
    expect(empty.schedule).toBeUndefined()
  })
})

describe('timelapseRuleToForm', () => {
  it('reads back exactly what the phone authors', () => {
    const f = timelapseRuleToForm(RULE)
    expect(f.name).toBe('Notte retro')
    expect(f.deviceIds).toEqual([101, 102])
    expect(f.schedule).toEqual(SCHEDULE)
    expect(f.cadenceSec).toBe(15)
    expect(f.framerate).toBe(10)
    expect(f.previewMode).toBe('gif')
    expect(f.targetIds).toEqual(['t-own'])
    expect(f.denseCadenceSec).toBe(0.5)
    expect(f.minDwellSec).toBe(1)
    expect(f.template).toEqual({ title: 'Notte {{camera}}', body: '{{detectionSummary}}' })
    expect(f.previewText).toBe('Timelapse {{camera}} {{from}}')
    expect(f.reportClasses).toEqual(['person', 'vehicle'])
  })

  it('reads an absent optional field as the EMPTY control, never as a value', () => {
    const bare: TimelapseRule = {
      ...RULE,
      denseCadenceSec: undefined,
      minDwellSec: undefined,
      template: undefined,
      previewText: undefined,
      reportClasses: undefined,
    }
    const f = timelapseRuleToForm(bare)
    expect(f.denseCadenceSec).toBeUndefined()
    expect(f.minDwellSec).toBeUndefined()
    expect(f.template).toEqual({ title: '', body: '' })
    expect(f.previewText).toBe('')
    expect(f.reportClasses).toEqual([])
  })
})

describe('round trip — rule → form → input loses nothing', () => {
  it('a rule carrying EVERY field comes back as the same input', () => {
    const input = timelapseFormToInput(timelapseRuleToForm(RULE), { ownTargetIds: ['t-own'], isAdmin: false })
    expect(input).toEqual({
      name: RULE.name,
      enabled: RULE.enabled,
      deviceIds: RULE.deviceIds,
      schedule: RULE.schedule,
      cadenceSec: RULE.cadenceSec,
      framerate: RULE.framerate,
      denseCadenceSec: RULE.denseCadenceSec,
      minDwellSec: RULE.minDwellSec,
      template: RULE.template,
      previewText: RULE.previewText,
      previewMode: RULE.previewMode,
      reportClasses: RULE.reportClasses,
      priority: RULE.priority,
      targets: RULE.targets,
    })
  })

  it('an untouched full rule patches nothing and clears nothing', () => {
    expect(timelapseFormToPatch(form(), RULE, { ownTargetIds: ['t-own'], isAdmin: false })).toEqual({})
    expect(timelapseClearsFor(form(), RULE)).toEqual([])
  })
})

describe('what a save must not be allowed to be', () => {
  it('refuses a rule with no SCHEDULE — the boundaries ARE the rule', () => {
    // Unlike an `NcRule`, where an absent schedule means "always active".
    expect(timelapseFormProblems(form({ schedule: undefined }))).toContain('schedule')
    expect(isTimelapseFormValid(form({ schedule: undefined }))).toBe(false)
  })

  it('refuses no name, no camera, no target', () => {
    expect(timelapseFormProblems(form({ name: '   ' }))).toContain('name')
    expect(timelapseFormProblems(form({ deviceIds: [] }))).toContain('devices')
    expect(timelapseFormProblems(form({ targetIds: [] }))).toContain('targets')
  })

  it('refuses a cadence or a framerate the schema would reject', () => {
    // Refused HERE and not by the server round-trip: the bounds are the
    // schema's own, and a stepper that can walk past them is a stepper that
    // produces a save the operator cannot explain.
    expect(timelapseFormProblems(form({ cadenceSec: 1 }))).toContain('cadence')
    expect(timelapseFormProblems(form({ cadenceSec: 4000 }))).toContain('cadence')
    expect(timelapseFormProblems(form({ framerate: 0 }))).toContain('framerate')
    expect(timelapseFormProblems(form({ framerate: 61 }))).toContain('framerate')
  })

  it('refuses a dense cadence that is not DENSER than the base, or below the floor', () => {
    // The hub refuses the pair at upsert; the form says so beside the field.
    expect(timelapseFormProblems(form({ cadenceSec: 15, denseCadenceSec: 15 }))).toContain('denseCadence')
    expect(timelapseFormProblems(form({ cadenceSec: 15, denseCadenceSec: 20 }))).toContain('denseCadence')
    expect(timelapseFormProblems(form({ denseCadenceSec: 0.05 }))).toContain('denseCadence')
    expect(timelapseFormProblems(form({ denseCadenceSec: 0.1 }))).not.toContain('denseCadence')
    // Absent is "derive it" — never a problem.
    expect(timelapseFormProblems(form({ denseCadenceSec: undefined }))).not.toContain('denseCadence')
  })

  it('refuses a minimum dwell outside the schema bounds', () => {
    expect(timelapseFormProblems(form({ minDwellSec: 61 }))).toContain('minDwell')
    expect(timelapseFormProblems(form({ minDwellSec: -1 }))).toContain('minDwell')
    expect(timelapseFormProblems(form({ minDwellSec: 0 }))).not.toContain('minDwell')
  })

  it('refuses message fields longer than the schema takes', () => {
    expect(timelapseFormProblems(form({ previewText: 'x'.repeat(201) }))).toContain('previewText')
    expect(
      timelapseFormProblems(form({ template: { title: 'x'.repeat(501), body: '' } })),
    ).toContain('template')
    expect(
      timelapseFormProblems(form({ template: { title: '', body: 'x'.repeat(2001) } })),
    ).toContain('template')
    expect(
      timelapseFormProblems(form({ reportClasses: Array.from({ length: 21 }, (_, i) => `c${i}`) })),
    ).toContain('reportClasses')
  })

  it('accepts the round-tripped rule unchanged', () => {
    expect(timelapseFormProblems(form())).toEqual([])
    expect(isTimelapseFormValid(form())).toBe(true)
  })
})

describe('timelapseFormToInput', () => {
  it('an EMPTY optional field is ABSENT, so the hub default applies', () => {
    const input = timelapseFormToInput(
      form({
        denseCadenceSec: undefined,
        minDwellSec: undefined,
        template: { title: '  ', body: '' },
        previewText: '   ',
        reportClasses: [],
      }),
      { ownTargetIds: ['t-own'], isAdmin: false },
    )
    expect(input.name).toBe('Notte retro')
    expect(input.targets).toEqual([{ targetId: 't-own' }])
    // An empty caption is absent — `DEFAULT_TIMELAPSE_PREVIEW_TEXT` applies.
    expect('previewText' in input).toBe(false)
    // An empty class list is absent — "every class the window contained".
    expect('reportClasses' in input).toBe(false)
    expect('template' in input).toBe(false)
    expect('denseCadenceSec' in input).toBe(false)
    expect('minDwellSec' in input).toBe(false)
  })

  it('sends only the template half that was written, trimmed', () => {
    const input = timelapseFormToInput(form({ template: { title: ' Notte ', body: '' } }), {
      ownTargetIds: ['t-own'], isAdmin: false,
    })
    expect(input.template).toEqual({ title: 'Notte' })
  })

  it('trims the name — a rule called " " is a rule with no name in the list', () => {
    expect(timelapseFormToInput(form({ name: '  Notte  ' }), { ownTargetIds: ['t-own'], isAdmin: false }).name).toBe(
      'Notte',
    )
  })

  it('drops a target the caller does not own', () => {
    const input = timelapseFormToInput(form({ targetIds: ['t-own', 't-other'] }), {
      ownTargetIds: ['t-own'], isAdmin: false,
    })
    expect(input.targets).toEqual([{ targetId: 't-own' }])
  })

  it('refuses to build an input from a form with no schedule', () => {
    // `isTimelapseFormValid` gates the button; this is the second lock, because
    // a `TimelapseRuleInput` without a schedule does not typecheck as one and
    // must not be faked into existence.
    expect(() => timelapseFormToInput(form({ schedule: undefined }), { ownTargetIds: [], isAdmin: false })).toThrow(
      /schedule/,
    )
  })
})

describe('timelapseFormToPatch — a DIFF, and the reason the phone can be simpler', () => {
  it('an untouched form patches NOTHING', () => {
    expect(timelapseFormToPatch(form(), RULE, { ownTargetIds: ['t-own'], isAdmin: false })).toEqual({})
  })

  it('a rename patches the name ALONE', () => {
    const patch = timelapseFormToPatch(form({ name: 'Notte 2' }), RULE, {
      ownTargetIds: ['t-own'], isAdmin: false,
    })
    expect(patch).toEqual({ name: 'Notte 2' })
    // The four desktop-only fields are not in the patch, so the merge leaves
    // them exactly as they were. That is the whole claim.
    expect('denseCadenceSec' in patch).toBe(false)
    expect('minDwellSec' in patch).toBe(false)
    expect('previewText' in patch).toBe(false)
    expect('reportClasses' in patch).toBe(false)
    // …and it does not re-send the cameras, so a rename still works on a rule
    // whose camera has since stopped recording (the server re-checks ADDED
    // cameras only, and an unchanged list adds none).
    expect('deviceIds' in patch).toBe(false)
  })

  it('patches the cameras only when they actually changed', () => {
    expect(timelapseFormToPatch(form({ deviceIds: [102, 101] }), RULE, {
      ownTargetIds: ['t-own'], isAdmin: false,
    })).toEqual({})
    expect(
      timelapseFormToPatch(form({ deviceIds: [101] }), RULE, { ownTargetIds: ['t-own'], isAdmin: false }),
    ).toEqual({ deviceIds: [101] })
  })

  it('patches the schedule when a window moved', () => {
    const moved = {
      windows: [{ days: [0, 1, 2, 3, 4, 5, 6], startMinute: 1260, endMinute: 360 }],
      timezone: 'Europe/Rome',
    }
    expect(timelapseFormToPatch(form({ schedule: moved }), RULE, { ownTargetIds: ['t-own'], isAdmin: false })).toEqual(
      { schedule: moved },
    )
  })

  it('patches the targets when the selection changed, ownership-filtered', () => {
    const patch = timelapseFormToPatch(form({ targetIds: ['t-own', 't-other'] }), RULE, {
      ownTargetIds: ['t-own', 't-second'], isAdmin: false,
    })
    // `t-other` is filtered out, which leaves exactly the stored selection —
    // so there is nothing to patch, and the form must not send a no-op that
    // re-runs the server's ownership check.
    expect(patch).toEqual({})
    expect(
      timelapseFormToPatch(form({ targetIds: ['t-own', 't-second'] }), RULE, {
        ownTargetIds: ['t-own', 't-second'], isAdmin: false,
      }),
    ).toEqual({ targets: [{ targetId: 't-own' }, { targetId: 't-second' }] })
  })

  it('PRESERVES per-target params it never authored', () => {
    // A target can carry backend passthrough (`priority`, `sound`, …) that this
    // form has no control for. Re-sending the target as a bare `{ targetId }`
    // would erase it.
    const withParams: TimelapseRule = {
      ...RULE,
      targets: [{ targetId: 't-own', params: { sound: 'siren' } }],
    }
    const patch = timelapseFormToPatch(
      { ...timelapseRuleToForm(withParams), targetIds: ['t-own', 't-second'] },
      withParams,
      { ownTargetIds: ['t-own', 't-second'], isAdmin: false },
    )
    expect(patch.targets).toEqual([
      { targetId: 't-own', params: { sound: 'siren' } },
      { targetId: 't-second' },
    ])
  })

  it('patches enabled, cadence, framerate and preview mode independently', () => {
    expect(timelapseFormToPatch(form({ enabled: false }), RULE, { ownTargetIds: ['t-own'], isAdmin: false })).toEqual(
      { enabled: false },
    )
    expect(timelapseFormToPatch(form({ cadenceSec: 30 }), RULE, { ownTargetIds: ['t-own'], isAdmin: false })).toEqual(
      { cadenceSec: 30 },
    )
    expect(timelapseFormToPatch(form({ framerate: 12 }), RULE, { ownTargetIds: ['t-own'], isAdmin: false })).toEqual(
      { framerate: 12 },
    )
    expect(
      timelapseFormToPatch(form({ previewMode: 'image' }), RULE, { ownTargetIds: ['t-own'], isAdmin: false }),
    ).toEqual({ previewMode: 'image' })
  })

  it('patches each message and sampling field when it changed', () => {
    const own = { ownTargetIds: ['t-own'], isAdmin: false }
    expect(timelapseFormToPatch(form({ denseCadenceSec: 2 }), RULE, own)).toEqual({ denseCadenceSec: 2 })
    expect(timelapseFormToPatch(form({ minDwellSec: 3 }), RULE, own)).toEqual({ minDwellSec: 3 })
    expect(timelapseFormToPatch(form({ previewText: 'Notte' }), RULE, own)).toEqual({ previewText: 'Notte' })
    expect(timelapseFormToPatch(form({ reportClasses: ['person'] }), RULE, own)).toEqual({
      reportClasses: ['person'],
    })
    expect(
      timelapseFormToPatch(form({ template: { title: 'Altro', body: '{{detectionSummary}}' } }), RULE, own),
    ).toEqual({ template: { title: 'Altro', body: '{{detectionSummary}}' } })
  })

  it('an EMPTIED field is not in the patch — it travels as a clear', () => {
    const emptied = form({
      denseCadenceSec: undefined,
      minDwellSec: undefined,
      template: { title: '', body: '' },
      previewText: '',
      reportClasses: [],
    })
    expect(timelapseFormToPatch(emptied, RULE, { ownTargetIds: ['t-own'], isAdmin: false })).toEqual({})
  })
})

describe('timelapseClearsFor — the hub MERGES, so an emptied field must be named', () => {
  it('names every optional field the operator emptied', () => {
    const emptied = form({
      denseCadenceSec: undefined,
      minDwellSec: undefined,
      template: { title: ' ', body: '' },
      previewText: '',
      reportClasses: [],
    })
    expect([...timelapseClearsFor(emptied, RULE)].sort()).toEqual(
      ['denseCadenceSec', 'minDwellSec', 'previewText', 'reportClasses', 'template'].sort(),
    )
  })

  it('names nothing the stored rule never said — a clear of an absent key is noise', () => {
    const bare: TimelapseRule = {
      ...RULE,
      denseCadenceSec: undefined,
      minDwellSec: undefined,
      template: undefined,
      previewText: undefined,
      reportClasses: [],
    }
    expect(timelapseClearsFor(timelapseRuleToForm(bare), bare)).toEqual([])
  })

  it('leaves an authored EMPTY caption alone — the phone reads it as blank and re-saves nothing', () => {
    // `previewText: ''` is the desktop's "frame, no caption". The phone shows it
    // blank; clearing it would silently turn it into the default caption.
    const noCaption: TimelapseRule = { ...RULE, previewText: '' }
    expect(timelapseClearsFor(timelapseRuleToForm(noCaption), noCaption)).toEqual([])
    expect(timelapseFormToPatch(timelapseRuleToForm(noCaption), noCaption, { ownTargetIds: ['t-own'], isAdmin: false })).toEqual({})
  })

  it('a field still set is never cleared', () => {
    expect(timelapseClearsFor(form({ previewText: 'Altro' }), RULE)).toEqual([])
  })
})

describe('a GLOBAL rule that also delivers to ANOTHER user\'s target (review I1)', () => {
  // The admin's picker lists only his targets; `t-user` is invisible to him and
  // not his to delete.
  const SHARED: TimelapseRule = {
    ...RULE,
    targets: [{ targetId: 't-admin' }, { targetId: 't-user', params: { sound: 'siren' } }],
  }
  const ADMIN = { ownTargetIds: ['t-admin'], isAdmin: true }

  it('an untouched save patches nothing', () => {
    expect(timelapseFormToPatch(timelapseRuleToForm(SHARED), SHARED, ADMIN)).toEqual({})
  })

  it('a rename sends no targets', () => {
    const patch = timelapseFormToPatch({ ...timelapseRuleToForm(SHARED), name: 'Rinominata' }, SHARED, ADMIN)
    expect(patch).toEqual({ name: 'Rinominata' })
  })

  it('adding his own target keeps the foreign one', () => {
    const patch = timelapseFormToPatch(
      { ...timelapseRuleToForm(SHARED), targetIds: ['t-admin', 't-user', 't-second'] },
      SHARED,
      { ownTargetIds: ['t-admin', 't-second'], isAdmin: true },
    )
    expect(patch.targets).toEqual([...SHARED.targets, { targetId: 't-second' }])
  })
})

describe('whitespace the desktop stored is not an edit (review M1)', () => {
  it('an untouched caption or name with surrounding spaces patches nothing', () => {
    const spaced: TimelapseRule = { ...RULE, name: ' Notte retro ', previewText: '  Notte {{camera}} ' }
    expect(timelapseFormToPatch(timelapseRuleToForm(spaced), spaced, { ownTargetIds: ['t-own'], isAdmin: false })).toEqual({})
    expect(timelapseClearsFor(timelapseRuleToForm(spaced), spaced)).toEqual([])
  })
})

describe('timelapseDerivedDenseCadence — where "auto" starts when the operator pins it (review M6)', () => {
  it('is the hub derivation: a thirtieth of the base, at least 1 s', () => {
    expect(timelapseDerivedDenseCadence(15)).toBe(1)
    expect(timelapseDerivedDenseCadence(60)).toBe(2)
    expect(timelapseDerivedDenseCadence(90)).toBe(3)
    expect(timelapseDerivedDenseCadence(45)).toBe(1.5)
  })
})



describe('a NON-admin\'s rule still naming a target he deleted (fix round 2, NB1)', () => {
  // The hub refuses a non-admin save carrying a target he does not own, and
  // `nc.deleteMyTarget` leaves the id on his rules — keeping it would make
  // every save of this rule fail, a rename included.
  const STALE: TimelapseRule = { ...RULE, targets: [{ targetId: 't1' }, { targetId: 't-gone' }] }
  it('a rename drops the id he no longer has', () => {
    const patch = timelapseFormToPatch({ ...timelapseRuleToForm(STALE), name: 'Rinominata' }, STALE, {
      ownTargetIds: ['t1'],
      isAdmin: false,
    })
    expect(patch).toEqual({ name: 'Rinominata', targets: [{ targetId: 't1' }] })
  })
})
