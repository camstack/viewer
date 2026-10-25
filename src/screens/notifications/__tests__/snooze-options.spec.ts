import { describe, it, expect } from 'vitest'
import enLocale from '../../../../locales/en.json'
import itLocale from '../../../../locales/it.json'
import {
  NC_SNOOZE_MAX_MINUTES,
  NC_DEFAULT_SNOOZE_MINUTES,
  NC_SNOOZE_OPTIONS_MAX,
  NcSnoozeInputSchema,
  NcSnoozeSchema,
  type NcSnooze,
  type NcTaxonomy,
} from '../../../data/notification-center.js'
import {
  SNOOZE_DURATIONS,
  buildSnoozeInput,
  canOfferGlobal,
  isActive,
  isOfferableDuration,
  isSnoozeTargetComplete,
  minutesRemaining,
  remainingLabel,
  scopeLabelKey,
  snoozeClassOptions,
  sortSnoozes,
  snoozeMinuteLabel,
  toggleSnoozeMinute,
  snoozeToggleRefused,
  NC_SNOOZE_BUTTON_CHOICES,
  type SnoozeDraft,
} from '../snooze-options.js'

const NOW = 1_800_000_000_000
const MIN = 60_000

function snooze(overrides: Partial<NcSnooze> = {}): NcSnooze {
  return {
    id: 's1',
    userId: 'alice',
    scope: 'rule',
    ruleId: 'r1',
    startedAt: NOW - 10 * MIN,
    expiresAt: NOW + 50 * MIN,
    global: false,
    summary: true,
    ...overrides,
  }
}

function lookup(tree: unknown, key: string): string {
  const value = key.split('.').reduce<unknown>((node, part) => {
    if (node != null && typeof node === 'object' && part in node) {
      return (node as Record<string, unknown>)[part]
    }
    return undefined
  }, tree)
  if (typeof value !== 'string') throw new Error(`missing i18n key: ${key}`)
  return value
}

describe('snooze durations', () => {
  it('never offers a window the hub would refuse', () => {
    // The panel and the schema's 24h ceiling must not drift apart.
    for (const d of SNOOZE_DURATIONS) expect(isOfferableDuration(d.minutes)).toBe(true)
    expect(isOfferableDuration(NC_SNOOZE_MAX_MINUTES + 1)).toBe(false)
    expect(isOfferableDuration(0)).toBe(false)
    expect(isOfferableDuration(1.5)).toBe(false)
  })

  it('leads with the short ones — the common case is a few minutes', () => {
    expect(SNOOZE_DURATIONS[0].minutes).toBe(10)
    expect(SNOOZE_DURATIONS.map((d) => d.minutes)).toEqual(
      [...SNOOZE_DURATIONS.map((d) => d.minutes)].toSorted((a, b) => a - b),
    )
  })

  it('offers exactly what a notification’s snooze buttons offer', () => {
    // The panel's presets ARE the hub's fallback list, in the hub's order.
    // Drift here is drift between a push button and the screen behind it —
    // two vocabularies for one act, which reads as two features.
    expect(SNOOZE_DURATIONS.map((d) => d.minutes)).toEqual([...NC_DEFAULT_SNOOZE_MINUTES])
  })

  it('has every duration label in both locales', () => {
    for (const d of SNOOZE_DURATIONS) {
      expect(lookup(enLocale, `v2.nc.snooze.durations.${d.labelKey}`)).toBeTruthy()
      expect(lookup(itLocale, `v2.nc.snooze.durations.${d.labelKey}`)).toBeTruthy()
    }
  })

  it('has a label for every scope, in both locales', () => {
    for (const scope of ['rule', 'device', 'all'] as const) {
      expect(lookup(enLocale, scopeLabelKey(scope))).toBeTruthy()
      expect(lookup(itLocale, scopeLabelKey(scope))).toBeTruthy()
    }
  })
})

