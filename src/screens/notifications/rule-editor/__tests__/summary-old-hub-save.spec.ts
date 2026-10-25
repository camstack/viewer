/**
 * @vitest-environment jsdom
 *
 * A summary rule saved to a hub OLDER than D647, through the real hooks
 * (`useRuleDraft` → `useNcCreateRule` / `useNcUpdateRule` → the bridge stub).
 *
 * Such a hub strips `systemEventDelivery` it does not know and answers success
 * with the rule stored as INSTANT. Two things went wrong there:
 *  - the create had already happened, the save rejected, and the draft stayed
 *    in create mode — a second tap created a SECOND rule;
 *  - switching an instant rule with active hours to Summary sent
 *    `clear: ['schedule']`, which that hub applies: the rule came back instant
 *    all day, and nothing said so.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup } from '@testing-library/react'
import React, { useEffect } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { systemEventDeliveryProblems } from '@camstack/types/client'
import {
  describeSystemEventDeliveryProblem,
  NcRuleSchema as PublishedRuleSchema,
  servedTemplateVars,
} from '@camstack/types'

import { mountScreen } from '../../../../testing/mount.js'
import { resetRuleDrafts } from '../../../../testing/rule-draft-harness.js'
import {
  NcViewerRuleSchema,
  type NcSystemEventDelivery,
  type NcViewerRule,
} from '../../../../data/notification-center.js'
import { NcSummaryNotKeptError } from '../../../../data/nc-errors.js'
import { defaultSummaryDelivery } from '../../../../components/notifications/system-event-delivery.js'
import { useRuleDraft, type UseRuleDraft } from '../use-rule-draft.js'
import { adoptedRuleRoute, executeRuleSave, resolveDraftSource, type RuleSaveRequest } from '../rule-draft-source.js'
import { useNcRuleDraftStore } from '../../../../store/nc-rule-draft-store.js'
import { ruleHref } from '../../../../navigation/rule-routes.js'

vi.mock('../../../../connection/ConnectionProvider.js', async () =>
  (await import('../../../../testing/connection-stub.js')).connectionStubModule(),
)

type Obj = Readonly<Record<string, unknown>>

function field(input: unknown, key: string): unknown {
  return input !== null && typeof input === 'object' ? Reflect.get(input, key) : undefined
}

function isObj(value: unknown): value is Obj {
  return value !== null && typeof value === 'object'
}

const STAMP = { createdBy: 'u1', createdAt: 1, updatedAt: 2, disabledTargetIds: [] }

/** The catalog a hub serves: D647 declares the delivery axis, an older one has none. */
function catalogOf(d647: boolean): unknown {
  const vars = servedTemplateVars()
  return { vars: d647 ? vars : vars.map(({ systemEventDeliveries: _axis, ...rest }) => rest) }
}

interface OldHub {
  readonly creates: Obj[]
  readonly updates: Obj[]
  /** The one rule this hub stores, as it stores it (summary stripped). */
  stored: Obj | null
  readonly d647: boolean
  /** `nc.getTemplateCatalog` fails — the viewer cannot tell what this hub is. */
  readonly catalogFails?: boolean
}

/** A hub older than D647: strips `systemEventDelivery`, applies `clear`. */
function hub(state: OldHub, initial: readonly NcViewerRule[] = []) {
  const strip = (rule: Obj): Obj => Object.fromEntries(Object.entries(rule).filter(([k]) => k !== 'systemEventDelivery'))
  return {
    'auth.me': () => ({ id: 'u1', username: 'operator', isAdmin: true }),
    'addons.custom': (input?: unknown): unknown => {
      const action = field(input, 'action')
      const payload = field(input, 'input')
      if (action === 'nc.listRules') return { rules: state.stored ? [{ ...state.stored, readOnly: false }] : initial }
      if (action === 'nc.listMyTargets') {
        return { targets: [{ id: 'tgt-a', name: 'Phone', kind: 'pushover', addonId: 'notifiers', enabled: true, config: {} }] }
      }
      if (action === 'nc.getConditionCatalog') return { catalog: [] }
      if (action === 'nc.getRuleAi') return { sections: [] }
      if (action === 'nc.getTemplateCatalog') {
        if (state.catalogFails === true) throw new Error('catalog unreachable')
        return catalogOf(state.d647)
      }
      if (action === 'nc.createRule') {
        const rule = field(payload, 'rule')
        if (!isObj(rule)) throw new Error('no rule')
        state.creates.push(rule)
        state.stored = { ...(state.d647 ? rule : strip(rule)), id: `created-${String(state.creates.length)}`, ...STAMP }
        return { rule: state.stored }
      }
      if (action === 'nc.updateRule') {
        if (!isObj(payload)) throw new Error('no payload')
        state.updates.push(payload)
        const patch = field(payload, 'patch')
        const clear = field(payload, 'clear')
        const base = state.stored ?? initial.find((r) => r.id === field(payload, 'ruleId')) ?? {}
        const cleared = Object.fromEntries(
          Object.entries(base).filter(([k]) => !(Array.isArray(clear) && clear.includes(k))),
        )
        const merged = { ...cleared, ...(isObj(patch) ? patch : {}) }
        if (state.d647) {
          // The hub's own judge on the MERGED rule, as `guardPatchSystemEventDelivery`
          // runs it (rule-summary-guard.ts): a stored schedule the patch did
          // not clear stays beside the summary and is refused by name.
          const problems = systemEventDeliveryProblems(PublishedRuleSchema.parse(merged))
          if (problems.length > 0) {
            throw new Error(`rule refused: ${problems.map(describeSystemEventDeliveryProblem).join('; ')}`)
          }
        }
        state.stored = state.d647 ? merged : strip(merged)
        return { rule: state.stored }
      }
      throw new Error(`NOT_FOUND: ${String(action)}`)
    },
  }
}

