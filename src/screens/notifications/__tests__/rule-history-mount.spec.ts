/**
 * @vitest-environment jsdom
 *
 * A rule's delivery history (`/notifications/rule/[id]/history`), mounted over
 * the real hooks with only the wire faked.
 *
 * What only a mount can say:
 *  - the list is ONE `getHistory({ filter: { ruleId, limit: 50 } })` — no
 *    `since`: the outbox already bounds it;
 *  - pending, failed and empty are three different screens (D315) — an error
 *    never reads as "no deliveries";
 *  - each row says when, which device, which target and how it ended;
 *  - a thumbnail URL is minted per row, on demand, and `url: null` is "no
 *    image", never a broken image;
 *  - a non-admin never asks: the method is admin, and the screen says so.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen as dom, within } from '@testing-library/react'
import React from 'react'

import { mountScreen } from '../../../testing/mount.js'
import { hubCalls, type HubResponses } from '../../../testing/hub-stub.js'
import { resetStubConnection, setStubConnection } from '../../../testing/connection-stub.js'
import { EXPO_IMAGE_TESTID_PREFIX } from '../../../testing/native-stubs/expo-image.js'
import { RuleHistoryScreen, type RuleHistoryScreenProps } from '../RuleHistoryScreen.js'
import IT from '../../../../locales/it.json'

vi.mock('../../../connection/ConnectionProvider.js', async () =>
  (await import('../../../testing/connection-stub.js')).connectionStubModule(),
)

const HISTORY_PATH = 'notificationRules.getHistory'
const URL_PATH = 'notificationRules.resolveArtifactUrl'

function entry(id: string, over: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  return {
    id,
    ruleId: 'r1',
    ruleName: 'Front door',
    delivery: 'immediate',
    targetId: 't1',
    deviceId: 3,
    recordKind: 'track-end',
    recordId: `rec-${id}`,
    status: 'sent',
    attempts: 1,
    createdAt: Date.now() - 10 * 60_000,
    updatedAt: Date.now() - 10 * 60_000,
    subject: { className: 'person', zones: [], timestamp: Date.now() - 10 * 60_000 },
    ...over,
  }
}

const ENTRIES = [
  entry('e-image', { artifactIds: ['a-ok'] }),
  entry('e-gone', { artifactIds: ['a-gone'], deviceId: 99, status: 'dead', error: 'target rejected' }),
  entry('e-none', { status: 'pending', targetId: 'unknown-target' }),
]

function field(input: unknown, key: string): unknown {
  return input !== null && typeof input === 'object' && key in input ? Reflect.get(input, key) : undefined
}

const PORCH = { id: 3, name: 'Porch', type: 'camera', isCamera: true, online: true, disabled: false }
const DOOR_SENSOR = { id: 42, name: 'Front door contact', type: 'sensor', isCamera: false, online: true, disabled: false }

/**
 * `deviceManager.listAll` answers two readers: the camera list (`isCamera`)
 * and the device catalogue (everything). `catalogue: 'never'` leaves the
 * catalogue unanswered — the camera list still answers.
 */
function listAll(catalogue: 'answers' | 'never') {
  return (input?: unknown): unknown => {
    if (field(input, 'isCamera') === true) return [PORCH]
    if (catalogue === 'never') return new Promise(() => undefined)
    return [PORCH, DOOR_SENSOR]
  }
}

function hub(isAdmin: boolean, history: unknown, catalogue: 'answers' | 'never' = 'answers') {
  return {
    'auth.me': { id: 'u1', username: 'admin', isAdmin },
    [HISTORY_PATH]: history,
    [URL_PATH]: (input?: unknown): unknown => {
      const id = field(input, 'artifactId')
      return { url: id === 'a-ok' ? 'https://hub.example/a/a-ok.jpg?sig=1' : null }
    },
    'deviceManager.listAll': listAll(catalogue),
    'addons.custom': (input?: unknown): unknown => {
      const action = field(input, 'action')
      if (action === 'nc.listMyTargets') {
        return {
          targets: [{ id: 't1', name: 'My phone', kind: 'push', addonId: 'notifiers', enabled: true, config: {} }],
        }
      }
      if (action === 'nc.listRules') return { rules: [] }
      throw new Error(`NOT_FOUND: ${String(action)}`)
    },
  }
}

