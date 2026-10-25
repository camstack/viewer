/**
 * The phone's MULTI-CAMERA DIGEST form model.
 *
 * Same three claims as `timelapse-form.spec.ts` — a patch is a DIFF, an
 * unfireable rule is refused at save, targets are ownership-filtered — plus the
 * one that is specific to this family:
 *
 * **THE WINDOW IS A DISCRIMINATED UNION, AND THE FORM MUST NOT FLATTEN IT.**
 * A digest window is either a SCHEDULE (weekly bands) or a rolling MOTION window
 * (`quietSeconds` + `maxWindowSeconds`), and the schema refuses anything else.
 * A form holding both sets of fields at once would let an operator switch to
 * Motion, save, switch back, and discover their bands were gone — so the form
 * carries both drafts and emits exactly the branch that is selected, leaving the
 * other one to be picked up again if they switch back before saving.
 */
import { describe, expect, it } from 'vitest'
import { NcSummaryRuleSchema, type NcSummaryRule } from '../../../data/notification-center.js'
import {
  emptySummaryForm,
  isSummaryFormValid,
  summaryAiImagesShown,
  summaryClearsFor,
  summaryMaxTilesChange,
  summaryFormProblems,
  summaryFormToInput,
  summaryFormToPatch,
  summaryRuleToForm,
  type SummaryFormState,
} from '../summary-form.js'

const SCHEDULE = {
  windows: [{ days: [1, 2, 3, 4, 5], startMinute: 1320, endMinute: 360 }],
  timezone: 'Europe/Rome',
}

const MOTION_RULE: NcSummaryRule = {
  id: 'sum1',
  name: 'Notte',
  enabled: true,
  deviceIds: [101, 102],
  window: { kind: 'motion', quietSeconds: 120, maxWindowSeconds: 3600 },
  targets: [{ targetId: 't-own' }],
  priority: 3,
  maxTiles: 9,
  createdBy: 'u1',
  createdAt: 1,
  updatedAt: 2,
}

const SCHEDULE_RULE: NcSummaryRule = {
  ...MOTION_RULE,
  id: 'sum2',
  window: { kind: 'schedule', schedule: SCHEDULE },
}

function form(overrides: Partial<SummaryFormState> = {}): SummaryFormState {
  return { ...summaryRuleToForm(MOTION_RULE), ...overrides }
}

describe('emptySummaryForm', () => {
  it('opens on a MOTION window — the one that needs no calendar', () => {
    // The operator's own description of the feature is "windows driven by
    // MOTION of the selected cameras". A blank schedule would open on a rule
    // that can never close.
    const empty = emptySummaryForm()
    expect(empty.windowKind).toBe('motion')
    expect(empty.quietSeconds).toBeGreaterThanOrEqual(30)
    expect(empty.maxWindowSeconds).toBeGreaterThan(empty.quietSeconds)
  })

  it('opens EMPTY of what only the operator can answer', () => {
    const empty = emptySummaryForm()
    expect(empty.name).toBe('')
    expect(empty.deviceIds).toEqual([])
    expect(empty.targetIds).toEqual([])
    expect(empty.schedule).toBeUndefined()
  })
})

describe('summaryRuleToForm keeps the union intact', () => {
  it('reads a motion rule', () => {
    const f = summaryRuleToForm(MOTION_RULE)
    expect(f.windowKind).toBe('motion')
    expect(f.quietSeconds).toBe(120)
    expect(f.maxWindowSeconds).toBe(3600)
    expect(f.schedule).toBeUndefined()
  })

  it('reads a schedule rule', () => {
    const f = summaryRuleToForm(SCHEDULE_RULE)
    expect(f.windowKind).toBe('schedule')
    expect(f.schedule).toEqual(SCHEDULE)
    // The motion half falls back to the defaults, so switching to Motion offers
    // a workable window rather than zeroes.
    expect(f.quietSeconds).toBeGreaterThanOrEqual(30)
  })
})

