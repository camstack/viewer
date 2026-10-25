/**
 * The rule editor's AI section — the pure half.
 *
 * Five properties, each of which is a decision that would be invisible if it
 * broke, because every one of them fails by producing a form that still renders
 * and still saves:
 *
 *  - a kind whose subject freezes NO FRAME gets no section. The hub refuses the
 *    pass for those from the other end (`frozenRuleAiPolicy` returns
 *    `undefined` for a system event), so an offered switch would be one the
 *    operator turns on and that provably never runs — and nothing would say so.
 *  - the SHAPE is predicted exactly as the hub derives it. A drift here shows
 *    the operator the wrong default question, which is the one thing the
 *    pre-filled box exists to prevent.
 *  - the occupancy prompt is EDITABLE, and what it can express is a question
 *    and nothing else. The structured contract — `{confirmed, count, reason}`
 *    and the verdict sentence composed from it — lives in the system turn,
 *    which this form has no field for. Asserted as an absence, because that
 *    absence IS the guarantee.
 *  - the word cap is derived from the delivery TARGET's declared body budget,
 *    against the table the hub's own docblock publishes. This is a MIRROR of
 *    `ruleAiWordCap` (the addon is unreachable from this app), so the only
 *    thing standing between the two is this table.
 *  - absence round-trips. A value left on its default is pruned back out, so
 *    opening a rule and saving it writes nothing and a hub that improves its
 *    own default tomorrow still reaches a rule authored today.
 */
import { describe, expect, it } from 'vitest'
import { NC_RULE_KIND_SPECS } from '@camstack/types/client'
import type { NcRuleKind } from '@camstack/types'
import enLocale from '../../../../locales/en.json'
import itLocale from '../../../../locales/it.json'
import {
  NcRuleAiSchema,
  type NcRuleAi,
  type Target,
  type TargetKind,
} from '../../../data/notification-center.js'
import {
  emptyRuleAiForm,
  NC_RULE_AI_DEFAULT_PROMPT,
  NC_RULE_AI_LANGUAGES,
  NC_RULE_AI_SHAPES,
  NC_RULE_AI_WORDS_FALLBACK,
  ruleAiApplies,
  ruleAiFormToInput,
  ruleAiLanguageKey,
  ruleAiPromptValue,
  ruleAiShapeForForm,
  ruleAiTargetWordDefault,
  ruleAiToForm,
  ruleAiUnchanged,
  ruleAiWordCap,
  ruleAiWordsValue,
  type NcRuleAiFormState,
  type NcRuleAiShape,
} from '../rule-ai-form.js'

// ── Which rules get a section ───────────────────────────────────────

describe('a rule that freezes no frame gets no AI section', () => {
  it('refuses the system kind and offers every other one', () => {
    expect(ruleAiApplies('system')).toBe(false)
    for (const kind of ['detection', 'sensor', 'occupancy', 'sound'] as const) {
      expect(ruleAiApplies(kind), `${kind} carries a picture`).toBe(true)
    }
  })

  it('reads the SHARED model rather than comparing against a name', () => {
    // The gate is `carriesMedia`, so a kind added to the shared model tomorrow
    // gets the right answer without this file being edited — and a kind whose
    // media flag is flipped there flips here too, which is the whole point of
    // not hard-coding `'system'`.
    for (const spec of NC_RULE_KIND_SPECS) {
      const kind: NcRuleKind = spec.kind
      expect(ruleAiApplies(kind)).toBe(spec.carriesMedia)
    }
  })
})

// ── Which question ──────────────────────────────────────────────────

describe('the shape is predicted exactly as the hub derives it', () => {
  it('reads an occupancy rule as the COUNT question, whatever its delivery', () => {
    expect(ruleAiShapeForForm('occupancy', 'device-event')).toBe('occupancy')
    expect(ruleAiShapeForForm('occupancy', 'immediate')).toBe('occupancy')
  })

  it('draws the detection split where the ENGINE draws it', () => {
    expect(ruleAiShapeForForm('detection', 'track-end')).toBe('detection-track')
    expect(ruleAiShapeForForm('detection', 'immediate')).toBe('detection-immediate')
    // Everything else with a picture is ONE moment — a doorbell's marker, a
    // sound's photograph, a parcel.
    expect(ruleAiShapeForForm('sensor', 'device-event')).toBe('detection-immediate')
    expect(ruleAiShapeForForm('sound', 'immediate')).toBe('detection-immediate')
    expect(ruleAiShapeForForm('detection', 'package-event')).toBe('detection-immediate')
  })

  it('has a default question for every shape', () => {
    for (const shape of NC_RULE_AI_SHAPES) {
      expect(NC_RULE_AI_DEFAULT_PROMPT[shape].length).toBeGreaterThan(0)
    }
  })
})

