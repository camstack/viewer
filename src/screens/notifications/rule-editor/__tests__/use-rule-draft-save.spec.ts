/**
 * @vitest-environment jsdom
 *
 * A save is what ends a draft, and only a save that LANDED.
 *
 * The draft outlives every sub-screen by design, so the one thing that must
 * drop it is a successful save: otherwise reopening the rule shows the edits
 * the operator already saved as unsaved changes, over a baseline the hub has
 * moved past. A failed save must keep it, or the refusal on screen names edits
 * that no longer exist. And the save still sends the clears computed from the
 * form, so an emptied message is emptied on the hub.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup } from '@testing-library/react'
import React, { useEffect } from 'react'

import { mountScreen } from '../../../../testing/mount.js'
import { resetRuleDrafts } from '../../../../testing/rule-draft-harness.js'
import { NcViewerRuleSchema, type NcViewerRule } from '../../../../data/notification-center.js'
import { useNcRuleDraftStore } from '../../../../store/nc-rule-draft-store.js'
import { useRuleDraft, type UseRuleDraft } from '../use-rule-draft.js'
import { routerCalls } from '../../../../testing/native-stubs/expo-router.js'
import { emptyRuleAiForm } from '../../../../components/notifications/rule-ai-form.js'
import { NcRuleActionsSchema as PublishedRuleActionsSchema } from '@camstack/types'

/** One key of an unknown payload — the wire is read structurally. */
function field(input: unknown, key: string): unknown {
  if (input === null || typeof input !== 'object' || !(key in input)) return undefined
  return Reflect.get(input, key)
}

vi.mock('../../../../connection/ConnectionProvider.js', async () =>
  (await import('../../../../testing/connection-stub.js')).connectionStubModule(),
)

const RULE_FIELDS = {
  id: 'rule-1',
  name: 'Front door',
  enabled: true,
  delivery: 'immediate',
  conditions: { classes: ['person'] },
  targets: [{ targetId: 'tgt-a' }],
  media: { attach: 'best' },
  priority: 3,
  createdBy: 'me',
  createdAt: 10,
  updatedAt: 20,
  disabledTargetIds: [],
  readOnly: false,
  template: { title: 'Hello' },
}
const RULE: NcViewerRule = NcViewerRuleSchema.parse(RULE_FIELDS)
/** The same rule as the hub answers it to a non-admin: an admin's rule. */
const ADMIN_RULE: NcViewerRule = NcViewerRuleSchema.parse({ ...RULE_FIELDS, readOnly: true })

function actionOf(input: unknown): string {
  if (input === null || typeof input !== 'object' || !('action' in input)) return ''
  const action: unknown = { ...input }['action']
  return typeof action === 'string' ? action : ''
}

/** The rule as a hub that APPLIES `clear` returns it — an older hub would
 *  return it unchanged, and the save now refuses that (final review I4). */
function applyClears(rule: Readonly<Record<string, unknown>>, input: unknown): Readonly<Record<string, unknown>> {
  const clear: unknown =
    input !== null && typeof input === 'object' && 'clear' in input ? input.clear : undefined
  const keys: readonly unknown[] = Array.isArray(clear) ? clear : []
  return Object.fromEntries(Object.entries(rule).filter(([key]) => !keys.includes(key)))
}

function inputOf(input: unknown): unknown {
  if (input === null || typeof input !== 'object' || !('input' in input)) return undefined
  return { ...input }['input']
}

interface HubLog {
  readonly updates: unknown[]
  readonly aiWrites: unknown[]
  /** Set once `auth.me` has been answered — and with which role. */
  meAnswered?: boolean
  readonly isAdmin?: boolean
  /** `auth.me` never answers — the caller's role stays unknown. */
  readonly mePending?: boolean
  /** `auth.me` REJECTS — the role read failed. */
  readonly meError?: boolean
  /** `nc.listMyTargets` rejects. */
  readonly targetsFail?: boolean
}

type Refusal = 'none' | 'rule' | 'ai'