describe('what a save must not be allowed to be', () => {
  it('refuses no name, no camera, no target', () => {
    expect(summaryFormProblems(form({ name: ' ' }))).toContain('name')
    expect(summaryFormProblems(form({ deviceIds: [] }))).toContain('devices')
    expect(summaryFormProblems(form({ targetIds: [] }))).toContain('targets')
  })

  it('refuses a SCHEDULE window with no bands', () => {
    expect(summaryFormProblems(form({ windowKind: 'schedule', schedule: undefined }))).toContain(
      'window',
    )
  })

  it('refuses a motion window the schema would reject', () => {
    expect(summaryFormProblems(form({ quietSeconds: 10 }))).toContain('window')
    expect(summaryFormProblems(form({ maxWindowSeconds: 10 }))).toContain('window')
  })

  it('refuses a max window SHORTER than the quiet period', () => {
    // Not a schema bound — a cross-field one, and it is the difference between
    // a rule that closes on quiet and one the hard cap closes first, every time,
    // with whatever it happened to hold.
    expect(summaryFormProblems(form({ quietSeconds: 600, maxWindowSeconds: 300 }))).toContain(
      'window',
    )
  })

  it('accepts the round-tripped rules unchanged', () => {
    expect(summaryFormProblems(form())).toEqual([])
    expect(isSummaryFormValid(summaryRuleToForm(SCHEDULE_RULE))).toBe(true)
  })
})

describe('summaryFormToInput', () => {
  it('emits the MOTION branch and nothing of the schedule draft', () => {
    const input = summaryFormToInput(
      form({ schedule: SCHEDULE }),
      { ownTargetIds: ['t-own'], isAdmin: false },
    )
    expect(input.window).toEqual({ kind: 'motion', quietSeconds: 120, maxWindowSeconds: 3600 })
  })

  it('emits the SCHEDULE branch and nothing of the motion draft', () => {
    const input = summaryFormToInput(summaryRuleToForm(SCHEDULE_RULE), {
      ownTargetIds: ['t-own'], isAdmin: false,
    })
    expect(input.window).toEqual({ kind: 'schedule', schedule: SCHEDULE })
  })

  it('trims the name and drops targets the caller does not own', () => {
    const input = summaryFormToInput(form({ name: '  Notte  ', targetIds: ['t-own', 't-other'] }), {
      ownTargetIds: ['t-own'], isAdmin: false,
    })
    expect(input.name).toBe('Notte')
    expect(input.targets).toEqual([{ targetId: 't-own' }])
  })

  it('refuses to fake a schedule window that has no bands', () => {
    expect(() =>
      summaryFormToInput(form({ windowKind: 'schedule', schedule: undefined }), {
        ownTargetIds: ['t-own'], isAdmin: false,
      }),
    ).toThrow(/schedule/)
  })
})

describe('summaryFormToPatch — a DIFF', () => {
  it('an untouched form patches NOTHING', () => {
    expect(summaryFormToPatch(form(), MOTION_RULE, { ownTargetIds: ['t-own'], isAdmin: false })).toEqual({})
  })

  it('a rename patches the name ALONE — the tile budget and the AI section survive', () => {
    const patch = summaryFormToPatch(form({ name: 'Notte 2' }), MOTION_RULE, {
      ownTargetIds: ['t-own'], isAdmin: false,
    })
    expect(patch).toEqual({ name: 'Notte 2' })
    // The phone authors none of these; an absent key is what preserves them.
    expect('maxTiles' in patch).toBe(false)
    expect('rank' in patch).toBe(false)
    expect('filters' in patch).toBe(false)
    expect('ai' in patch).toBe(false)
  })

  it('patches the window when the KIND changes', () => {
    const patch = summaryFormToPatch(
      form({ windowKind: 'schedule', schedule: SCHEDULE }),
      MOTION_RULE,
      { ownTargetIds: ['t-own'], isAdmin: false },
    )
    expect(patch).toEqual({ window: { kind: 'schedule', schedule: SCHEDULE } })
  })

  it('patches the window when only a motion number moved', () => {
    expect(
      summaryFormToPatch(form({ quietSeconds: 300 }), MOTION_RULE, { ownTargetIds: ['t-own'], isAdmin: false }),
    ).toEqual({ window: { kind: 'motion', quietSeconds: 300, maxWindowSeconds: 3600 } })
  })

  it('does NOT patch the window when a draft of the OTHER branch changed', () => {
    // Editing the schedule draft while Motion is selected changes nothing about
    // the rule, and a patch that said otherwise would be a save the operator
    // never asked for.
    expect(
      summaryFormToPatch(form({ schedule: SCHEDULE }), MOTION_RULE, { ownTargetIds: ['t-own'], isAdmin: false }),
    ).toEqual({})
  })

  it('patches the cameras only when the SET changed', () => {
    expect(
      summaryFormToPatch(form({ deviceIds: [102, 101] }), MOTION_RULE, {
        ownTargetIds: ['t-own'], isAdmin: false,
      }),
    ).toEqual({})
    expect(
      summaryFormToPatch(form({ deviceIds: [101] }), MOTION_RULE, { ownTargetIds: ['t-own'], isAdmin: false }),
    ).toEqual({ deviceIds: [101] })
  })

  it('PRESERVES per-target params it never authored', () => {
    const withParams: NcSummaryRule = {
      ...MOTION_RULE,
      targets: [{ targetId: 't-own', params: { sound: 'siren' } }],
    }
    const patch = summaryFormToPatch(
      { ...summaryRuleToForm(withParams), targetIds: ['t-own', 't-second'] },
      withParams,
      { ownTargetIds: ['t-own', 't-second'], isAdmin: false },
    )
    expect(patch.targets).toEqual([
      { targetId: 't-own', params: { sound: 'siren' } },
      { targetId: 't-second' },
    ])
  })

  it('patches enabled and priority independently', () => {
    expect(
      summaryFormToPatch(form({ enabled: false }), MOTION_RULE, { ownTargetIds: ['t-own'], isAdmin: false }),
    ).toEqual({ enabled: false })
    expect(
      summaryFormToPatch(form({ priority: 4 }), MOTION_RULE, { ownTargetIds: ['t-own'], isAdmin: false }),
    ).toEqual({ priority: 4 })
  })
})

