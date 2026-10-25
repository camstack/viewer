/**
 * @vitest-environment jsdom
 *
 * The AI section, in the real editor — the Notification sub-screen, fed by the
 * real draft hook (`useRuleDraft`) over the real store.
 *
 * Three claims a pure spec cannot make, because all three are about what the
 * mounted form PUTS ON SCREEN:
 *
 *  - a system-event rule gets no section. `ruleAiApplies` returning `false` is
 *    a predicate; only the mounted screen can say the operator is not looking
 *    at a switch. Asserted beside its positive control in the same file and the
 *    same way — an "absent" with nothing to prove the harness would have shown
 *    it present is an assertion that passes when the screen is blank.
 *  - the occupancy default question is IN THE BOX and editable. The whole
 *    reason the box is pre-filled is that the operator has to see what they are
 *    changing.
 *  - the word-cap row shows the number derived from the rule's TARGET while
 *    nothing is authored, rather than an empty control. That number travels
 *    from `nc.listTargetKinds` (`caps.bodyMaxLen`) through the join in
 *    `ruleAiTargetWordDefault`, and the join is exactly what a pure spec has to
 *    be handed rather than fetch.
 *
 * Everything below the wire is real: the data hooks, the query client, i18n
 * over the shipped locales, the theme. Only `addons.custom` is faked.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, within, type RenderResult } from '@testing-library/react'
import React from 'react'

import { mountScreen } from '../../../testing/mount.js'
import { RULE_AI_SECTION_TEST_ID } from '../../../components/notifications/RuleAiSection.js'
import { NC_RULE_AI_DEFAULT_PROMPT } from '../../../components/notifications/rule-ai-form.js'
import {
  NcViewerRuleSchema,
  type NcConditions,
  type NcViewerRule,
} from '../../../data/notification-center.js'
import { RuleDraftHarness, resetRuleDrafts, withRuleList } from '../../../testing/rule-draft-harness.js'

vi.mock('../../../connection/ConnectionProvider.js', async () =>
  (await import('../../../testing/connection-stub.js')).connectionStubModule(),
)

/** The harness pins the locale to `en` (`native-stubs/expo-localization.ts`). */
const AI_TOGGLE_LABEL = 'Describe with AI'
const LENGTH_LABEL = 'Length'
/** Rendered by `TargetPicker` once `nc.listMyTargets` has answered — the
 *  readiness node every assertion below waits for, so a negative claim can
 *  never be "the queries had not landed yet". */
const TARGET_NAME = 'Phone (pushover)'

/** `pushover` declares a 1024-character body, and the hub's curve turns that
 *  into 24 words. The number is asserted, not the curve — the curve itself is
 *  pinned against the hub's published table in `rule-ai-form.spec.ts`. */
const PUSHOVER_WORDS = '24'

const TARGETS = [
  {
    id: 'tgt-a',
    name: TARGET_NAME,
    kind: 'pushover',
    addonId: 'notifiers',
    enabled: true,
    config: {},
  },
]

const TARGET_KINDS = [
  {
    kind: 'pushover',
    label: 'Pushover',
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
      sound: true,
      ttl: false,
      bodyMaxLen: 1024,
    },
  },
]

/** One `nc.*` action → its payload. Anything unlisted behaves as a hub that
 *  does not have it (the bridge throws), which is the older-hub case. */
const NC_RESPONSES: Readonly<Record<string, unknown>> = {
  'nc.getConditionCatalog': { catalog: [] },
  'nc.listMyTargets': { targets: TARGETS },
  'nc.listTargetKinds': { kinds: TARGET_KINDS },
  // No section on disk for either rule — the ordinary case, and the one where
  // every default has to come from somewhere other than a stored value.
  'nc.getRuleAi': { sections: [] },
  'nc.listAiProfiles': { profiles: [{ id: 'p1', name: 'Local vision', model: 'qwen3-vl-8b' }] },
}

/** Read `{ action }` off the bridge input without a cast. */
function actionOf(input: unknown): string {
  if (input === null || typeof input !== 'object' || !('action' in input)) return ''
  const action: unknown = { ...input }['action']
  return typeof action === 'string' ? action : ''
}

const HUB = {
  'addons.custom': (input?: unknown): unknown => {
    const action = actionOf(input)
    if (!Object.prototype.hasOwnProperty.call(NC_RESPONSES, action)) {
      throw new Error(`NOT_FOUND: no nc action "${action}" on this hub`)
    }
    return NC_RESPONSES[action]
  },
}

/** Parsed through the viewer's own mirror, so a fixture the app could not read
 *  fails here rather than rendering an editor nobody could have opened. */
