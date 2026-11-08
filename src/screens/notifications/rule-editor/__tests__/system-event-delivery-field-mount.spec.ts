/**
 * @vitest-environment jsdom
 *
 * The Delivery control of a device-events / system rule (D647), mounted.
 *
 * The jsdom harness strips what Hermes lacks (`src/testing/hermes-globals.ts`),
 * so this is also the proof that the send-time conversion runs on the phone:
 * the published `scheduleForSendTimes` sorts with `toSorted` and would throw
 * here the moment Summary is chosen.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen as dom, within } from '@testing-library/react'
import React, { useState } from 'react'

import { mountScreen } from '../../../../testing/mount.js'
import type { NcSystemEventDelivery } from '../../../../data/notification-center.js'
import { SystemEventDeliveryField } from '../sections/SystemEventDeliveryField.js'

vi.mock('../../../../connection/ConnectionProvider.js', async () =>
  (await import('../../../../testing/connection-stub.js')).connectionStubModule(),
)

afterEach(() => {
  cleanup()
})

function mountField(initial: NcSystemEventDelivery | undefined): { readonly seen: NcSystemEventDelivery[] } {
  const seen: NcSystemEventDelivery[] = []
  function Stateful() {
    const [value, setValue] = useState<NcSystemEventDelivery | undefined>(initial)
    return React.createElement(SystemEventDeliveryField, {
      value,
      onChange: (next: NcSystemEventDelivery) => {
        seen.push(next)
        setValue(next)
      },
    })
  }
  mountScreen(React.createElement(Stateful))
  return { seen }
}

/** The switch of one delivery moment — the test id sits on its host. */
function momentSwitch(moment: string): HTMLElement {
  const host = dom.getByTestId(`rule-delivery-${moment}`)
  return host.getAttribute('role') === 'switch' ? host : within(host).getByRole('switch')
}

async function press(text: string): Promise<void> {
  await act(async () => {
    fireEvent.click(dom.getByText(text))
  })
}

describe('SystemEventDeliveryField', () => {
  it('absent reads as start + resolve on, no summary; the summary switch starts every day 08:00', async () => {
    const { seen } = mountField(undefined)
    expect(await dom.findByTestId('rule-delivery-activation')).toBeTruthy()
    expect(dom.queryByTestId('rule-delivery-time-0')).toBeNull()
    await act(async () => {
      fireEvent.click(momentSwitch('schedule'))
    })
    expect(seen.at(-1)).toEqual({
      mode: 'modes',
      onActivation: true,
      onDeactivation: true,
      onSchedule: {
        schedule: { windows: [{ days: [0, 1, 2, 3, 4, 5, 6], startMinute: 479, endMinute: 480 }] },
        grouping: 'rule',
      },
    })
    expect(dom.getByTestId('rule-delivery-time-input-0')).toHaveProperty('value', '08:00')
  })

  it('refuses to switch off the last moment', async () => {
    const { seen } = mountField({ mode: 'modes', onActivation: true, onDeactivation: false })
    await dom.findByTestId('rule-delivery-activation')
    await act(async () => {
      fireEvent.click(momentSwitch('activation'))
    })
    expect(seen).toHaveLength(0)
    expect(dom.getByText('At least one moment must stay on.')).toBeTruthy()
  })

  it('a legacy summary shows only the summary on, and keeps its schedule when another moment is added', async () => {
    const schedule = { windows: [{ days: [1, 2, 3, 4, 5], startMinute: 479, endMinute: 480 }] }
    const { seen } = mountField({ mode: 'summary', schedule, split: 'section' })
    expect(await dom.findByTestId('rule-delivery-time-0')).toBeTruthy()
    await act(async () => {
      fireEvent.click(momentSwitch('activation'))
    })
    expect(seen.at(-1)).toEqual({
      mode: 'modes',
      onActivation: true,
      onDeactivation: false,
      onSchedule: { schedule, grouping: 'section' },
    })
  })

  it('edits a send time, refuses a non-time, and adds a second one', async () => {
    const { seen } = mountField({
      mode: 'modes',
      onActivation: false,
      onDeactivation: false,
      onSchedule: {
        schedule: { windows: [{ days: [1, 2, 3, 4, 5], startMinute: 479, endMinute: 480 }] },
        grouping: 'rule',
      },
    })
    const input = await dom.findByTestId('rule-delivery-time-input-0')
    await act(async () => {
      fireEvent.change(input, { target: { value: '19:30' } })
      fireEvent.blur(input)
    })
    const edited = seen.at(-1)
    expect(edited?.mode === 'modes' ? edited.onSchedule?.schedule.windows : []).toEqual([
      { days: [1, 2, 3, 4, 5], startMinute: 1169, endMinute: 1170 },
    ])
    const count = seen.length
    const again = dom.getByTestId('rule-delivery-time-input-0')
    await act(async () => {
      fireEvent.change(again, { target: { value: 'soon' } })
      fireEvent.blur(again)
    })
    expect(seen).toHaveLength(count)
    expect(dom.getByTestId('rule-delivery-time-input-0')).toHaveProperty('value', '19:30')
    await act(async () => {
      fireEvent.click(dom.getByTestId('rule-delivery-add-time'))
    })
    const last = seen.at(-1)
    expect(last?.mode === 'modes' ? last.onSchedule?.schedule.windows : []).toHaveLength(2)
  })

  it('keeps at least one day on each send time', async () => {
    const { seen } = mountField({
      mode: 'modes',
      onActivation: true,
      onDeactivation: true,
      onSchedule: { schedule: { windows: [{ days: [1], startMinute: 479, endMinute: 480 }] }, grouping: 'rule' },
    })
    await dom.findByTestId('rule-delivery-time-0')
    expect(dom.queryByLabelText('Remove send time')).toBeNull()
    await press('Mon')
    expect(seen).toHaveLength(0)
  })

  it('a schedule that is not send times is shown as its windows, and said to be', async () => {
    mountField({
      mode: 'summary',
      schedule: { windows: [{ days: [1], startMinute: 540, endMinute: 1080 }] },
    })
    expect(await dom.findByTestId('rule-delivery-custom')).toBeTruthy()
    expect(dom.queryByTestId('rule-delivery-add-time')).toBeNull()
  })

  it('D698: one per category is picked, and a send-time edit KEEPS it', async () => {
    const { seen } = mountField({
      mode: 'modes',
      onActivation: true,
      onDeactivation: true,
      onSchedule: { schedule: { windows: [{ days: [1, 2, 3, 4, 5], startMinute: 479, endMinute: 480 }] }, grouping: 'rule' },
    })
    await press('One per category')
    const picked = seen.at(-1)
    expect(picked?.mode === 'modes' ? picked.onSchedule?.grouping : null).toBe('section')
    const input = dom.getByTestId('rule-delivery-time-input-0')
    await act(async () => {
      fireEvent.change(input, { target: { value: '19:30' } })
      fireEvent.blur(input)
    })
    const after = seen.at(-1)
    expect(after?.mode === 'modes' ? after.onSchedule?.grouping : null).toBe('section')
  })
})