describe('a GLOBAL digest that also delivers to ANOTHER user\'s target (review I1)', () => {
  const SHARED: NcSummaryRule = {
    ...MOTION_RULE,
    targets: [{ targetId: 't-admin' }, { targetId: 't-user' }],
  }
  const ADMIN = { ownTargetIds: ['t-admin'], isAdmin: true }

  it('an untouched save patches nothing', () => {
    expect(summaryFormToPatch(summaryRuleToForm(SHARED), SHARED, ADMIN)).toEqual({})
  })

  it('a rename sends no targets', () => {
    expect(summaryFormToPatch({ ...summaryRuleToForm(SHARED), name: 'Notte 2' }, SHARED, ADMIN)).toEqual({
      name: 'Notte 2',
    })
  })
})


describe('a NON-admin\'s digest still naming a target he deleted (fix round 2, NB1)', () => {
  const STALE: NcSummaryRule = { ...MOTION_RULE, targets: [{ targetId: 't1' }, { targetId: 't-gone' }] }
  it('a rename drops the id he no longer has', () => {
    expect(
      summaryFormToPatch({ ...summaryRuleToForm(STALE), name: 'Notte 2' }, STALE, { ownTargetIds: ['t1'], isAdmin: false }),
    ).toEqual({ name: 'Notte 2', targets: [{ targetId: 't1' }] })
  })
})

// ── Full parity (Plan D, Task 13) ───────────────────────────────────────────

/** A digest rule carrying EVERY field the addon stores. */
const FULL_RULE: NcSummaryRule = {
  ...MOTION_RULE,
  id: 'sum-full',
  filters: {
    classes: ['person', 'vehicle'],
    classesExclude: ['animal'],
    zones: ['z-drive'],
    minImportance: 0.4,
    minDwellSeconds: 5,
    includeStationary: true,
  },
  maxTiles: 16,
  maxAiImages: 4,
  rank: 'dwell',
  barrierSeconds: 300,
  template: { title: 'Riepilogo {{rule}}', body: '{{count}} passaggi' },
  captions: 'all',
  captionText: '{{rule}} {{from}}→{{to}}',
  deliverEmpty: true,
  priority: 4,
  ai: {
    enabled: true,
    profileId: 'p-vision',
    prompt: 'Cosa è successo?',
    language: 'it',
    maxImagePx: 512,
    timeoutMs: 120_000,
    onFailure: 'skip',
  },
}
const OWN = { ownTargetIds: ['t-own'], isAdmin: false }

