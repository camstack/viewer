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
import { act, cleanup, fireEvent, screen as dom } from '@testing-library/react'
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

async function press(text: string): Promise<void> {
  await act(async () => {
    fireEvent.click(dom.getByText(text))
  })
}

describe('SystemEventDeliveryField', () => {
  it('Instant by default; Summary starts at every day 08:00, and back to Instant', async () => {
    const { seen } = mountField(undefined)
    expect(await dom.findByText('A notification for each event, as it happens.')).toBeTruthy()
    await press('Summary')
    expect(seen.at(-1)).toEqual({
      mode: 'summary',
      schedule: { windows: [{ days: [0, 1, 2, 3, 4, 5, 6], startMinute: 479, endMinute: 480 }] },
    })
    const input = dom.getByTestId('rule-delivery-time-input-0')
    expect(input).toHaveProperty('value', '08:00')
    await press('Instant')
    expect(seen.at(-1)).toEqual({ mode: 'instant' })
  })

  it('edits a send time, refuses a non-time, and adds a second one', async () => {
    const { seen } = mountField({
      mode: 'summary',
      schedule: { windows: [{ days: [1, 2, 3, 4, 5], startMinute: 479, endMinute: 480 }] },
    })
    const input = await dom.findByTestId('rule-delivery-time-input-0')
    await act(async () => {
      fireEvent.change(input, { target: { value: '19:30' } })
      fireEvent.blur(input)
    })
    expect(seen.at(-1)).toEqual({
      mode: 'summary',
      schedule: { windows: [{ days: [1, 2, 3, 4, 5], startMinute: 1169, endMinute: 1170 }] },
    })
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
    expect(last?.mode === 'summary' ? last.schedule.windows : []).toHaveLength(2)
    expect(dom.getByTestId('rule-delivery-time-1')).toBeTruthy()
  })

  it('keeps at least one send time, and at least one day on each', async () => {
    const { seen } = mountField({
      mode: 'summary',
      schedule: { windows: [{ days: [1], startMinute: 479, endMinute: 480 }] },
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
    expect(dom.getByText('Custom schedule: the summary is sent when each window below ENDS.')).toBeTruthy()
    expect(dom.queryByTestId('rule-delivery-add-time')).toBeNull()
  })

  it('D698: one per category is picked, and a send-time edit KEEPS it', async () => {
    const { seen } = mountField({
      mode: 'summary',
      schedule: { windows: [{ days: [1, 2, 3, 4, 5], startMinute: 479, endMinute: 480 }] },
    })
    await press('One per category')
    expect(seen.at(-1)).toEqual({
      mode: 'summary',
      schedule: { windows: [{ days: [1, 2, 3, 4, 5], startMinute: 479, endMinute: 480 }] },
      split: 'section',
    })
    const input = dom.getByTestId('rule-delivery-time-input-0')
    await act(async () => {
      fireEvent.change(input, { target: { value: '19:30' } })
      fireEvent.blur(input)
    })
    expect(seen.at(-1)).toEqual({
      mode: 'summary',
      schedule: { windows: [{ days: [1, 2, 3, 4, 5], startMinute: 1169, endMinute: 1170 }] },
      split: 'section',
    })
    await press('One message')
    expect(seen.at(-1)).toEqual({
      mode: 'summary',
      schedule: { windows: [{ days: [1, 2, 3, 4, 5], startMinute: 1169, endMinute: 1170 }] },
    })
  })
})