function hub(log: HubLog, refuse: Refusal, rule: NcViewerRule = RULE) {
  return {
    'auth.me': (): unknown => {
      if (log.mePending === true) return new Promise(() => undefined)
      if (log.meError === true) throw new Error('auth.me unreachable')
      log.meAnswered = true
      return { id: 'u1', username: 'operator', isAdmin: log.isAdmin === true }
    },
    'addons.custom': (input?: unknown): unknown => {
      const action = actionOf(input)
      if (action === 'nc.listRules') return { rules: [rule] }
      if (action === 'nc.listMyTargets' && log.targetsFail === true) throw new Error('targets unreachable')
      if (action === 'nc.listMyTargets') return { targets: [{ id: 'tgt-a', name: 'Phone', kind: 'pushover', addonId: 'notifiers', enabled: true, config: {} }] }
      if (action === 'nc.getConditionCatalog') return { catalog: [] }
      if (action === 'nc.getRuleAi') return { sections: [] }
      if (action === 'nc.updateRule') {
        log.updates.push(inputOf(input))
        if (refuse === 'rule') throw new Error('refused by the hub')
        return { rule: applyClears(RULE, inputOf(input)) }
      }
      if (action === 'nc.setRuleAi') {
        log.aiWrites.push(inputOf(input))
        if (refuse === 'ai') throw new Error('ai section refused')
        return { success: true }
      }
      throw new Error(`NOT_FOUND: ${action}`)
    },
  }
}

let latest: UseRuleDraft | null = null

function Probe({ id = RULE.id, kind }: { readonly id?: string; readonly kind?: string }): null {
  const editor = useRuleDraft({ id, kind })
  useEffect(() => {
    latest = editor
  })
  return null
}

async function openReady(log: HubLog, refuse: Refusal, rule: NcViewerRule = RULE): Promise<void> {
  mountScreen(React.createElement(Probe), { hub: hub(log, refuse, rule) })
  await vi.waitFor(() => {
    expect(latest?.status).toBe('ready')
    expect(useNcRuleDraftStore.getState().drafts[RULE.id]).toBeDefined()
  })
  // Targets and catalog must have landed too, or the save would drop the target.
  if (!rule.readOnly && log.targetsFail !== true) await vi.waitFor(() => expect(latest?.valid).toBe(true))
  // …and the role, which decides which stored targets a save keeps.
  if (log.mePending !== true && log.meError !== true) {
    await vi.waitFor(() => expect(log.meAnswered).toBe(true))
    await act(async () => {
      await Promise.resolve()
    })
  }
}

afterEach(() => {
  cleanup()
  resetRuleDrafts()
  latest = null
})

