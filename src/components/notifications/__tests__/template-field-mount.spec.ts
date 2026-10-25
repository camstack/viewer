/**
 * @vitest-environment jsdom
 *
 * The placeholder picker, mounted (Task 6, Plan C).
 *
 * The pure helpers are pinned in `template-field.spec.ts`; what only a mount
 * can say is what the operator SEES and where a tapped token LANDS:
 *
 *  - an unanswered catalog (`vars === undefined`) shows no chips and no
 *    warning — never "no variables", which would be a claim of absence from a
 *    query that has not answered (D315);
 *  - a chip inserts at the CARET, not at the end, and the caret then sits
 *    after the token;
 *  - a name the hub would print empty is named under the field, braces intact
 *    (i18next must not escape or re-interpolate them);
 *  - in the real rule editor (the Notification sub-screen over a real draft)
 *    the chips follow the rule's kind, and the preview renders what the hub
 *    answered.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen as dom } from '@testing-library/react'
import React, { useState } from 'react'

import { mountScreen } from '../../../testing/mount.js'
import {
  NcViewerRuleSchema,
  type NcTemplateVarDescriptor,
  type NcViewerRule,
} from '../../../data/notification-center.js'
import { TemplateField } from '../TemplateField.js'
import { RuleDraftHarness, resetRuleDrafts, withRuleList } from '../../../testing/rule-draft-harness.js'

vi.mock('../../../connection/ConnectionProvider.js', async () =>
  (await import('../../../testing/connection-stub.js')).connectionStubModule(),
)

const CAMERA: NcTemplateVarDescriptor = {
  name: 'camera',
  label: 'Camera (hub)',
  example: 'Front door',
  group: 'subject',
  families: ['rule', 'timelapse', 'summary'],
}
const TIME: NcTemplateVarDescriptor = {
  name: 'time',
  label: 'Time',
  example: '14:02',
  group: 'time',
  families: ['rule'],
}
const EVENT_KIND: NcTemplateVarDescriptor = {
  name: 'eventKind',
  label: 'Event kind',
  example: 'device-offline',
  group: 'system',
  families: ['rule'],
  kinds: ['system'],
}
const VARS: readonly NcTemplateVarDescriptor[] = [CAMERA, TIME, EVENT_KIND]

interface HarnessProps {
  readonly initial: string
  readonly vars: readonly NcTemplateVarDescriptor[] | undefined
}

/** The field is controlled; this owns the value the way the editor does. */
function Harness({ initial, vars }: HarnessProps): React.ReactElement {
  const [value, setValue] = useState(initial)
  return React.createElement(TemplateField, {
    label: 'Body',
    value,
    onChangeText: setValue,
    vars,
    multiline: true,
    testID: 'tf',
  })
}

function inputOf(): HTMLInputElement | HTMLTextAreaElement {
  const node = dom.getByTestId('tf-input')
  if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) return node
  throw new Error('tf-input is not a text control')
}

afterEach(() => {
  cleanup()
  resetRuleDrafts()
})

describe('TemplateField', () => {
  it('an UNANSWERED catalog shows no chips, no "no variables", and no warning', () => {
    mountScreen(React.createElement(Harness, { initial: '{{tiles}}', vars: undefined }))
    expect(dom.queryByTestId('tf-chip-camera')).toBeNull()
    expect(dom.queryByText('No variables for this field.')).toBeNull()
    expect(dom.queryByTestId('tf-unknown')).toBeNull()
  })

  it('an ANSWERED empty catalog says so', () => {
    mountScreen(React.createElement(Harness, { initial: '', vars: [] }))
    expect(dom.queryByText('No variables for this field.')).not.toBeNull()
  })

  it('labels a chip by name from the locale, not with the hub label', () => {
    mountScreen(React.createElement(Harness, { initial: '', vars: VARS }))
    // Locale label first, then the token itself as the secondary line.
    expect(dom.getByTestId('tf-chip-camera').textContent).toBe('Camera{{camera}}')
  })

  it('a chip inserts at the CARET and leaves the caret after the token', async () => {
    mountScreen(React.createElement(Harness, { initial: 'Hello  world', vars: VARS }))
    const input = inputOf()
    await act(async () => {
      input.setSelectionRange(6, 6)
      fireEvent.select(input)
    })
    await act(async () => {
      fireEvent.click(dom.getByTestId('tf-chip-camera'))
    })
    expect(inputOf().value).toBe('Hello {{camera}} world')
    expect(inputOf().selectionStart).toBe(16)
    expect(inputOf().selectionEnd).toBe(16)
  })

  it('names what the hub would print empty, braces intact', () => {
    mountScreen(React.createElement(Harness, { initial: 'At {{time}}: {{tiles}}', vars: VARS }))
    expect(dom.getByTestId('tf-unknown').textContent).toBe(
      'These placeholders will be empty in this notification: {{tiles}}',
    )
  })
})

// ── In the real rule editor ───────────────────────────────────────────────

const TARGET_NAME = 'Phone (pushover)'

const NC_RESPONSES: Readonly<Record<string, unknown>> = {
  'nc.getConditionCatalog': { catalog: [] },
  'nc.listMyTargets': {
    targets: [
      { id: 'tgt-a', name: TARGET_NAME, kind: 'pushover', addonId: 'notifiers', enabled: true, config: {} },
    ],
  },
  'nc.listTargetKinds': { kinds: [] },
  'nc.getRuleAi': { sections: [] },
  'nc.listAiProfiles': { profiles: [] },
  'nc.getTemplateCatalog': { vars: VARS },
  'nc.previewTemplate': { title: null, body: 'Front door at 14:02', unknown: [] },
}

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

function makeRule(overrides: Record<string, unknown>): NcViewerRule {
  return NcViewerRuleSchema.parse({
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
    ...overrides,
  })
}

async function openEditor(rule: NcViewerRule): Promise<void> {
  mountScreen(React.createElement(RuleDraftHarness, { ruleId: rule.id }), {
    hub: withRuleList(rule, actionOf, HUB['addons.custom']),
  })
  await dom.findByText(TARGET_NAME)
  await dom.findByTestId('rule-template-body-chip-camera')
}

describe('the rule editor template fields', () => {
  it('a detection rule is not offered a system-only variable', async () => {
    await openEditor(makeRule({}))
    expect(dom.queryByTestId('rule-template-title-chip-camera')).not.toBeNull()
    expect(dom.queryByTestId('rule-template-body-chip-eventKind')).toBeNull()
  })

  it('a system rule is — the chips follow the kind', async () => {
    await openEditor(
      makeRule({
        delivery: 'system-event',
        conditions: { systemEvent: { kinds: ['device-offline'] } },
        media: { attach: 'none' },
      }),
    )
    expect(dom.queryByTestId('rule-template-body-chip-eventKind')).not.toBeNull()
  })

  it('renders the hub preview of the draft', async () => {
    await openEditor(makeRule({ template: { body: '{{camera}} at {{time}}' } }))
    expect(await dom.findByText('Front door at 14:02', undefined, { timeout: 3000 })).not.toBeNull()
    expect(dom.queryByText('Preview (example values)')).not.toBeNull()
  })

  it('the old "Supports {{var}}" hint is gone', async () => {
    await openEditor(makeRule({}))
    expect(dom.queryByText(/Supports/)).toBeNull()
  })
})
