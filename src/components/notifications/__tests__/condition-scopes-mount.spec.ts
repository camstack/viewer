/**
 * @vitest-environment jsdom
 *
 * The operator's 2026-10-01 rulings on the conditions, mounted through
 * `ConditionForm` (the surface every rule-editor sub-screen draws):
 *  - R14: zones are the classes' control — and the zones are LISTED in both
 *    modes, named `camera:zone`, even while the rule's cameras are "All";
 *  - R8: faces are the same control; no "any of / all of" anywhere;
 *  - R11: the zone crossing is Entering / Leaving / Either with one short
 *    line under it, Entering by default, no "not set";
 *  - R12: the minimum confidence sits under Detections;
 *  - R10: the scene gate says one short line, not the hub's explanation.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen as dom, within } from '@testing-library/react'
import React, { useState } from 'react'
import { NC_CONDITION_CATALOG } from '@camstack/types'

import { mountScreen } from '../../../testing/mount.js'
import { ConditionForm, type ConditionFormScopes } from '../ConditionForm.js'
import { zoneScopeCameraIds } from '../ScopeFields.js'
import { NcConditionDescriptorSchema, type NcConditionDescriptor, type NcConditions } from '../../../data/notification-center.js'
import { ruleScopeDraftOf, type RuleScopeDraft } from '../rule-scope-model.js'

vi.mock('../../../connection/ConnectionProvider.js', async () =>
  (await import('../../../testing/connection-stub.js')).connectionStubModule(),
)

const CAMERAS = [
  { id: 7, name: 'Garden', type: 'camera', isCamera: true, online: true, disabled: false },
  { id: 9, name: 'Front door', type: 'camera', isCamera: true, online: true, disabled: false },
]

function deviceIdOf(input: unknown): unknown {
  return input !== null && typeof input === 'object' && 'deviceId' in input ? input.deviceId : undefined
}

const HUB = {
  'deviceManager.listAll': CAMERAS,
  'zones.listZones': (input?: unknown): unknown =>
    deviceIdOf(input) === 7 ? [{ id: 'z-prato', name: 'Prato' }] : [{ id: 'z-porta', name: 'Porta' }],
}

/** The hub's catalog as the app parses it off the wire. */
function catalogOf(ids: readonly string[]): readonly NcConditionDescriptor[] {
  return NC_CONDITION_CATALOG.filter((d) => ids.includes(d.id)).map((d) => NcConditionDescriptorSchema.parse(d))
}

const ZONE_DESCRIPTORS = catalogOf(['zones', 'zonesExclude'])

function ZoneHarness({ onScope }: { readonly onScope: (next: RuleScopeDraft<string>) => void }) {
  const [draft, setDraft] = useState(ruleScopeDraftOf<string>(undefined, undefined))
  const scopes: ConditionFormScopes = {
    zones: {
      draft,
      exceptOffered: true,
      deviceScope: ruleScopeDraftOf<number>(undefined, undefined),
      onChange: (next) => {
        setDraft(next)
        onScope(next)
      },
    },
  }
  return React.createElement(ConditionForm, {
    catalog: ZONE_DESCRIPTORS,
    delivery: 'immediate',
    kind: 'detection',
    systemFamily: undefined,
    conditions: {},
    savedConditions: {},
    schedule: undefined,
    taxonomy: undefined,
    onConditionsChange: () => undefined,
    onScheduleChange: () => undefined,
    scopes,
  })
}

interface ConditionsHarnessProps {
  readonly ids: readonly string[]
  readonly initial: NcConditions
  readonly onConditions?: (next: NcConditions) => void
}

function ConditionsHarness({ ids, initial, onConditions }: ConditionsHarnessProps) {
  const [conditions, setConditions] = useState(initial)
  return React.createElement(ConditionForm, {
    catalog: catalogOf(ids),
    delivery: 'immediate',
    kind: 'detection',
    systemFamily: undefined,
    conditions,
    savedConditions: initial,
    schedule: undefined,
    taxonomy: undefined,
    onConditionsChange: (next: NcConditions) => {
      setConditions(next)
      onConditions?.(next)
    },
    onScheduleChange: () => undefined,
  })
}

afterEach(() => cleanup())

async function press(el: Element): Promise<void> {
  await act(async () => {
    fireEvent.click(el)
  })
}

describe('zones: the classes control, listed as camera:zone in BOTH modes (R8, R14)', () => {
  it('one field, no "Excluded detection zones" row and no any/all quantifier', () => {
    mountScreen(React.createElement(ZoneHarness, { onScope: () => undefined }), { hub: HUB })
    const field = dom.getByTestId('rule-zone-scope')
    expect(within(field).getByText('All except these')).toBeTruthy()
    expect(dom.queryByText('Excluded detection zones')).toBeNull()
    expect(dom.queryByText('Any of')).toBeNull()
    expect(dom.queryByText('All of')).toBeNull()
  })

  it('every camera\'s zones are offered in Only AND in Except, with the cameras on "All"', async () => {
    mountScreen(React.createElement(ZoneHarness, { onScope: () => undefined }), { hub: HUB })
    for (const mode of ['Only these', 'All except these']) {
      await press(within(dom.getByTestId('rule-zone-scope')).getByText(mode))
      await press(dom.getByTestId('device-picker-add'))
      const sheet = await dom.findByTestId('device-picker-sheet')
      expect(await within(sheet).findByText('Garden:Prato')).toBeTruthy()
      expect(within(sheet).getByText('Front door:Porta')).toBeTruthy()
      await press(within(sheet).getByLabelText('Done'))
    }
  })
})