let latest: UseRuleDraft | null = null

let client: QueryClient | null = null

/** The query client the mounted screen reads through. */
function latestQueryClient(): QueryClient | null {
  return client
}

function Probe({ id, kind }: { readonly id: string; readonly kind?: string }): null {
  const editor = useRuleDraft({ id, kind })
  const queryClient = useQueryClient()
  useEffect(() => {
    latest = editor
    client = queryClient
  })
  return null
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

afterEach(() => {
  cleanup()
  resetRuleDrafts()
  latest = null
})

/** Leave the screen: unmount, and forget what it last rendered. */
function unmount(): void {
  cleanup()
  latest = null
}

async function fillNewSummary(delivery: NcSystemEventDelivery = defaultSummaryDelivery()): Promise<void> {
  await vi.waitFor(() => expect(latest?.status).toBe('ready'))
  await act(async () => {
    latest?.patch({
      name: 'Morning state',
      targetIds: ['tgt-a'],
      conditions: { systemEvent: { kinds: ['device-battery-low'] } },
      systemEventDelivery: delivery,
    })
  })
  await vi.waitFor(() => expect(latest?.valid).toBe(true))
  await vi.waitFor(() => expect(latest?.saveBlock).toBeUndefined())
}

describe('a NEW summary rule on a hub older than D647', () => {
  it('the failed create is ADOPTED: the draft moves to the rule, and the "new" route is left', async () => {
    const state: OldHub = { creates: [], updates: [], stored: null, d647: false }
    mountScreen(React.createElement(Probe, { id: 'new', kind: 'device-events' }), { hub: hub(state) })
    await fillNewSummary()

    // Through useNcCreateRule: the hub stored it as instant, and it is SAID.
    let raised: unknown
    await act(async () => {
      raised = await latest?.save().catch((error: unknown) => error)
    })
    expect(raised).toBeInstanceOf(NcSummaryNotKeptError)
    expect(state.creates).toHaveLength(1)
    // The screen replaces itself with the stored rule's edit route…
    expect(adoptedRuleRoute('new', raised)).toEqual(ruleHref('created-1'))
    expect(adoptedRuleRoute('created-1', raised)).toBeNull()
    expect(adoptedRuleRoute('new', new Error('refused'))).toBeNull()
    // …and the draft is already there, bound to the rule, with its notice.
    const drafts = useNcRuleDraftStore.getState().drafts
    expect(drafts['new:device-events']).toBeUndefined()
    expect(drafts['created-1']).toMatchObject({
      key: 'created-1',
      ruleId: 'created-1',
      adopted: { id: 'created-1' },
      notice: 'v2.nc.rules.editor.summaryNotKept',
    })
    expect(drafts['created-1']?.form.name).toBe('Morning state')
  })

  it('the adopted screen saves as an UPDATE of its own id; a fresh "new" of the same kind is a clean CREATE', async () => {
    const state: OldHub = { creates: [], updates: [], stored: null, d647: false }
    mountScreen(React.createElement(Probe, { id: 'new', kind: 'device-events' }), { hub: hub(state) })
    await fillNewSummary()
    await act(async () => {
      await latest?.save().catch(() => undefined)
    })
    unmount()

    // The edit route the screen replaced itself with.
    mountScreen(React.createElement(Probe, { id: 'created-1' }), { hub: hub(state) })
    await vi.waitFor(() => expect(latest?.status).toBe('ready'))
    expect(latest?.rule?.id).toBe('created-1')
    expect(latest?.draft?.form.name).toBe('Morning state')
    expect(latest?.error).toMatch(/saved as Instant/)
    await vi.waitFor(() => expect(latest?.saveBlock).toBeUndefined())
    await vi.waitFor(() => expect(latest?.valid).toBe(true))
    // Through useNcUpdateRule: same rule, and the old hub is said again.
    await act(async () => {
      await expect(latest?.save()).rejects.toBeInstanceOf(NcSummaryNotKeptError)
    })
    expect(state.creates).toHaveLength(1)
    expect(state.updates.map((u) => u['ruleId'])).toEqual(['created-1'])
    // Back to Instant: the save lands, on the same rule, and ends the draft.
    await act(async () => {
      latest?.patch({ systemEventDelivery: { mode: 'instant' } })
    })
    await act(async () => {
      await latest?.save()
    })
    expect(state.updates.map((u) => u['ruleId'])).toEqual(['created-1', 'created-1'])
    expect(useNcRuleDraftStore.getState().drafts['created-1']).toBeUndefined()
    unmount()

    // A new rule of the same kind: nothing of the adopted one leaks in.
    mountScreen(React.createElement(Probe, { id: 'new', kind: 'device-events' }), { hub: hub(state) })
    await vi.waitFor(() => expect(latest?.status).toBe('ready'))
    expect(latest?.rule).toBeNull()
    expect(latest?.draft?.form.name).toBe('')
    expect(latest?.draft?.adopted).toBeUndefined()
    expect(latest?.error).toBeNull()
    await fillNewSummary({ mode: 'instant' })
    await act(async () => {
      await latest?.save()
    })
    expect(state.creates).toHaveLength(2)
    expect(state.updates).toHaveLength(2)
  })
})

describe('switching an instant rule WITH active hours to Summary', () => {
  const HOURS = { windows: [{ days: [1, 2, 3, 4, 5], startMinute: 540, endMinute: 1080 }] }
  const RULE: NcViewerRule = NcViewerRuleSchema.parse({
    id: 'rule-1',
    name: 'Batteries',
    enabled: true,
    delivery: 'system-event',
    conditions: { systemEvent: { kinds: ['device-battery-low'] } },
    schedule: HOURS,
    targets: [{ targetId: 'tgt-a' }],
    media: { attach: 'none' },
    priority: 3,
    ...STAMP,
    readOnly: false,
  })

  async function switchAndSave(d647: boolean, catalogFails = false): Promise<OldHub> {
    const state: OldHub = { creates: [], updates: [], stored: null, d647, catalogFails }
    mountScreen(React.createElement(Probe, { id: RULE.id }), { hub: hub(state, [RULE]) })
    await vi.waitFor(() => expect(latest?.status).toBe('ready'))
    await vi.waitFor(() => expect(latest?.valid).toBe(true))
    await vi.waitFor(() => expect(latest?.saveBlock).toBeUndefined())
    await settle()
    await act(async () => {
      latest?.patch({ systemEventDelivery: defaultSummaryDelivery() })
    })
    await act(async () => {
      await latest?.save().catch((error: unknown) => {
        refusal = error
      })
    })
    return state
  }

  it('an older hub: no schedule clear is sent, and the active hours SURVIVE', async () => {
    const state = await switchAndSave(false)
    expect(refusal).toBeInstanceOf(NcSummaryNotKeptError)
    expect(state.updates).toHaveLength(1)
    expect(state.updates[0]?.['clear'] ?? []).not.toContain('schedule')
    expect(state.stored?.['schedule']).toEqual(HOURS)
  })

  let refusal: unknown = null
  afterEach(() => {
    refusal = null
  })

  it('a D647 hub whose catalog FAILED: no clear, and the hub refuses by name — nothing lost', async () => {
    const state = await switchAndSave(true, true)
    expect(state.updates).toHaveLength(1)
    expect(state.updates[0]?.['clear'] ?? []).not.toContain('schedule')
    expect(refusal instanceof Error ? refusal.message : '').toMatch(/remove the active-hours schedule/)
    // The stored rule is untouched: instant, with its hours.
    expect(state.stored).toBeNull()
    expect(latest?.error).toMatch(/remove the active-hours schedule/)
    expect(latest?.draft).toBeDefined()
  })

  it('a D647 hub: the schedule is cleared, and the summary is kept', async () => {
    const state = await switchAndSave(true)
    expect(state.updates[0]?.['clear']).toContain('schedule')
    expect(state.stored?.['schedule']).toBeUndefined()
    expect(field(state.stored?.['systemEventDelivery'], 'mode')).toBe('summary')
  })
})

describe('executeRuleSave — the order and the recovery', () => {
  const CREATE: RuleSaveRequest = {
    mode: 'create',
    input: NcViewerRuleSchema.parse({
      id: 'x',
      name: 'n',
      delivery: 'system-event',
      targets: [],
      ...STAMP,
      readOnly: false,
    }),
  }
  const STORED = NcViewerRuleSchema.parse({
    id: 'created-9',
    name: 'n',
    delivery: 'system-event',
    targets: [],
    ...STAMP,
    readOnly: false,
  })

  it('a create the hub stored as instant is ADOPTED and still gets its AI section', async () => {
    const adopted: string[] = []
    const ai: string[] = []
    await expect(
      executeRuleSave(CREATE, {
        create: () => Promise.reject(new NcSummaryNotKeptError(STORED)),
        update: () => Promise.reject(new Error('no update expected')),
        applyAi: async (ruleId) => {
          ai.push(ruleId)
        },
        adopt: (rule) => adopted.push(rule.id),
      }),
    ).rejects.toBeInstanceOf(NcSummaryNotKeptError)
    expect(adopted).toEqual(['created-9'])
    expect(ai).toEqual(['created-9'])
  })

  it('any other refusal adopts nothing and writes no AI section', async () => {
    const calls: string[] = []
    await expect(
      executeRuleSave(CREATE, {
        create: () => Promise.reject(new Error('refused')),
        update: () => Promise.reject(new Error('no update expected')),
        applyAi: async () => {
          calls.push('ai')
        },
        adopt: () => calls.push('adopt'),
      }),
    ).rejects.toThrow('refused')
    expect(calls).toEqual([])
  })

  it('a landed save writes the AI section onto the saved rule', async () => {
    const ai: string[] = []
    await executeRuleSave(CREATE, {
      create: () => Promise.resolve(STORED),
      update: () => Promise.reject(new Error('no update expected')),
      applyAi: async (ruleId) => {
        ai.push(ruleId)
      },
      adopt: () => undefined,
    })
    expect(ai).toEqual(['created-9'])
  })
})

describe('the edit route of an adopted rule', () => {
  const ADOPTED = NcViewerRuleSchema.parse({
    id: 'created-1',
    name: 'n',
    delivery: 'system-event',
    targets: [],
    ...STAMP,
    readOnly: false,
  })

  const AT = 5_000
  const fresh = { rule: ADOPTED, at: AT, seen: false }

  it('opens on the adopted rule while the rules list has not caught up — never "missing"', () => {
    // A list fetched BEFORE the adoption, without the rule: not caught up.
    expect(resolveDraftSource({ id: 'created-1' }, [], false, fresh, AT - 1)).toMatchObject({
      status: 'ready',
      rule: { id: 'created-1' },
    })
    // No list yet.
    expect(resolveDraftSource({ id: 'created-1' }, undefined, false, fresh)).toMatchObject({ status: 'ready' })
    // Without an adoption the answer is unchanged.
    expect(resolveDraftSource({ id: 'created-1' }, [], false, undefined, AT - 1)).toEqual({ status: 'missing' })
    // An adoption of ANOTHER rule never stands in.
    expect(resolveDraftSource({ id: 'other' }, [], false, fresh, AT - 1)).toEqual({ status: 'missing' })
  })

  it('ONE-SHOT: once a list has contained the rule, a list without it is missing', () => {
    const listed = resolveDraftSource({ id: 'created-1' }, [ADOPTED], false, fresh, AT + 1)
    expect(listed).toMatchObject({ status: 'ready', rule: { id: 'created-1' } })
    // Recorded as seen (the hook's effect); the hub then deletes the rule.
    const seen = { ...fresh, seen: true }
    expect(resolveDraftSource({ id: 'created-1' }, [], false, seen, AT + 2)).toEqual({ status: 'missing' })
    // …even a list the resolver would otherwise call stale.
    expect(resolveDraftSource({ id: 'created-1' }, [], false, seen, AT - 1)).toEqual({ status: 'missing' })
  })

  it('a list fetched AFTER the adoption without the rule is an answer: missing', () => {
    expect(resolveDraftSource({ id: 'created-1' }, [], false, fresh, AT + 1)).toEqual({ status: 'missing' })
  })

  it('through the hook: listed once, then deleted on the hub → the open screen says missing', async () => {
    const state: OldHub = { creates: [], updates: [], stored: null, d647: false }
    const stub = hub(state)
    mountScreen(React.createElement(Probe, { id: 'new', kind: 'device-events' }), { hub: stub })
    await fillNewSummary()
    await act(async () => {
      await latest?.save().catch(() => undefined)
    })
    unmount()
    mountScreen(React.createElement(Probe, { id: 'created-1' }), { hub: stub })
    await vi.waitFor(() => expect(latest?.rule?.id).toBe('created-1'))
    await vi.waitFor(() => expect(useNcRuleDraftStore.getState().drafts['created-1']?.adoptedSeen).toBe(true))
    // Deleted on the hub; the list is read again while the screen is open.
    state.stored = null
    await act(async () => {
      await latestQueryClient()?.invalidateQueries()
    })
    await vi.waitFor(() => expect(latest?.status).toBe('missing'))
  })
})