function makeRule(overrides: Record<string, unknown>): NcViewerRule {
  return NcViewerRuleSchema.parse({
    id: 'rule-1',
    name: 'Front door',
    enabled: true,
    delivery: 'immediate',
    conditions: {},
    targets: [{ targetId: 'tgt-a' }],
    media: { attach: 'best' },
    priority: 3,
    createdBy: 'me',
    createdAt: 10,
    updatedAt: 20,
    disabledTargetIds: [],
    readOnly: false,
    ...overrides,
  })
}

const SYSTEM_CONDITIONS: NcConditions = { systemEvent: { kinds: ['device-offline'] } }

/** Mount the editor on a rule and wait until its queries have landed. */
async function openEditor(rule: NcViewerRule): Promise<RenderResult> {
  const screen = mountScreen(React.createElement(RuleDraftHarness, { ruleId: rule.id }), {
    hub: withRuleList(rule, actionOf, HUB['addons.custom']),
  })
  await screen.findByText(TARGET_NAME)
  return screen
}

/**
 * Switch the section on.
 *
 * The fields are HIDDEN while it is off rather than greyed out — a disabled
 * prompt box invites typing into it — so a spec about what they show has to
 * press the switch, which is also the only place that press is exercised. The
 * switch is found INSIDE the section's subtree: the editor renders several
 * others (the media toggles), and `getByRole('switch')` over the whole screen
 * would be ambiguous today and silently the wrong one tomorrow.
 */
async function enableAi(screen: RenderResult): Promise<void> {
  const section = screen.getByTestId(RULE_AI_SECTION_TEST_ID)
  await act(async () => {
    fireEvent.click(within(section).getByRole('switch'))
  })
}

afterEach(() => {
  cleanup()
  resetRuleDrafts()
})

describe('the AI section is offered only to a rule that carries a picture', () => {
  it('is ABSENT on a system-event rule', async () => {
    const screen = await openEditor(
      makeRule({ delivery: 'system-event', conditions: SYSTEM_CONDITIONS, media: { attach: 'none' } }),
    )
    expect(screen.queryByTestId(RULE_AI_SECTION_TEST_ID)).toBeNull()
    expect(screen.queryByText(AI_TOGGLE_LABEL)).toBeNull()
  })

  it('is PRESENT on an ordinary detection rule — the same harness, same wait', async () => {
    // The positive control for the assertion above. Without it, "absent" is
    // satisfied by a screen that failed to render anything at all.
    const screen = await openEditor(makeRule({ conditions: { classes: ['person'] } }))
    expect(screen.queryByTestId(RULE_AI_SECTION_TEST_ID)).not.toBeNull()
    expect(screen.queryByText(AI_TOGGLE_LABEL)).not.toBeNull()
  })
})

describe('what the section shows before the operator has authored anything', () => {
  /** An occupancy rule: the condition is what makes it that kind. */
  const OCCUPANCY = makeRule({
    delivery: 'device-event',
    conditions: { occupancy: { op: '>=', count: 2, sustainSeconds: 15 } },
  })

  it('pre-fills the prompt with the OCCUPANCY question, in an editable box', async () => {
    const screen = await openEditor(OCCUPANCY)
    await enableAi(screen)
    const box = screen.getByDisplayValue(NC_RULE_AI_DEFAULT_PROMPT.occupancy)
    expect(box.hasAttribute('readonly')).toBe(false)
    expect(box.hasAttribute('disabled')).toBe(false)

    // And it really is the operator's box: typing replaces the default rather
    // than being rejected or appended to.
    await act(async () => {
      fireEvent.change(box, { target: { value: 'Count only the delivery vans.' } })
    })
    expect(screen.getByDisplayValue('Count only the delivery vans.')).not.toBeNull()
    expect(screen.queryByDisplayValue(NC_RULE_AI_DEFAULT_PROMPT.occupancy)).toBeNull()
  })

  it('states, beside it, that the operator’s question cannot change the answer’s format', async () => {
    // The occupancy answer stays `{confirmed, count, reason}` and the hub
    // composes the verdict from it. Somebody who types "reply in prose" and is
    // told nothing reports the feature as broken when the parse fails.
    const screen = await openEditor(OCCUPANCY)
    await enableAi(screen)
    expect(screen.queryByText(/cannot change the answer/)).not.toBeNull()
  })

  it('shows the TARGET-derived word cap rather than an empty control', async () => {
    const screen = await openEditor(OCCUPANCY)
    await enableAi(screen)
    const section = screen.getByTestId(RULE_AI_SECTION_TEST_ID)
    const lengthRow = within(section).getByText(LENGTH_LABEL).parentElement
    expect(lengthRow?.textContent).toContain(PUSHOVER_WORDS)
    // And the hint names the same number, so the row does not read as an
    // authored choice the operator made.
    expect(within(section).queryByText(new RegExp(`targets give ${PUSHOVER_WORDS}`))).not.toBeNull()
  })
})
