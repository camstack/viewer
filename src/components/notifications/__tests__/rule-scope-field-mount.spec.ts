/**
 * @vitest-environment jsdom
 *
 * D640 + D641 mounted through `ConditionForm`, the surface both rule-editor
 * sub-screens draw.
 *
 * What only a mount can say:
 *  - devices and devicesExclude are ONE field: one pre-selector, one picker,
 *    and no second "Excluded devices" row;
 *  - "All except these" is drawn only when the hub serves the exclusion;
 *  - a legacy both-lists rule shows its exclusions with "Remove exclusions",
 *    and the press removes them;
 *  - what Save will clear after a mode switch is SAID;
 *  - "Notify when" appears only when offered, a choice writes the condition
 *    ("both" deletes it), and the alarm rule that can never fire is warned.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen as dom } from '@testing-library/react'
import React, { useState } from 'react'
import { NC_SENSOR_TRANSITION_NEVER_FIRES_WARNING } from '@camstack/types'

import { mountScreen } from '../../../testing/mount.js'
import { ConditionForm, type ConditionFormScopes } from '../ConditionForm.js'
import type { NcConditionDescriptor, NcConditions } from '../../../data/notification-center.js'
import { ruleScopeDraftOf, type RuleScopeDraft } from '../rule-scope-model.js'

vi.mock('../../../connection/ConnectionProvider.js', async () =>
  (await import('../../../testing/connection-stub.js')).connectionStubModule(),
)

const DEVICES: NcConditionDescriptor = {
  id: 'devices',
  group: 'scope',
  label: 'Devices',
  valueType: 'deviceIdList',
  operator: 'in',
  appliesTo: ['track-end', 'device-event'],
  phase: 'P1',
}
const DEVICES_EXCLUDE: NcConditionDescriptor = {
  id: 'devicesExclude',
  group: 'scope',
  label: 'Excluded devices',
  valueType: 'deviceIdExcludeList',
  operator: 'notIn',
  appliesTo: ['track-end', 'device-event'],
  phase: 'P1',
}
const SENSOR_KINDS: NcConditionDescriptor = {
  id: 'sensorKinds',
  group: 'device',
  label: 'Sensor kinds',
  valueType: 'stringList',
  operator: 'in',
  appliesTo: ['device-event'],
  phase: 'P2',
}
const TRANSITION: NcConditionDescriptor = {
  id: 'sensorTransition',
  group: 'device',
  label: 'Notify when',
  valueType: 'sensorTransition',
  operator: 'in',
  appliesTo: ['device-event'],
  phase: 'P2',
}

const HUB = { 'deviceManager.listAll': [] }

interface ScopeHarnessProps {
  readonly catalog: readonly NcConditionDescriptor[]
  readonly initial: RuleScopeDraft<number>
  readonly exceptOffered: boolean
  readonly onScope?: (next: RuleScopeDraft<number>) => void
}

function ScopeHarness({ catalog, initial, exceptOffered, onScope }: ScopeHarnessProps): React.ReactElement {
  const [draft, setDraft] = useState(initial)
  const scopes: ConditionFormScopes = {
    devices: {
      draft,
      exceptOffered,
      onChange: (next) => {
        setDraft(next)
        onScope?.(next)
      },
    },
  }
  return React.createElement(ConditionForm, {
    catalog,
    delivery: 'track-end',
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
  readonly initial: NcConditions
  readonly onConditions: (next: NcConditions) => void
}

function ConditionsHarness({ initial, onConditions }: ConditionsHarnessProps): React.ReactElement {
  const [conditions, setConditions] = useState(initial)
  return React.createElement(ConditionForm, {
    catalog: [SENSOR_KINDS, TRANSITION],
    delivery: 'device-event',
    kind: 'sensor',
    systemFamily: undefined,
    conditions,
    savedConditions: initial,
    schedule: undefined,
    taxonomy: undefined,
    onConditionsChange: (next: NcConditions) => {
      setConditions(next)
      onConditions(next)
    },
    onScheduleChange: () => undefined,
  })
}

afterEach(() => cleanup())

async function press(label: string): Promise<void> {
  await act(async () => {
    fireEvent.click(dom.getByText(label))
  })
}

describe('the device scope is ONE field (D641)', () => {
  it('draws one pre-selector and no second "Excluded devices" row', () => {
    mountScreen(
      React.createElement(ScopeHarness, {
        catalog: [DEVICES, DEVICES_EXCLUDE],
        initial: ruleScopeDraftOf<number>(undefined, undefined),
        exceptOffered: true,
      }),
      { hub: HUB },
    )
    expect(dom.getByText('All')).toBeTruthy()
    expect(dom.getByText('Only these')).toBeTruthy()
    expect(dom.getByText('All except these')).toBeTruthy()
    expect(dom.queryByText('Excluded devices')).toBeNull()
  })

  it('does not offer "All except these" where the hub does not serve it', () => {
    mountScreen(
      React.createElement(ScopeHarness, {
        catalog: [DEVICES],
        initial: ruleScopeDraftOf<number>(undefined, undefined),
        exceptOffered: false,
      }),
      { hub: HUB },
    )
    expect(dom.getByText('Only these')).toBeTruthy()
    expect(dom.queryByText('All except these')).toBeNull()
  })

  it('a legacy both-lists rule shows its exclusions, and "Remove exclusions" removes them', async () => {
    const seen: RuleScopeDraft<number>[] = []
    mountScreen(
      React.createElement(ScopeHarness, {
        catalog: [DEVICES, DEVICES_EXCLUDE],
        initial: ruleScopeDraftOf([1], [3]),
        exceptOffered: true,
        onScope: (next) => seen.push(next),
      }),
      { hub: HUB },
    )
    expect(dom.getByTestId('scope-legacy-exclusions')).toBeTruthy()
    await press('Remove exclusions')
    expect(seen.at(-1)?.exclude).toEqual([])
    expect(dom.queryByTestId('scope-legacy-exclusions')).toBeNull()
  })

  it('a mode switch says what Save will clear', async () => {
    mountScreen(
      React.createElement(ScopeHarness, {
        catalog: [DEVICES, DEVICES_EXCLUDE],
        initial: ruleScopeDraftOf([1, 2], undefined),
        exceptOffered: true,
      }),
      { hub: HUB },
    )
    expect(dom.queryByTestId('scope-cleared-on-save')).toBeNull()
    await press('All')
    expect(dom.getByTestId('scope-cleared-on-save')).toBeTruthy()
  })
})

describe('"Notify when" (D640)', () => {
  it('is not drawn while a chosen kind has no raise', () => {
    mountScreen(React.createElement(ConditionsHarness, { initial: { sensorKinds: ['doorbell'] }, onConditions: () => undefined }), {
      hub: HUB,
    })
    expect(dom.queryByText('Notify when')).toBeNull()
  })

  it('is drawn when every kind raises; a choice writes it and "both" deletes it', async () => {
    const seen: NcConditions[] = []
    mountScreen(
      React.createElement(ConditionsHarness, { initial: { sensorKinds: ['flood'] }, onConditions: (next) => seen.push(next) }),
      { hub: HUB },
    )
    expect(dom.getByText('Notify when')).toBeTruthy()
    await press('Only when it triggers')
    expect(seen.at(-1)?.sensorTransition).toBe('raised')
    await press('It triggers and when it clears')
    expect(seen.at(-1)).not.toHaveProperty('sensorTransition')
  })

  it('warns on the alarm rule that can never fire', () => {
    mountScreen(
      React.createElement(ConditionsHarness, {
        initial: {
          deviceState: { deviceId: 900, states: ['armed_away'] },
          sensorKinds: ['contact'],
          sensorTransition: 'cleared',
        },
        onConditions: () => undefined,
      }),
      { hub: HUB },
    )
    expect(dom.getByText(NC_SENSOR_TRANSITION_NEVER_FIRES_WARNING)).toBeTruthy()
  })
})