function mount(isAdmin: boolean, history: unknown, catalogue: 'answers' | 'never' = 'answers') {
  return mountScreen(React.createElement(RuleHistoryScreen, { id: 'r1', name: 'Front door' }), {
    hub: hub(isAdmin, history, catalogue),
  })
}

function calls(path: string): readonly unknown[] {
  return hubCalls()
    .filter((call) => call.path === path)
    .map((call) => call.input)
}

/**
 * The screen under a parent that can be made to re-render on demand: the
 * connection stub's state is a plain value, so a flip is only SEEN by the
 * next render — which is exactly what a real reconnect causes.
 */
function Bumpable(props: RuleHistoryScreenProps) {
  const [, setTick] = React.useState(0)
  return React.createElement(
    React.Fragment,
    null,
    React.createElement('button', { 'data-testid': 'bump', onClick: () => setTick((n) => n + 1) }),
    React.createElement(RuleHistoryScreen, props),
  )
}

function mountBumpable(hubResponses: HubResponses) {
  return mountScreen(React.createElement(Bumpable, { id: 'r1', name: 'Front door' }), { hub: hubResponses })
}

/** The connection drops (a reconnect in progress), and the screen re-renders. */
async function disconnect(): Promise<void> {
  setStubConnection({ state: 'disconnected' })
  await act(async () => {
    fireEvent.click(dom.getByTestId('bump'))
  })
}

const ADMIN_ONLY = 'Only an administrator can see a rule’s deliveries'

afterEach(() => {
  cleanup()
  resetStubConnection()
})