describe('a live window', () => {
  it('is over the instant the clock passes it — nothing has to run', () => {
    expect(isActive(snooze(), NOW)).toBe(true)
    expect(isActive(snooze({ expiresAt: NOW }), NOW)).toBe(false)
    expect(isActive(snooze({ startedAt: NOW + MIN }), NOW)).toBe(false)
  })

  it('never counts down past zero', () => {
    expect(minutesRemaining(snooze({ expiresAt: NOW - 10 * MIN }), NOW)).toBe(0)
    expect(minutesRemaining(snooze({ expiresAt: NOW + 5 * MIN }), NOW)).toBe(5)
  })

  it('says how long is left in the coarsest honest unit', () => {
    expect(remainingLabel(snooze({ expiresAt: NOW + 4 * MIN }), NOW)).toEqual({
      key: 'minutes',
      params: { minutes: 4 },
    })
    expect(remainingLabel(snooze({ expiresAt: NOW + 120 * MIN }), NOW)).toEqual({
      key: 'hours',
      params: { hours: 2 },
    })
    expect(remainingLabel(snooze({ expiresAt: NOW + 95 * MIN }), NOW)).toEqual({
      key: 'hoursMinutes',
      params: { hours: 1, minutes: 35 },
    })
    expect(remainingLabel(snooze({ expiresAt: NOW - MIN }), NOW)).toEqual({
      key: 'ended',
      params: {},
    })
  })

  it('has every remaining-label string in both locales', () => {
    for (const key of ['ended', 'minutes', 'hours', 'hoursMinutes']) {
      expect(lookup(enLocale, `v2.nc.snooze.remaining.${key}`)).toBeTruthy()
      expect(lookup(itLocale, `v2.nc.snooze.remaining.${key}`)).toBeTruthy()
    }
  })

  it('puts what is silencing you NOW at the top', () => {
    const past = snooze({ id: 'past', startedAt: NOW - 100 * MIN, expiresAt: NOW - 40 * MIN })
    const live = snooze({ id: 'live' })
    expect(sortSnoozes([past, live], NOW).map((s) => s.id)).toEqual(['live', 'past'])
  })
})

describe('what the panel may OFFER', () => {
  // The hub re-checks all of this. Getting it wrong here can only produce a
  // rejected request — never an unauthorised silence.
  it('offers a global window only on a rule that opted in', () => {
    expect(canOfferGlobal({ scope: 'rule', ruleAllowsGlobal: true, isAdmin: false })).toBe(true)
    expect(canOfferGlobal({ scope: 'rule', ruleAllowsGlobal: false, isAdmin: false })).toBe(false)
    expect(canOfferGlobal({ scope: 'rule', isAdmin: false })).toBe(false)
  })

  it('never offers a non-admin the whole feed for everyone', () => {
    expect(canOfferGlobal({ scope: 'all', ruleAllowsGlobal: true, isAdmin: false })).toBe(false)
    expect(canOfferGlobal({ scope: 'device', isAdmin: false })).toBe(false)
  })

  it('offers an admin anything', () => {
    expect(canOfferGlobal({ scope: 'all', isAdmin: true })).toBe(true)
  })
})

// ── The payload ────────────────────────────────────────────────────────────
//
// Absence carries meaning on this contract (no classes = every class, no
// summary = the hub's ON, no global = personal), so what the panel does NOT
// send is as much of the design as what it does. Every assertion below is
// re-parsed through the mirror: a shape the schema rejects is a snooze the
// operator asked for and never got.

function draft(overrides: Partial<SnoozeDraft> = {}): SnoozeDraft {
  return {
    scope: 'all',
    ruleId: null,
    deviceId: null,
    durationMinutes: 30,
    global: false,
    summary: true,
    classes: [],
    ...overrides,
  }
}

