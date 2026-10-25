/**
 * @vitest-environment jsdom
 *
 * A `clear` the hub did not apply is a FAILED save (final review I4).
 *
 * An addon older than the `clear` it is sent parses the input with a plain
 * `z.object`, strips the key, and answers success — and the emptied caption
 * comes back on the next read. The phone already holds the rule the hub
 * returned; a cleared key still on it means the hub is too old, and the editor
 * must stay open with its draft rather than report a save that did not happen.
 *
 * Checked for all three families: timelapse and digest (the skew the review
 * found) and the detection-rule family (`nc.updateRule`, Plan A), which returns
 * its rule too.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen as dom } from '@testing-library/react'
import React, { useEffect } from 'react'

import { mountScreen } from '../../testing/mount.js'
import {
  useNcRuleAiSections,
  useNcRules,
  useNcSetRuleAi,
  useNcSummaryRules,
  useNcTimelapseRules,
  useNcUpdateRule,
  useNcUpsertSummaryRule,
  useNcUpsertTimelapseRule,
} from '../use-notification-center.js'
import { hubCalls } from '../../testing/hub-stub.js'
import { NcHubTooOldToClearError, assertClearsLanded, ncNotConnectedError } from '../nc-errors.js'
import { useNcErrorText, type NcErrorText } from '../../components/notifications/use-nc-error-text.js'
import { routerCalls } from '../../testing/native-stubs/expo-router.js'
import { TimelapseEditorScreen } from '../../screens/notifications/rule-editor/TimelapseEditorScreen.js'

vi.mock('../../connection/ConnectionProvider.js', async () =>
  (await import('../../testing/connection-stub.js')).connectionStubModule(),
)

vi.mock('expo-router/react-navigation', () => ({ usePreventRemove: (): void => undefined }))

const TIMELAPSE = {
  id: 'tl1',
  name: 'Notte',
  enabled: true,
  deviceIds: [101],
  schedule: { windows: [{ days: [0, 1, 2, 3, 4, 5, 6], startMinute: 1320, endMinute: 360 }] },
  cadenceSec: 15,
  framerate: 10,
  previewMode: 'image',
  targets: [{ targetId: 't1' }],
  priority: 3,
  createdBy: 'admin',
  createdAt: 1,
  updatedAt: 2,
  previewText: 'Notte {{camera}}',
}

const SUMMARY = {
  id: 'sum1',
  name: 'Notte',
  enabled: true,
  deviceIds: [101],
  window: { kind: 'motion', quietSeconds: 120, maxWindowSeconds: 3600 },
  targets: [{ targetId: 't1' }],
  priority: 3,
  maxTiles: 9,
  maxAiImages: 6,
  rank: 'importance',
  subject: 'tracks',
  barrierSeconds: 120,
  captions: 'all',
  captionText: 'Notte {{from}}',
  deliverEmpty: false,
  createdBy: 'admin',
  createdAt: 1,
  updatedAt: 2,
}

const RULE = {
  id: 'rule-1',
  name: 'Front door',
  enabled: true,
  delivery: 'immediate',
  conditions: { classes: ['person'] },
  targets: [{ targetId: 't1' }],
  media: { attach: 'best' },
  priority: 3,
  createdBy: 'me',
  createdAt: 10,
  updatedAt: 20,
  disabledTargetIds: [],
  template: { title: 'Hello' },
}

function actionOf(input: unknown): unknown {
  return input !== null && typeof input === 'object' && 'action' in input ? input.action : undefined
}

/** A hub that answers every upsert with the rule UNCHANGED — the old addon. */
function oldHub(): Readonly<Record<string, unknown>> {
  return {
    'addons.custom': (input?: unknown): unknown => {
      const action = actionOf(input)
      if (action === 'nc.upsertTimelapseRule') return { rule: TIMELAPSE }
      if (action === 'nc.upsertSummaryRule') return { rule: SUMMARY }
      if (action === 'nc.updateRule') return { rule: RULE }
      throw new Error(`NOT_FOUND: ${String(action)}`)
    },
  }
}

/** A hub that applied the clear — the key is gone from what it returns. */
function currentHub(): Readonly<Record<string, unknown>> {
  const { previewText: _p, ...timelapse } = TIMELAPSE
  const { captionText: _c, ...summary } = SUMMARY
  const { template: _t, ...rule } = RULE
  return {
    'addons.custom': (input?: unknown): unknown => {
      const action = actionOf(input)
      if (action === 'nc.upsertTimelapseRule') return { rule: timelapse }
      if (action === 'nc.upsertSummaryRule') return { rule: summary }
      if (action === 'nc.updateRule') return { rule }
      throw new Error(`NOT_FOUND: ${String(action)}`)
    },
  }
}