describe('full parity — the form reads and writes every field', () => {
  it('a round-trip is IDENTICAL: the input rebuilt from the form is the rule', () => {
    const {
      id: _id,
      createdBy: _cb,
      createdAt: _ca,
      updatedAt: _ua,
      generatedAt: _g,
      ownerUserId: _o,
      ...authored
    } = FULL_RULE
    expect(summaryFormToInput(summaryRuleToForm(FULL_RULE), OWN)).toEqual(authored)
  })

  it('an untouched full rule patches NOTHING and clears nothing', () => {
    const form = summaryRuleToForm(FULL_RULE)
    expect(summaryFormToPatch(form, FULL_RULE, OWN)).toEqual({})
    expect(summaryClearsFor(form, FULL_RULE)).toEqual([])
  })

  it('a form that never touched maxTiles (or any defaulted field) does not emit it', () => {
    const input = summaryFormToInput(
      { ...emptySummaryForm(), name: 'N', deviceIds: [101], targetIds: ['t-own'] },
      OWN,
    )
    expect(Object.keys(input).sort()).toEqual(
      ['deviceIds', 'enabled', 'name', 'priority', 'targets', 'window'].sort(),
    )
  })

  it('a rule from an older hub that stores no maxTiles stays that way on an untouched save', () => {
    const { maxTiles: _m, ...bare } = MOTION_RULE
    expect(summaryFormToPatch(summaryRuleToForm(bare), bare, OWN)).toEqual({})
  })

  it('a rule stored with the retired `subject: groups` (D680) opens, and saves without a subject', () => {
    const wire = NcSummaryRuleSchema.parse({ ...FULL_RULE, subject: 'groups' })
    const form = summaryRuleToForm(wire)
    expect(form).not.toHaveProperty('subject')
    expect(summaryFormToPatch(form, wire, OWN)).toEqual({})
    const edited = summaryFormToPatch({ ...form, maxTiles: 20 }, wire, OWN)
    expect(edited).toEqual({ maxTiles: 20 })
  })

  it('patches exactly the scalar that changed', () => {
    const base = summaryRuleToForm(FULL_RULE)
    expect(summaryFormToPatch({ ...base, maxTiles: 20 }, FULL_RULE, OWN)).toEqual({ maxTiles: 20 })
    expect(summaryFormToPatch({ ...base, maxAiImages: 2 }, FULL_RULE, OWN)).toEqual({ maxAiImages: 2 })
    expect(summaryFormToPatch({ ...base, rank: 'recency' }, FULL_RULE, OWN)).toEqual({ rank: 'recency' })
    expect(summaryFormToPatch({ ...base, barrierSeconds: 60 }, FULL_RULE, OWN)).toEqual({ barrierSeconds: 60 })
    expect(summaryFormToPatch({ ...base, captions: 'none' }, FULL_RULE, OWN)).toEqual({ captions: 'none' })
    expect(summaryFormToPatch({ ...base, deliverEmpty: false }, FULL_RULE, OWN)).toEqual({ deliverEmpty: false })
    expect(summaryFormToPatch({ ...base, captionText: 'Notte' }, FULL_RULE, OWN)).toEqual({ captionText: 'Notte' })
  })

  it('a filter change sends the WHOLE filter section (the hub replaces it)', () => {
    const base = summaryRuleToForm(FULL_RULE)
    expect(summaryFormToPatch({ ...base, minImportance: 0.6 }, FULL_RULE, OWN)).toEqual({
      filters: { ...FULL_RULE.filters, minImportance: 0.6 },
    })
  })

  it('a filter section emptied is a CLEAR (null), not an omission', () => {
    const emptied: SummaryFormState = {
      ...summaryRuleToForm(FULL_RULE),
      classes: [],
      classesExclude: [],
      zones: [],
      minImportance: undefined,
      minDwellSeconds: undefined,
      includeStationary: false,
    }
    expect(summaryFormToPatch(emptied, FULL_RULE, OWN)).toEqual({ filters: null })
  })

  it('an emptied template is a CLEAR (null); a changed one is sent whole, trimmed', () => {
    const base = summaryRuleToForm(FULL_RULE)
    expect(summaryFormToPatch({ ...base, template: { title: ' ', body: '' } }, FULL_RULE, OWN)).toEqual({
      template: null,
    })
    expect(summaryFormToPatch({ ...base, template: { title: ' Nuovo ', body: '' } }, FULL_RULE, OWN)).toEqual({
      template: { title: 'Nuovo' },
    })
  })

  it('the AI section: a changed field sends it whole, and switching off an otherwise empty one clears it', () => {
    const base = summaryRuleToForm(FULL_RULE)
    expect(summaryFormToPatch({ ...base, aiPrompt: 'Altro?' }, FULL_RULE, OWN)).toEqual({
      ai: { ...FULL_RULE.ai, prompt: 'Altro?' },
    })
    const off: SummaryFormState = {
      ...base,
      aiEnabled: false,
      aiProfileId: undefined,
      aiPrompt: '',
      aiLanguage: undefined,
      aiMaxImagePx: undefined,
      aiTimeoutSeconds: undefined,
      aiOnFailure: undefined,
    }
    expect(summaryFormToPatch(off, FULL_RULE, OWN)).toEqual({ ai: null })
    // Switching OFF but keeping the prompt keeps the section, paused.
    expect(summaryFormToPatch({ ...base, aiEnabled: false }, FULL_RULE, OWN)).toEqual({
      ai: { ...FULL_RULE.ai, enabled: false },
    })
  })

  it('the AI time limit is seconds in the form and milliseconds on the wire', () => {
    const base = summaryRuleToForm(FULL_RULE)
    expect(base.aiTimeoutSeconds).toBe(120)
    expect(summaryFormToPatch({ ...base, aiTimeoutSeconds: 90 }, FULL_RULE, OWN).ai?.timeoutMs).toBe(90_000)
  })
})