describe('what the panel sends', () => {
  it('refuses a scoped window with nothing to scope to', () => {
    // The hub refuses these; the button refuses first rather than turning a
    // mis-tap into an error toast.
    expect(isSnoozeTargetComplete(draft({ scope: 'rule' }))).toBe(false)
    expect(isSnoozeTargetComplete(draft({ scope: 'device' }))).toBe(false)
    expect(isSnoozeTargetComplete(draft({ scope: 'rule', ruleId: 'r1' }))).toBe(true)
    expect(isSnoozeTargetComplete(draft({ scope: 'device', deviceId: 102 }))).toBe(true)
    expect(isSnoozeTargetComplete(draft())).toBe(true)
  })

  it('sends a camera window as a deviceId, and nothing else', () => {
    const input = buildSnoozeInput(draft({ scope: 'device', deviceId: 102, durationMinutes: 10 }))
    expect(input).toEqual({ scope: 'device', deviceId: 102, durationMinutes: 10 })
    expect(NcSnoozeInputSchema.parse(input)).toEqual(input)
  })

  it('never lets an id from another scope ride along', () => {
    // A deviceId on an `all` window is a claim about what is silenced that the
    // panel never made — and the operator would read it off the wrong row.
    const input = buildSnoozeInput(draft({ scope: 'all', ruleId: 'r1', deviceId: 102 }))
    expect(input.ruleId).toBeUndefined()
    expect(input.deviceId).toBeUndefined()
  })

  it('omits the class list entirely when nothing was picked', () => {
    // "Silence nothing" and "silence everything" must not share a wire shape —
    // and this is not merely tidy: the hub bounds `classes` with `.min(1)`, so
    // an emitted `[]` is a REJECTED create, i.e. a silence the operator asked
    // for and never got.
    expect('classes' in buildSnoozeInput(draft())).toBe(false)
    expect('classes' in buildSnoozeInput(draft({ classes: [] }))).toBe(false)
    expect(NcSnoozeInputSchema.safeParse({ ...buildSnoozeInput(draft()), classes: [] }).success).toBe(
      false,
    )
  })

  it('round-trips a class-narrowed window through the mirror', () => {
    const input = buildSnoozeInput(
      draft({ scope: 'device', deviceId: 102, classes: ['person', 'vehicle'] }),
    )
    expect(input.classes).toEqual(['person', 'vehicle'])
    expect(NcSnoozeInputSchema.parse(input).classes).toEqual(['person', 'vehicle'])
    // And back off the wire, on the persisted shape the panel then renders.
    const stored = NcSnoozeSchema.parse({
      ...snooze({ scope: 'device' }),
      deviceId: 102,
      classes: ['person', 'vehicle'],
      ruleId: undefined,
    })
    expect(stored.classes).toEqual(['person', 'vehicle'])
  })

  it('writes the defaults as ABSENCE, and only a chosen "off" as a value', () => {
    expect('summary' in buildSnoozeInput(draft({ summary: true }))).toBe(false)
    expect(buildSnoozeInput(draft({ summary: false })).summary).toBe(false)
    expect('global' in buildSnoozeInput(draft({ global: false }))).toBe(false)
    expect(buildSnoozeInput(draft({ global: true })).global).toBe(true)
  })
})

describe('the class narrowing', () => {
  const taxonomy: NcTaxonomy = {
    videoClasses: [
      { kind: 'person', label: 'Person', parentKind: null },
      { kind: 'vehicle', label: 'Vehicle', parentKind: null },
      { kind: 'car', label: 'Car', parentKind: 'vehicle' },
      { kind: 'animal', label: 'Animal', parentKind: null },
    ],
    audioKinds: [{ kind: 'dog-bark', label: 'Dog bark', parentKind: null }],
    labels: [],
  }

  it('offers the SAME vocabulary the classes condition offers', () => {
    // Never a local class list: two surfaces that name "person" differently is
    // how an operator concludes they are two features.
    expect(snoozeClassOptions(taxonomy).map((o) => o.value)).toEqual([
      'person',
      'vehicle',
      'car',
      'animal',
      'dog-bark',
    ])
    expect(snoozeClassOptions(taxonomy).find((o) => o.value === 'car')?.label).toBe('Car')
  })

  it('offers nothing against a hub that serves no taxonomy', () => {
    // The selector then disappears and every window covers every class — the
    // behaviour that existed before this control did.
    expect(snoozeClassOptions(undefined)).toEqual([])
  })

  it('has the selector strings in both locales', () => {
    for (const key of [
      'classesTitle',
      'classesHelp',
      'everyClass',
      'aCamera',
      'chooseCamera',
      'camerasLoading',
      'noCameras',
    ]) {
      expect(lookup(enLocale, `v2.nc.snooze.${key}`)).toBeTruthy()
      expect(lookup(itLocale, `v2.nc.snooze.${key}`)).toBeTruthy()
    }
  })
})