// ── The prompt ──────────────────────────────────────────────────────

describe('the prompt box shows the default and the operator may replace it', () => {
  it('pre-fills with the shape default rather than an empty box', () => {
    const form = emptyRuleAiForm()
    for (const shape of NC_RULE_AI_SHAPES) {
      expect(ruleAiPromptValue(form, shape)).toBe(NC_RULE_AI_DEFAULT_PROMPT[shape])
    }
  })

  it('follows the shape while untouched — a rule converted to occupancy re-asks', () => {
    // The kind is derived on every render, so authoring an occupancy condition
    // changes WHICH QUESTION the rows will be asked while the form is open. A
    // snapshotted seed would leave the detection question on screen.
    const form = emptyRuleAiForm()
    expect(ruleAiPromptValue(form, 'detection-immediate')).toBe('What is in this picture?')
    expect(ruleAiPromptValue(form, 'occupancy')).toBe('Does the claimed count hold?')
  })

  it('sends an occupancy question the operator wrote, verbatim', () => {
    const form: NcRuleAiFormState = {
      ...emptyRuleAiForm(),
      enabled: true,
      prompt: '  Count only the delivery vans, not the residents’ cars.  ',
    }
    const sent = ruleAiFormToInput(form, 'occupancy', NC_RULE_AI_WORDS_FALLBACK)
    expect(sent?.prompt).toBe('Count only the delivery vans, not the residents’ cars.')
  })

  it('prunes a prompt the operator did not actually change', () => {
    const form: NcRuleAiFormState = {
      ...emptyRuleAiForm(),
      enabled: true,
      prompt: NC_RULE_AI_DEFAULT_PROMPT.occupancy,
    }
    const sent = ruleAiFormToInput(form, 'occupancy', NC_RULE_AI_WORDS_FALLBACK)
    expect(sent).not.toBeNull()
    expect(sent?.prompt).toBeUndefined()
  })

  it('CANNOT express a response format — the structured contract is not authorable', () => {
    // The occupancy answer is `{confirmed, count, reason}` and the addon
    // composes the verdict sentence from it ("NOT confirmed — the camera shows
    // 1, not 2"). That contract lives in the SYSTEM turn the hub builds; the
    // operator's text is the first line of the USER turn and nothing else.
    //
    // Asserted as an absence: every key this form can emit is a key of the
    // hub's own section schema, and none of them names an answer format. A
    // field added here that could — `jsonSchema`, `responseFormat`, `system` —
    // fails this, which is the only moment anybody would notice before the
    // occupancy parse started failing in production.
    const form: NcRuleAiFormState = {
      ...emptyRuleAiForm(),
      enabled: true,
      profileId: 'p1',
      prompt: 'Reply as plain prose, no JSON.',
      language: 'it',
      maxWords: 40,
      carried: { maxImagePx: 640, timeoutMs: 6_000 },
    }
    const sent = ruleAiFormToInput(form, 'occupancy', NC_RULE_AI_WORDS_FALLBACK)
    expect(sent).not.toBeNull()
    const emitted = Object.keys(sent ?? {}).toSorted()
    expect(emitted).toEqual(
      ['enabled', 'language', 'maxImagePx', 'maxWords', 'profileId', 'prompt', 'timeoutMs'].toSorted(),
    )
    // And the hub would accept it unchanged: the mirror is the parse boundary.
    expect(NcRuleAiSchema.safeParse(sent).success).toBe(true)
    for (const key of emitted) {
      expect(['jsonSchema', 'responseFormat', 'schema', 'system']).not.toContain(key)
    }
  })
})

// ── The word cap ────────────────────────────────────────────────────

