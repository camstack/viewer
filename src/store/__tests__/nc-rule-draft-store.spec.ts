import { describe, expect, it } from 'vitest'
import { emptyRuleForm } from '../../components/notifications/rule-editor.js'
import { emptyRuleAiForm } from '../../components/notifications/rule-ai-form.js'
import { NcViewerRuleSchema } from '../../data/notification-center.js'
import {
  adoptDraftRule,
  discardDraft,
  markAdoptedSeen,
  draftKey,
  isDraftDirty,
  markDraftSaveAttempted,
  openDraft,
  patchDraft,
  patchDraftAi,
  useNcRuleDraftStore,
  type NcRuleDraft,
} from '../nc-rule-draft-store.js'

// `isDraftDirty` compares form and baseline by JSON: both are built by the same
// `inputToForm` / reducers, so their key order is stable.
const base = { ...emptyRuleForm(), name: 'gate' }

function draftOf(ruleId: string | null, kind: NcRuleDraft['kind']): NcRuleDraft {
  return { key: draftKey(ruleId, kind), kind, ruleId, baseline: base, form: base, ai: null, saveAttempted: false }
}

describe('rule drafts', () => {
  it('opening an existing draft keeps the edits — a sub-screen round trip loses nothing', () => {
    const key = draftKey('r1', 'detection')
    const a = openDraft({}, draftOf('r1', 'detection'))
    const b = patchDraft(a, key, { name: 'gate 2' })
    const c = openDraft(b, draftOf('r1', 'detection'))
    expect(c[key]?.form.name).toBe('gate 2')
  })

  it('reducers never mutate', () => {
    const key = draftKey(null, 'sound')
    const a = openDraft({}, draftOf(null, 'sound'))
    const b = patchDraft(a, key, { name: 'x' })
    expect(a[key]?.form.name).toBe('gate')
    expect(b).not.toBe(a)
  })

  it('dirty compares against the baseline, not against "was touched"', () => {
    const key = draftKey('r1', 'detection')
    const a = openDraft({}, draftOf('r1', 'detection'))
    expect(a[key]).toBeDefined()
    expect(a[key] && isDraftDirty(a[key])).toBe(false)
    const b = patchDraft(a, key, { name: 'y' })
    expect(b[key] && isDraftDirty(b[key])).toBe(true)
    const c = patchDraft(b, key, { name: 'gate' })
    expect(c[key] && isDraftDirty(c[key])).toBe(false)
  })

  it('a touched AI section counts as dirty — null means untouched', () => {
    const key = draftKey('r1', 'detection')
    const a = patchDraftAi(openDraft({}, draftOf('r1', 'detection')), key, emptyRuleAiForm())
    expect(a[key] && isDraftDirty(a[key])).toBe(true)
  })

  it('patching a draft that is not open changes nothing', () => {
    const drafts = openDraft({}, draftOf('r1', 'detection'))
    expect(patchDraft(drafts, 'nope', { name: 'z' })).toBe(drafts)
    expect(patchDraftAi(drafts, 'nope', emptyRuleAiForm())).toBe(drafts)
  })

  it('a save attempt is remembered on the draft and is not an edit', () => {
    const key = draftKey('r1', 'detection')
    const a = openDraft({}, draftOf('r1', 'detection'))
    const b = markDraftSaveAttempted(a, key)
    expect(b[key]?.saveAttempted).toBe(true)
    expect(a[key]?.saveAttempted).toBe(false)
    expect(isDraftDirty(b[key] ?? draftOf('r1', 'detection'))).toBe(false)
    expect(markDraftSaveAttempted(a, 'nope')).toBe(a)
  })

  it('discard removes only that draft', () => {
    const k1 = draftKey('r1', 'detection')
    const k2 = draftKey('r2', 'sensor')
    const d = openDraft(openDraft({}, draftOf('r1', 'detection')), draftOf('r2', 'sensor'))
    expect(Object.keys(discardDraft(d, k1))).toEqual([k2])
  })

  it('a new draft is keyed by kind, so two "new" rules of different kinds do not collide', () => {
    expect(draftKey(null, 'sound')).not.toBe(draftKey(null, 'occupancy'))
  })

  it('the store glues the reducers and keeps drafts in memory', () => {
    const key = draftKey('r9', 'detection')
    const store = useNcRuleDraftStore.getState()
    store.open(draftOf('r9', 'detection'))
    useNcRuleDraftStore.getState().patch(key, { name: 'edited' })
    expect(useNcRuleDraftStore.getState().drafts[key]?.form.name).toBe('edited')
    useNcRuleDraftStore.getState().patchAi(key, emptyRuleAiForm())
    expect(useNcRuleDraftStore.getState().drafts[key]?.ai).not.toBeNull()
    useNcRuleDraftStore.getState().discard(key)
    expect(useNcRuleDraftStore.getState().drafts[key]).toBeUndefined()
  })
})

describe('an adopted draft (a create the hub stored, then refused its summary)', () => {
  const STORED = NcViewerRuleSchema.parse({
    id: 'created-1',
    name: 'gate',
    delivery: 'system-event',
    targets: [],
    createdBy: 'u1',
    createdAt: 1,
    updatedAt: 2,
    readOnly: false,
  })

  it('moves off the "new" key, onto the rule, bound to its id', () => {
    const newKey = draftKey(null, 'device-events')
    const edited = patchDraft(openDraft({}, draftOf(null, 'device-events')), newKey, { name: 'kept' })
    const adopted = adoptDraftRule(edited, newKey, STORED, 'v2.nc.rules.editor.summaryNotKept', 1000)
    expect(adopted[newKey]).toBeUndefined()
    expect(adopted['created-1']).toMatchObject({
      key: 'created-1',
      ruleId: 'created-1',
      adopted: STORED,
      notice: 'v2.nc.rules.editor.summaryNotKept',
      adoptedAt: 1000,
    })
    expect(adopted['created-1']?.adoptedSeen).toBeUndefined()
    expect(adopted['created-1']?.form.name).toBe('kept')
    // Once the list has shown it, that is recorded — and only once.
    const seen = markAdoptedSeen(adopted, 'created-1')
    expect(seen['created-1']?.adoptedSeen).toBe(true)
    expect(markAdoptedSeen(seen, 'created-1')).toBe(seen)
    // A draft that was never adopted is left alone.
    const plain = openDraft({}, draftOf('r9', 'detection'))
    expect(markAdoptedSeen(plain, 'r9')).toBe(plain)
  })

  it('a "new" route never JOINS a draft that belongs to a stored rule — it reseeds', () => {
    const newKey = draftKey(null, 'device-events')
    const stale: NcRuleDraft = { ...draftOf(null, 'device-events'), form: { ...base, name: 'stale' }, adopted: STORED }
    const opened = openDraft({ [newKey]: stale }, draftOf(null, 'device-events'))
    expect(opened[newKey]?.adopted).toBeUndefined()
    expect(opened[newKey]?.form.name).toBe('gate')
  })

  it("the rule's own edit route keeps the adopted draft (its edits and notice)", () => {
    const moved = adoptDraftRule(
      openDraft({}, draftOf(null, 'device-events')),
      draftKey(null, 'device-events'),
      STORED,
      'n',
      1,
    )
    const reopened = openDraft(moved, draftOf('created-1', 'device-events'))
    expect(reopened['created-1']?.adopted).toBe(STORED)
    expect(reopened['created-1']?.notice).toBe('n')
  })
})