describe('useRuleDraft().save', () => {
  it('sends the clears from the form, then discards the draft', async () => {
    const log: HubLog = { updates: [], aiWrites: [] }
    await openReady(log, 'none')
    await act(async () => {
      latest?.patch({ templateTitle: '', templateBody: '' })
    })
    await act(async () => {
      await latest?.save()
    })
    expect(log.updates).toHaveLength(1)
    expect(log.updates[0]).toMatchObject({ ruleId: RULE.id, clear: expect.arrayContaining(['template']) })
    expect(useNcRuleDraftStore.getState().drafts[RULE.id]).toBeUndefined()
  })

  it('while the caller\'s role is unknown, a save is refused and sends nothing (fix round 2)', async () => {
    // The role decides which stored targets survive the save
    // (`target-ownership.ts`), so it is never guessed.
    const log: HubLog = { updates: [], aiWrites: [], mePending: true }
    await openReady(log, 'none')
    await act(async () => {
      latest?.patch({ name: 'Renamed' })
    })
    await act(async () => {
      await expect(latest?.save()).rejects.toThrow(/save blocked: role-pending/)
    })
    expect(log.updates).toEqual([])
  })

  it.each([
    ['the ROLE read failed', { meError: true }, 'role-unknown'],
    ['the TARGETS read failed', { targetsFail: true }, 'targets-failed'],
  ] as const)('when %s, the save is blocked, named, and sends nothing (fix round 3)', async (_label, flags, reason) => {
    // A failed role read is not "not admin", and a failed list is not "owns
    // nothing" — either guess would send the wrong `targets`.
    const log: HubLog = { updates: [], aiWrites: [], ...flags }
    await openReady(log, 'none')
    await vi.waitFor(() => expect(latest?.saveBlock).toBe(reason))
    await act(async () => {
      latest?.patch({ name: 'Renamed' })
    })
    await act(async () => {
      await expect(latest?.save()).rejects.toThrow(/save blocked/)
    })
    expect(log.updates).toEqual([])
  })

  it('a refused save keeps the draft and its edits', async () => {
    const log: HubLog = { updates: [], aiWrites: [] }
    await openReady(log, 'rule')
    await act(async () => {
      latest?.patch({ name: 'Edited' })
    })
    await act(async () => {
      await latest?.save().catch(() => undefined)
    })
    expect(log.updates).toHaveLength(1)
    expect(useNcRuleDraftStore.getState().drafts[RULE.id]?.form.name).toBe('Edited')
    await vi.waitFor(() => expect(latest?.error).toContain('refused'))
  })

  it('a refused AI write keeps the draft too — the rule landed, the sentence did not', async () => {
    const log: HubLog = { updates: [], aiWrites: [] }
    await openReady(log, 'ai')
    await act(async () => {
      useNcRuleDraftStore.getState().patchAi(RULE.id, { ...emptyRuleAiForm(), enabled: true })
    })
    await act(async () => {
      await latest?.save().catch(() => undefined)
    })
    expect(log.updates).toHaveLength(1)
    expect(log.aiWrites).toHaveLength(1)
    expect(useNcRuleDraftStore.getState().drafts[RULE.id]?.ai?.enabled).toBe(true)
  })

  it('a read-only rule is never written, whatever the draft holds', async () => {
    const log: HubLog = { updates: [], aiWrites: [] }
    await openReady(log, 'none', ADMIN_RULE)
    expect(latest?.readOnly).toBe(true)
    let refused = false
    await act(async () => {
      await latest?.save().catch(() => {
        refused = true
      })
    })
    expect(refused).toBe(true)
    expect(log.updates).toHaveLength(0)
  })

  it('an incomplete form is refused locally and marks the draft, so the fields turn red', async () => {
    const log: HubLog = { updates: [], aiWrites: [] }
    await openReady(log, 'none')
    await act(async () => {
      latest?.patch({ name: '  ' })
    })
    let refused = false
    await act(async () => {
      await latest?.save().catch(() => {
        refused = true
      })
    })
    expect(refused).toBe(true)
    expect(log.updates).toHaveLength(0)
    expect(useNcRuleDraftStore.getState().drafts[RULE.id]?.saveAttempted).toBe(true)
  })
})

describe('useRuleDraft on /rule/new', () => {
  it('without a known kind, it sends the operator to the kind picker', async () => {
    const log: HubLog = { updates: [], aiWrites: [] }
    mountScreen(React.createElement(Probe, { id: 'new', kind: 'nonsense' }), { hub: hub(log, 'none') })
    await vi.waitFor(() => expect(routerCalls()).toContainEqual({ kind: 'replace', target: '/rule/new' }))
    expect(latest?.status).toBe('loading')
  })

  it('with a known kind, it opens on that kind and never redirects', async () => {
    const log: HubLog = { updates: [], aiWrites: [] }
    mountScreen(React.createElement(Probe, { id: 'new', kind: 'sound' }), { hub: hub(log, 'none') })
    await vi.waitFor(() => expect(latest?.status).toBe('ready'))
    expect(latest?.kind).toBe('sound')
    expect(routerCalls().filter((call) => call.kind === 'replace')).toEqual([])
  })
})