describe('summaryClearsFor — the caption the patch cannot remove', () => {
  it('an EMPTIED caption goes to clear, never into the patch', () => {
    const form = { ...summaryRuleToForm(FULL_RULE), captionText: '  ' }
    expect(summaryClearsFor(form, FULL_RULE)).toEqual(['captionText'])
    expect('captionText' in summaryFormToPatch(form, FULL_RULE, OWN)).toBe(false)
  })

  it('a stored "no caption" (\'\') is left alone — the phone never turns it into the default', () => {
    const noCaption: NcSummaryRule = { ...FULL_RULE, captionText: '' }
    const form = summaryRuleToForm(noCaption)
    expect(summaryClearsFor(form, noCaption)).toEqual([])
    expect(summaryFormToPatch(form, noCaption, OWN)).toEqual({})
  })

  it('whitespace stored by the desktop is not an edit', () => {
    const padded: NcSummaryRule = { ...FULL_RULE, captionText: '  Notte  ', name: ' Notte ' }
    expect(summaryFormToPatch(summaryRuleToForm(padded), padded, OWN)).toEqual({})
  })
})

describe('what a full-parity save must refuse', () => {
  const valid = summaryRuleToForm(FULL_RULE)
  it('accepts the full rule', () => {
    expect(summaryFormProblems(valid)).toEqual([])
  })
  it('refuses more AI images than tiles — the hub\'s own assertSummaryBudget', () => {
    expect(summaryFormProblems({ ...valid, maxTiles: 3, maxAiImages: 4 })).toContain('budget')
    // An untouched AI budget on a new rule is the hub default (6): 4 tiles is too few.
    expect(summaryFormProblems({ ...valid, maxTiles: 4, maxAiImages: undefined })).toContain('budget')
  })
  it('refuses a filter set no track can pass, and out-of-range numbers', () => {
    expect(summaryFormProblems({ ...valid, classes: ['person'], classesExclude: ['person'] })).toContain('filters')
    expect(summaryFormProblems({ ...valid, minImportance: 1.5 })).toContain('filters')
    expect(summaryFormProblems({ ...valid, minDwellSeconds: 4000 })).toContain('filters')
  })
  it('refuses a caption, template or AI field over the hub\'s bound', () => {
    expect(summaryFormProblems({ ...valid, captionText: 'x'.repeat(201) })).toContain('caption')
    expect(summaryFormProblems({ ...valid, template: { title: 'x'.repeat(501), body: '' } })).toContain('template')
    expect(summaryFormProblems({ ...valid, aiPrompt: 'x'.repeat(2001) })).toContain('ai')
    expect(summaryFormProblems({ ...valid, aiTimeoutSeconds: 5 })).toContain('ai')
    expect(summaryFormProblems({ ...valid, aiMaxImagePx: 32 })).toContain('ai')
  })
})

describe('the AI-images budget follows the tile count (review m3)', () => {
  const fresh = emptySummaryForm()
  it('the untouched AI default is SHOWN clamped to the tiles', () => {
    expect(summaryAiImagesShown({ ...fresh, maxTiles: 4 })).toBe(4)
    expect(summaryAiImagesShown(fresh)).toBe(6)
    expect(summaryAiImagesShown({ ...fresh, maxTiles: 20, maxAiImages: 8 })).toBe(8)
  })

  it('lowering the tiles below the AI budget lowers the AI budget with it', () => {
    expect(summaryMaxTilesChange(fresh, 4)).toEqual({ maxTiles: 4, maxAiImages: 4 })
    expect(summaryMaxTilesChange({ ...fresh, maxAiImages: 3 }, 4)).toEqual({ maxTiles: 4 })
  })

  it('raising the tiles leaves an untouched AI budget untouched', () => {
    expect(summaryMaxTilesChange(fresh, 10)).toEqual({ maxTiles: 10 })
  })

  it('the clamped form saves — no budget problem', () => {
    const next = { ...fresh, ...summaryMaxTilesChange(fresh, 4) }
    expect(summaryFormProblems(next)).not.toContain('budget')
  })
})