describe('the word cap comes from the delivery target', () => {
  /** The table the hub's `ruleAiWordCap` docblock publishes, verbatim. */
  it.each([
    ['zentik', 500, 12],
    ['pushover', 1024, 24],
    ['discord', 2000, 36],
    ['home-assistant', 3500, 46],
    ['ntfy · gotify · telegram · whatsapp', 4096, 48],
    ['webhook', 1_000_000, 120],
  ])('%s (%i chars) → %i words', (_kind, bodyMaxLen, words) => {
    expect(ruleAiWordCap(undefined, bodyMaxLen)).toBe(words)
  })

  it('treats an ABSENT budget as unknown, never as a cap of nothing', () => {
    expect(ruleAiWordCap(undefined, undefined)).toBe(NC_RULE_AI_WORDS_FALLBACK)
    expect(ruleAiWordCap(undefined, 0)).toBe(NC_RULE_AI_WORDS_FALLBACK)
  })

  it('lets an authored cap win', () => {
    expect(ruleAiWordCap(80, 500)).toBe(80)
  })
})

const TARGETS: readonly Target[] = [
  { id: 'push', name: 'Phone', kind: 'pushover', addonId: 'notifiers', enabled: true, config: {} },
  { id: 'hook', name: 'Webhook', kind: 'webhook', addonId: 'notifiers', enabled: true, config: {} },
]

function targetKind(kind: string, bodyMaxLen: number): TargetKind {
  return {
    kind,
    label: kind,
    icon: 'bell',
    addonId: 'notifiers',
    configSchema: {},
    supportsDiscovery: false,
    caps: {
      attachments: { mediaTypes: ['image'], mode: 'url', max: 1 },
      actions: 0,
      levels: [],
      format: ['text'],
      clickUrl: true,
      sound: false,
      ttl: false,
      bodyMaxLen,
    },
  }
}

const KINDS: readonly TargetKind[] = [
  targetKind('pushover', 1024),
  targetKind('webhook', 1_000_000),
]

describe('the word-cap field shows the TARGET default while nothing is authored', () => {
  it('shows the selected target’s number, not an empty box', () => {
    const found = ruleAiTargetWordDefault(['push'], TARGETS, KINDS)
    expect(found).toEqual({ words: 24, varies: false })
    expect(ruleAiWordsValue(emptyRuleAiForm(), found.words)).toBe(24)
  })

  it('shows the STRICTEST when the targets disagree, and says they disagree', () => {
    // The hub resolves the cap per target at send time, so there is no single
    // number — the strictest is the one an over-long sentence is actually
    // truncated by, and `varies` is what stops the label calling it "the"
    // default.
    expect(ruleAiTargetWordDefault(['push', 'hook'], TARGETS, KINDS)).toEqual({
      words: 24,
      varies: true,
    })
  })

  it('falls back to the hub’s own number when no target is picked yet', () => {
    expect(ruleAiTargetWordDefault([], TARGETS, KINDS)).toEqual({
      words: NC_RULE_AI_WORDS_FALLBACK,
      varies: false,
    })
  })

  it('falls back when the kind catalog has not answered — unknown is not zero', () => {
    expect(ruleAiTargetWordDefault(['push'], TARGETS, [])).toEqual({
      words: NC_RULE_AI_WORDS_FALLBACK,
      varies: false,
    })
  })

  it('shows an AUTHORED cap in place of the default', () => {
    const form: NcRuleAiFormState = { ...emptyRuleAiForm(), maxWords: 60 }
    expect(ruleAiWordsValue(form, 24)).toBe(60)
  })

  it('prunes a cap the operator moved back onto the target default', () => {
    const form: NcRuleAiFormState = { ...emptyRuleAiForm(), enabled: true, maxWords: 24 }
    expect(ruleAiFormToInput(form, 'detection-immediate', 24)?.maxWords).toBeUndefined()
    expect(ruleAiFormToInput(form, 'detection-immediate', 48)?.maxWords).toBe(24)
  })
})

// ── Round trip ──────────────────────────────────────────────────────