interface Mutations {
  timelapse: ReturnType<typeof useNcUpsertTimelapseRule> | null
  summary: ReturnType<typeof useNcUpsertSummaryRule> | null
  rule: ReturnType<typeof useNcUpdateRule> | null
}
const m: Mutations = { timelapse: null, summary: null, rule: null }

function Probe(): null {
  const timelapse = useNcUpsertTimelapseRule()
  const summary = useNcUpsertSummaryRule()
  const rule = useNcUpdateRule()
  useEffect(() => {
    m.timelapse = timelapse
    m.summary = summary
    m.rule = rule
  })
  return null
}

async function mounted(hub: Readonly<Record<string, unknown>>): Promise<Mutations> {
  mountScreen(React.createElement(Probe), { hub })
  await vi.waitFor(() => expect(m.rule).not.toBeNull())
  return m
}

afterEach(() => {
  cleanup()
  m.timelapse = null
  m.summary = null
  m.rule = null
})

describe('assertClearsLanded', () => {
  it('names every cleared key the rule still carries', () => {
    expect(() => assertClearsLanded({ previewText: 'x', minDwellSec: 2 }, ['previewText', 'minDwellSec', 'template'])).toThrow(
      NcHubTooOldToClearError,
    )
    try {
      assertClearsLanded({ previewText: 'x' }, ['previewText', 'template'])
    } catch (error) {
      expect(error instanceof NcHubTooOldToClearError ? error.keys : []).toEqual(['previewText'])
    }
  })

  it('passes when every cleared key is gone, and when nothing was cleared', () => {
    expect(() => assertClearsLanded({}, ['previewText'])).not.toThrow()
    expect(() => assertClearsLanded({ previewText: 'x' }, undefined)).not.toThrow()
  })
})

describe('a clear the hub silently ignored rejects the save (I4)', () => {
  it('timelapse', async () => {
    const hooks = await mounted(oldHub())
    await expect(
      hooks.timelapse?.mutateAsync({ ruleId: 'tl1', patch: { name: 'Notte' }, clear: ['previewText'] }),
    ).rejects.toBeInstanceOf(NcHubTooOldToClearError)
  })

  it('digest', async () => {
    const hooks = await mounted(oldHub())
    await expect(
      hooks.summary?.mutateAsync({ ruleId: 'sum1', patch: { name: 'Notte' }, clear: ['captionText'] }),
    ).rejects.toBeInstanceOf(NcHubTooOldToClearError)
  })

  it('detection rule (nc.updateRule)', async () => {
    const hooks = await mounted(oldHub())
    await expect(
      hooks.rule?.mutateAsync({ ruleId: 'rule-1', patch: { name: 'Front door' }, clear: ['template'] }),
    ).rejects.toBeInstanceOf(NcHubTooOldToClearError)
  })

  it('a hub that applied the clears saves normally', async () => {
    const hooks = await mounted(currentHub())
    await expect(
      hooks.timelapse?.mutateAsync({ ruleId: 'tl1', patch: { name: 'Notte' }, clear: ['previewText'] }),
    ).resolves.toMatchObject({ id: 'tl1' })
    await expect(
      hooks.summary?.mutateAsync({ ruleId: 'sum1', patch: { name: 'Notte' }, clear: ['captionText'] }),
    ).resolves.toMatchObject({ id: 'sum1' })
    await expect(
      hooks.rule?.mutateAsync({ ruleId: 'rule-1', patch: { name: 'Front door' }, clear: ['template'] }),
    ).resolves.toMatchObject({ id: 'rule-1' })
  })
})

describe('the editor stays open, draft intact, and says why in the app language (I4, m6)', () => {
  it('timelapse editor over an old hub: the emptied caption is not reported saved', async () => {
    const hub = {
      'auth.me': { id: 'admin', username: 'admin', isAdmin: true },
      'addons.custom': (input?: unknown): unknown => {
        const action = actionOf(input)
        if (action === 'nc.listTimelapseRules') return { rules: [{ ...TIMELAPSE, readOnly: false }] }
        if (action === 'nc.listMyTargets') {
          return { targets: [{ id: 't1', name: 'Phone', kind: 'pushover', addonId: 'notifiers', enabled: true, config: {} }] }
        }
        if (action === 'nc.upsertTimelapseRule') return { rule: TIMELAPSE }
        throw new Error(`NOT_FOUND: ${String(action)}`)
      },
    }
    mountScreen(React.createElement(TimelapseEditorScreen, { id: 'tl1' }), { hub })
    const caption = await dom.findByDisplayValue('Notte {{camera}}')
    await vi.waitFor(() => expect(dom.getByText('Save changes').closest('[aria-disabled="true"]')).toBeNull())
    fireEvent.change(caption, { target: { value: '' } })
    await act(async () => {
      fireEvent.click(dom.getByText('Save changes'))
      await Promise.resolve()
    })
    await dom.findByText(/too old to clear that field/)
    expect(routerCalls().some((call) => call.kind === 'back')).toBe(false)
    // The draft is the operator's edit, not a reseed from the stored rule.
    expect(dom.queryByDisplayValue('Notte {{camera}}')).toBeNull()
  })
})