describe('the zone crossing (R11)', () => {
  it('Entering, Leaving, Either — Entering by default, no "not set", one short line', () => {
    mountScreen(React.createElement(ConditionsHarness, { ids: ['crossing'], initial: {} }), { hub: HUB })
    expect(dom.getByText('Entering')).toBeTruthy()
    expect(dom.getByText('Leaving')).toBeTruthy()
    expect(dom.getByText('Either')).toBeTruthy()
    expect(dom.queryByText(/Not set/)).toBeNull()
    expect(dom.getByText('Entries and ordinary movement; never an exit.')).toBeTruthy()
    // The hub's long description is not drawn under it.
    expect(dom.queryByText(/Direction of the zone crossing/)).toBeNull()
  })

  it('the hub\'s compatibility option {value:"", label:"Entering"} is Entering — never a blank choice', () => {
    const served = NcConditionDescriptorSchema.parse({
      ...NC_CONDITION_CATALOG.find((d) => d.id === 'crossing'),
      options: [
        { value: '', label: 'Entering' },
        { value: 'enter', label: 'Entering' },
        { value: 'exit', label: 'Leaving' },
        { value: 'any', label: 'Entering or leaving' },
      ],
    })
    mountScreen(
      React.createElement(ConditionForm, {
        catalog: [served],
        delivery: 'immediate',
        kind: 'detection',
        systemFamily: undefined,
        conditions: {},
        savedConditions: {},
        schedule: undefined,
        taxonomy: undefined,
        onConditionsChange: () => undefined,
        onScheduleChange: () => undefined,
      }),
      { hub: HUB },
    )
    // Exactly one Entering, three segments, and Entering is the current
    // choice: its line is the one said under the control.
    expect(dom.getAllByText('Entering')).toHaveLength(1)
    expect(dom.getAllByRole('button')).toHaveLength(3)
    expect(dom.getByText('Entries and ordinary movement; never an exit.')).toBeTruthy()
  })

  it('Leaving writes exit; Entering writes nothing (absent IS entering)', async () => {
    const seen: NcConditions[] = []
    mountScreen(
      React.createElement(ConditionsHarness, { ids: ['crossing'], initial: {}, onConditions: (next) => seen.push(next) }),
      { hub: HUB },
    )
    await press(dom.getByText('Leaving'))
    expect(seen.at(-1)?.crossing).toBe('exit')
    expect(dom.getByText('Only an exit from a zone.')).toBeTruthy()
    await press(dom.getByText('Entering'))
    expect(seen.at(-1)).not.toHaveProperty('crossing')
  })
})

describe('the minimum confidence sits under Detections (R12)', () => {
  it('in the same group as the object classes', () => {
    mountScreen(React.createElement(ConditionsHarness, { ids: ['classes', 'minConfidence'], initial: {} }), { hub: HUB })
    const heading = dom.getByText('Detections')
    // The heading is the kit's SectionLabel: its text sits in the label's own
    // row, so the group is one level further up.
    const group = heading.parentElement?.parentElement ?? null
    if (group === null) throw new Error('no group')
    expect(within(group).getByText('Minimum confidence')).toBeTruthy()
    expect(dom.queryByText('Quality')).toBeNull()
  })
})

describe('the scene gate says one short line (R10)', () => {
  it('no explanation block under the field', () => {
    mountScreen(
      React.createElement(ConditionsHarness, {
        ids: ['scene'],
        initial: { scene: { sceneId: 'bin', requiredState: 'matched' } },
      }),
      { hub: HUB },
    )
    expect(dom.getByText(/^Only while scene bin is /)).toBeTruthy()
    expect(dom.queryByText(/tell me about a person at the door/)).toBeNull()
    expect(dom.queryByText(/Pick the scene from the admin UI/)).toBeNull()
  })
})

describe('zoneScopeCameraIds — whose zones the picker lists', () => {
  const all = [7, 9, 11]
  it('an Only device scope: its cameras', () => {
    expect(zoneScopeCameraIds(ruleScopeDraftOf([9], undefined), all)).toEqual([9])
  })
  it('All: every camera', () => {
    expect(zoneScopeCameraIds(ruleScopeDraftOf<number>(undefined, undefined), all)).toEqual(all)
  })
  it('All except: every camera but the excluded ones', () => {
    expect(zoneScopeCameraIds(ruleScopeDraftOf<number>(undefined, [11]), all)).toEqual([7, 9])
  })
})