describe('useRuleDraft().save — the admin-only fields follow the CALLER', () => {
  const WIRED = NcViewerRuleSchema.parse({
    ...RULE_FIELDS,
    targetUsers: ['u-anna'],
    // Every hook edge and a button: an unrelated edit must send them ALL back
    // (the hub's patch replaces `actions` whole), in the hub's binding shape.
    actions: {
      onActivation: [{ kind: 'sequence', sequenceId: 'seq-arm' }],
      onTrigger: [
        { kind: 'sequence', sequenceId: 'seq-siren' },
        { kind: 'do', action: { kind: 'cap', deviceId: 7, cap: 'switch', method: 'turnOn' } },
      ],
      onTriggerOff: [{ kind: 'do', action: { kind: 'wait', seconds: 3 } }],
      buttons: [{ id: 'b1', label: 'Siren', sequenceId: 'seq-siren' }],
    },
  })

  async function saveEmptied(isAdmin: boolean): Promise<unknown> {
    const log: HubLog = { updates: [], aiWrites: [], isAdmin }
    await openReady(log, 'none', WIRED)
    await vi.waitFor(() => expect(log.meAnswered).toBe(true))
    await act(async () => {
      await Promise.resolve()
    })
    await act(async () => {
      latest?.patch({ targetUsers: [] })
    })
    await act(async () => {
      await latest?.save()
    })
    expect(log.updates).toHaveLength(1)
    return log.updates[0]
  }

  it('an admin sends the actions it holds and clears the users it emptied', async () => {
    const sent = await saveEmptied(true)
    expect(sent).toMatchObject({
      patch: { actions: WIRED.actions },
      clear: expect.arrayContaining(['targetUsers']),
    })
    // Exactly as stored — nothing dropped, nothing added — and what the hub accepts.
    const actions = field(field(sent, 'patch'), 'actions')
    expect(actions).toEqual(WIRED.actions)
    expect(PublishedRuleActionsSchema.safeParse(actions).success).toBe(true)
  })

  it('a non-admin neither sends nor clears them — the hub keeps the admin wiring', async () => {
    const sent = await saveEmptied(false)
    expect(sent).not.toMatchObject({ patch: { actions: expect.anything() } })
    expect(sent).not.toMatchObject({ clear: expect.arrayContaining(['targetUsers']) })
    expect(sent).not.toMatchObject({ clear: expect.arrayContaining(['actions']) })
  })
})

describe('useRuleDraft().save — a broken admin-wired actions block', () => {
  // The schema accepts a button whose label is only blanks (`min(1)`); the
  // editor's validator, which trims, does not.
  const DANGLING = NcViewerRuleSchema.parse({
    ...RULE_FIELDS,
    actions: { buttons: [{ id: 'b1', label: '   ', sequenceId: 'seq-open' }] },
  })

  async function trySave(isAdmin: boolean): Promise<{ log: HubLog; refused: boolean }> {
    const log: HubLog = { updates: [], aiWrites: [], isAdmin }
    // Not `openReady`: it waits for `valid`, which an admin never reaches here.
    mountScreen(React.createElement(Probe), { hub: hub(log, 'none', DANGLING) })
    await vi.waitFor(() => {
      expect(latest?.status).toBe('ready')
      expect(log.meAnswered).toBe(true)
    })
    // Settle on the verdict the role implies: the non-admin is valid once the
    // targets land; the admin is invalid once the verdict lands.
    await vi.waitFor(() => expect(latest?.valid).toBe(!isAdmin))
    let refused = false
    await act(async () => {
      await latest?.save().catch(() => {
        refused = true
      })
    })
    return { log, refused }
  }

  it('does not lock a non-admin out of their own rule', async () => {
    const { log, refused } = await trySave(false)
    expect(refused).toBe(false)
    expect(log.updates).toHaveLength(1)
  })

  it('blocks an admin, who can see and fix it', async () => {
    const { log, refused } = await trySave(true)
    expect(refused).toBe(true)
    expect(log.updates).toHaveLength(0)
  })
})