describe('absence round-trips', () => {
  it('leaves NOTHING on disk for a rule whose section was never touched', () => {
    // `null` clears the row. A section written for every rule the operator ever
    // opened is a table that outlives every reason to read it.
    expect(ruleAiFormToInput(emptyRuleAiForm(), 'detection-immediate', 24)).toBeNull()
    expect(ruleAiUnchanged(null, undefined)).toBe(true)
  })

  it('KEEPS an authored section the operator switched off', () => {
    const form: NcRuleAiFormState = {
      ...emptyRuleAiForm(),
      enabled: false,
      prompt: 'Is the gate open?',
    }
    const sent = ruleAiFormToInput(form, 'detection-immediate', 24)
    expect(sent).toEqual({ enabled: false, prompt: 'Is the gate open?' })
  })

  it('opening a stored section and saving it writes nothing', () => {
    const stored: NcRuleAi = { enabled: true, prompt: 'Is the gate open?', language: 'it' }
    const back = ruleAiFormToInput(ruleAiToForm(stored), 'detection-immediate', 24)
    expect(back).toEqual(stored)
    expect(ruleAiUnchanged(back, stored)).toBe(true)
  })

  it('carries the fields this app does not author through an edit', () => {
    // `nc.setRuleAi` takes the WHOLE section, not a diff — a field dropped here
    // is a field CLEARED on disk, so an image bound an admin set from the
    // desktop would silently revert the first time the rule was opened on a
    // phone.
    const stored: NcRuleAi = { enabled: true, maxImagePx: 896, timeoutMs: 12_000 }
    expect(ruleAiFormToInput(ruleAiToForm(stored), 'detection-immediate', 24)).toEqual(stored)
  })
})

// ── i18n ────────────────────────────────────────────────────────────

/** Resolve a dotted i18n key against a locale JSON tree, without a cast. */
function lookupLocale(tree: unknown, key: string): string | undefined {
  let node: unknown = tree
  for (const part of key.split('.')) {
    if (node === null || typeof node !== 'object' || !(part in node)) return undefined
    const record: Record<string, unknown> = { ...node }
    node = record[part]
  }
  return typeof node === 'string' ? node : undefined
}

const AI_KEYS: readonly string[] = [
  'v2.nc.rules.editor.ai.sectionLabel',
  'v2.nc.rules.editor.ai.enabledLabel',
  'v2.nc.rules.editor.ai.enabledHint',
  'v2.nc.rules.editor.ai.profileLabel',
  'v2.nc.rules.editor.ai.profileAuto',
  'v2.nc.rules.editor.ai.noProfiles',
  'v2.nc.rules.editor.ai.profilesUnavailable',
  'v2.nc.rules.editor.ai.languageLabel',
  'v2.nc.rules.editor.ai.languageAuto',
  'v2.nc.rules.editor.ai.maxWordsLabel',
  'v2.nc.rules.editor.ai.maxWordsHint',
  'v2.nc.rules.editor.ai.maxWordsVaries',
  'v2.nc.rules.editor.ai.promptLabel',
  'v2.nc.rules.editor.ai.occupancyContract',
  ...NC_RULE_AI_SHAPES.map((shape: NcRuleAiShape) => `v2.nc.rules.editor.ai.blurb.${shape}`),
  ...NC_RULE_AI_LANGUAGES.map((language) => ruleAiLanguageKey(language)),
]

describe('every string the AI section asks for, in both locales', () => {
  it.each(AI_KEYS)('%s is in both locales', (key) => {
    expect(lookupLocale(enLocale, key), `en is missing ${key}`).toBeTruthy()
    expect(lookupLocale(itLocale, key), `it is missing ${key}`).toBeTruthy()
  })

  it('places the derived number in both word-cap hints', () => {
    // The hint's whole job is to name the number in force. A translation that
    // dropped the placeholder would leave the operator reading a rule about a
    // default it never states.
    for (const key of [
      'v2.nc.rules.editor.ai.maxWordsHint',
      'v2.nc.rules.editor.ai.maxWordsVaries',
    ]) {
      expect(lookupLocale(enLocale, key)).toContain('{{words}}')
      expect(lookupLocale(itLocale, key)).toContain('{{words}}')
    }
  })

  it('says the cap is an INSTRUCTION, not a cut', () => {
    // The hub states the cap to the model (`Use at most N words of prose.`) and
    // only trims afterwards as a backstop, marking the cut with an ellipsis. An
    // operator told "limit: 24" who counts 25 words concludes the feature is
    // broken — so both locales have to hedge.
    expect(lookupLocale(enLocale, 'v2.nc.rules.editor.ai.maxWordsHint')).toMatch(/about|roughly/i)
    expect(lookupLocale(itLocale, 'v2.nc.rules.editor.ai.maxWordsHint')).toMatch(
      /circa|all'incirca/i,
    )
  })
})