describe('useNcErrorText (m6)', () => {
  const seen: { text: NcErrorText | null } = { text: null }
  function TextProbe(): null {
    const text = useNcErrorText()
    useEffect(() => {
      seen.text = text
    })
    return null
  }

  it('translates the app\'s own errors and keeps a hub refusal verbatim', async () => {
    mountScreen(React.createElement(TextProbe))
    await vi.waitFor(() => expect(seen.text).not.toBeNull())
    expect(seen.text?.(ncNotConnectedError())).toBe('Not connected to the hub. Reconnect and try again.')
    expect(seen.text?.(new NcHubTooOldToClearError(['previewText']))).toMatch(/too old to clear/)
    expect(seen.text?.(new Error('camera 102: recording is not enabled'))).toBe('camera 102: recording is not enabled')
    expect(seen.text?.(null)).toBeNull()
  })
})

describe('a refused clear still refreshes the lists — the hub DID write the rest (re-review N1)', () => {
  // `NcHubTooOldToClearError` is raised AFTER the hub stored the patch. With
  // the invalidation only in `onSuccess`, the list kept showing the pre-save
  // rule until its staleTime ran out.
  function ListsProbe(): null {
    useNcRules()
    useNcTimelapseRules()
    useNcSummaryRules()
    const timelapse = useNcUpsertTimelapseRule()
    const summary = useNcUpsertSummaryRule()
    const rule = useNcUpdateRule()
    useEffect(() => {
      m.timelapse = timelapse
      m.summary = summary
      m.rule = rule
    })
    return null
  }

  function listingHub(): Readonly<Record<string, unknown>> {
    const inner = oldHub()['addons.custom']
    return {
      'addons.custom': (input?: unknown): unknown => {
        const action = actionOf(input)
        if (action === 'nc.listRules') return { rules: [] }
        if (action === 'nc.listTimelapseRules') return { rules: [] }
        if (action === 'nc.listSummaryRules') return { rules: [], canAuthor: true }
        return typeof inner === 'function' ? inner(input) : undefined
      },
    }
  }

  function listCalls(action: string): number {
    return hubCalls().filter((call) => actionOf(call.input) === action).length
  }

  it.each([
    ['timelapse', 'nc.listTimelapseRules'],
    ['summary', 'nc.listSummaryRules'],
    ['rule', 'nc.listRules'],
  ] as const)('%s', async (family, listAction) => {
    mountScreen(React.createElement(ListsProbe), { hub: listingHub() })
    await vi.waitFor(() => expect(listCalls(listAction)).toBe(1))
    const run =
      family === 'timelapse'
        ? m.timelapse?.mutateAsync({ ruleId: 'tl1', patch: { name: 'Notte' }, clear: ['previewText'] })
        : family === 'summary'
          ? m.summary?.mutateAsync({ ruleId: 'sum1', patch: { name: 'Notte' }, clear: ['captionText'] })
          : m.rule?.mutateAsync({ ruleId: 'rule-1', patch: { name: 'Front door' }, clear: ['template'] })
    await expect(run).rejects.toBeInstanceOf(NcHubTooOldToClearError)
    await vi.waitFor(() => expect(listCalls(listAction)).toBe(2))
  })
})

describe('a failed AI-section write still refreshes the sections (re-review N1)', () => {
  const ai: { set: ReturnType<typeof useNcSetRuleAi> | null } = { set: null }
  function AiProbe(): null {
    useNcRuleAiSections()
    const set = useNcSetRuleAi()
    useEffect(() => {
      ai.set = set
    })
    return null
  }

  it('re-reads nc.getRuleAi after a refused write', async () => {
    const hub = {
      'addons.custom': (input?: unknown): unknown => {
        const action = actionOf(input)
        if (action === 'nc.getRuleAi') return { sections: [] }
        if (action === 'nc.setRuleAi') throw new Error('reply lost after the write')
        throw new Error(`NOT_FOUND: ${String(action)}`)
      },
    }
    const reads = (): number => hubCalls().filter((call) => actionOf(call.input) === 'nc.getRuleAi').length
    mountScreen(React.createElement(AiProbe), { hub })
    await vi.waitFor(() => expect(reads()).toBe(1))
    await expect(ai.set?.mutateAsync({ ruleId: 'rule-1', ai: null })).rejects.toThrow(/reply lost/)
    await vi.waitFor(() => expect(reads()).toBe(2))
  })
})