describe('rule history screen', () => {
  it('asks ONE getHistory for this rule, 50 rows, no since', async () => {
    mount(true, { entries: ENTRIES })
    await dom.findByTestId('rule-history-row-e-image')
    expect(calls(HISTORY_PATH)).toEqual([{ filter: { ruleId: 'r1', limit: 50 } }])
    expect(dom.getByText('Deliveries of Front door')).toBeTruthy()
  })

  it('each row names the device, the target and the outcome', async () => {
    mount(true, { entries: ENTRIES })
    const first = await dom.findByTestId('rule-history-row-e-image')
    expect(within(first).getByText('Porch')).toBeTruthy()
    expect(within(first).getByText(/My phone/)).toBeTruthy()
    expect(within(first).getByText('Sent')).toBeTruthy()

    const gone = dom.getByTestId('rule-history-row-e-gone')
    expect(within(gone).getByText('Device #99')).toBeTruthy()
    expect(dom.queryByText(/Camera #/)).toBeNull()
    expect(within(gone).getByText('Failed')).toBeTruthy()
    expect(within(gone).getByText(/target rejected/)).toBeTruthy()

    const none = dom.getByTestId('rule-history-row-e-none')
    expect(within(none).getByText('Pending')).toBeTruthy()
    expect(within(none).getByText(/unknown-target/)).toBeTruthy()
  })

  it('mints a URL per row that has one; url null is "no image", never a broken image', async () => {
    mount(true, { entries: ENTRIES })
    const first = await dom.findByTestId('rule-history-row-e-image')
    await within(first).findByTestId(`${EXPO_IMAGE_TESTID_PREFIX}https://hub.example/a/a-ok.jpg?sig=1`)

    const gone = dom.getByTestId('rule-history-row-e-gone')
    await within(gone).findByText('No image right now')
    expect(gone.querySelector(`[data-testid^="${EXPO_IMAGE_TESTID_PREFIX}"]`)).toBeNull()

    // A row with no artefact asks for nothing and draws no thumbnail slot.
    const none = dom.getByTestId('rule-history-row-e-none')
    expect(within(none).queryByText('No image right now')).toBeNull()
    expect(calls(URL_PATH)).toEqual([{ artifactId: 'a-ok' }, { artifactId: 'a-gone' }])
  })

  it('a sensor row takes its name from the device catalogue, not the camera list', async () => {
    mount(true, { entries: [entry('e-sensor', { deviceId: 42, recordKind: 'device-event' })] })
    const row = await dom.findByTestId('rule-history-row-e-sensor')
    expect(await within(row).findByText('Front door contact')).toBeTruthy()
    expect(within(row).queryByText(/#42/)).toBeNull()
  })

  it('an unanswered catalogue shows the generic "Device #id", never a camera word or "removed"', async () => {
    mount(true, { entries: [entry('e-sensor', { deviceId: 42, recordKind: 'device-event' })] }, 'never')
    const row = await dom.findByTestId('rule-history-row-e-sensor')
    expect(within(row).getByText('Device #42')).toBeTruthy()
    expect(row.textContent ?? '').not.toMatch(/Camera|removed/i)
    // The Italian wording is the generic one too.
    expect(IT.v2.nc.rules.history.deviceById).toBe('Dispositivo #{{id}}')
  })

  it('an answered empty list says so', async () => {
    mount(true, { entries: [] })
    expect(await dom.findByText('No deliveries for this rule')).toBeTruthy()
  })

  it('a failed read is an error, never an empty list', async () => {
    const fail = (): unknown => {
      throw new Error('store unavailable')
    }
    mount(true, fail)
    expect(await dom.findByText('History could not be loaded')).toBeTruthy()
    expect(dom.queryByText('No deliveries for this rule')).toBeNull()
  })

  it('a read in flight shows neither empty nor error', async () => {
    const never = (): unknown => new Promise(() => undefined)
    mount(true, never)
    await dom.findByTestId('rule-history-loading')
    expect(dom.queryByText('No deliveries for this rule')).toBeNull()
    expect(dom.queryByText('History could not be loaded')).toBeNull()
  })

  it('a reconnect keeps an admin\'s answered list, and never says "only an administrator"', async () => {
    mountBumpable(hub(true, { entries: ENTRIES }))
    await dom.findByTestId('rule-history-row-e-image')
    await disconnect()
    expect(dom.getByTestId('rule-history-row-e-image')).toBeTruthy()
    expect(dom.queryByText(ADMIN_ONLY)).toBeNull()
  })

  it('a reconnect before the list answered is a spinner, never "only an administrator"', async () => {
    const never = (): unknown => new Promise(() => undefined)
    mountBumpable(hub(true, never))
    await dom.findByTestId('rule-history-loading')
    // The verdict has answered (admin) before the connection drops.
    await vi.waitFor(() => expect(calls(HISTORY_PATH)).toHaveLength(1))
    await disconnect()
    expect(dom.getByTestId('rule-history-loading')).toBeTruthy()
    expect(dom.queryByText(ADMIN_ONLY)).toBeNull()
  })

  it('a failed auth.me claims no role: an error with a retry, and the retry recovers', async () => {
    let meAnswers = false
    const me = (): unknown => {
      if (!meAnswers) throw new Error('auth.me timed out')
      return { id: 'u1', username: 'admin', isAdmin: true }
    }
    mountScreen(React.createElement(RuleHistoryScreen, { id: 'r1', name: 'Front door' }), {
      hub: { ...hub(true, { entries: ENTRIES }), 'auth.me': me },
    })
    await dom.findByText('Could not check your access to this rule’s deliveries')
    expect(dom.queryByText(ADMIN_ONLY)).toBeNull()
    expect(calls(HISTORY_PATH)).toEqual([])

    meAnswers = true
    await act(async () => {
      fireEvent.click(dom.getByRole('button', { name: 'Retry' }))
    })
    expect(await dom.findByTestId('rule-history-row-e-image')).toBeTruthy()
  })

  it('a non-admin never asks, and is told why', async () => {
    mount(false, { entries: ENTRIES })
    await dom.findByText('Only an administrator can see a rule’s deliveries')
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(calls(HISTORY_PATH)).toEqual([])
    expect(calls(URL_PATH)).toEqual([])
    // Nor the fleet catalogue: it is read for this screen's rows, and only for an admin.
    expect(calls('deviceManager.listAll').filter((input) => field(input, 'isCamera') !== true)).toEqual([])
  })
})