// ── The rule's snooze-button palette (the Advanced sub-screen) ─────────────

describe('toggleSnoozeMinute — the rule editor’s snooze-button chips', () => {
  it('starts from the hub defaults when the rule names none', () => {
    expect(toggleSnoozeMinute(undefined, 5)).toEqual([5, ...NC_DEFAULT_SNOOZE_MINUTES])
    expect(toggleSnoozeMinute(undefined, 30)).toEqual([10, 60])
  })

  it('removes a chosen minute and adds an unchosen one, always SORTED', () => {
    expect(toggleSnoozeMinute([60, 10], 10)).toEqual([60])
    expect(toggleSnoozeMinute([120, 10], 30)).toEqual([10, 30, 120])
  })

  it('never offers a fifth — the hub caps the list at four', () => {
    const four = [5, 10, 30, 60]
    expect(four.length).toBe(NC_SNOOZE_OPTIONS_MAX)
    expect(toggleSnoozeMinute(four, 120)).toEqual(four)
    // …but removing from a full list still works.
    expect(toggleSnoozeMinute(four, 5)).toEqual([10, 30, 60])
  })

  it('returns a SORTED copy on every path, even from an unsorted list', () => {
    const unsorted = [60, 5, 30]
    expect(toggleSnoozeMinute(unsorted, 10)).toEqual([5, 10, 30, 60]) // add
    expect(toggleSnoozeMinute(unsorted, 5)).toEqual([30, 60]) // remove
    const fullUnsorted = [60, 5, 30, 10]
    expect(toggleSnoozeMinute(fullUnsorted, 120)).toEqual([5, 10, 30, 60]) // refused fifth
    expect(unsorted).toEqual([60, 5, 30])
  })

  it('says when a fifth was REFUSED, so the chip can explain why nothing happened', () => {
    expect(snoozeToggleRefused([5, 10, 30, 60], 120)).toBe(true)
    expect(snoozeToggleRefused([5, 10, 30, 60], 5)).toBe(false)
    expect(snoozeToggleRefused(undefined, 5)).toBe(false)
  })

  it('returns a COPY — the caller’s list is untouched', () => {
    const list = [30, 10]
    const out = toggleSnoozeMinute(list, 60)
    expect(list).toEqual([30, 10])
    expect(out).not.toBe(list)
    expect(toggleSnoozeMinute(list, 99)).not.toBe(list)
  })

  it('can empty the list — `[]` is an explicit "no snooze buttons"', () => {
    expect(toggleSnoozeMinute([10], 10)).toEqual([])
  })

  it('offers only durations the hub accepts', () => {
    for (const minutes of NC_SNOOZE_BUTTON_CHOICES) expect(isOfferableDuration(minutes)).toBe(true)
    for (const minutes of NC_DEFAULT_SNOOZE_MINUTES) expect(NC_SNOOZE_BUTTON_CHOICES).toContain(minutes)
  })

  it('labels whole hours as hours', () => {
    expect(snoozeMinuteLabel(30)).toEqual({ key: 'minutes', params: { minutes: 30 } })
    expect(snoozeMinuteLabel(120)).toEqual({ key: 'hours', params: { hours: 2 } })
    expect(snoozeMinuteLabel(90)).toEqual({ key: 'minutes', params: { minutes: 90 } })
  })
})
