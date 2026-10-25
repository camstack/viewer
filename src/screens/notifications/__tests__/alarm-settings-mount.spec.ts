/**
 * @vitest-environment jsdom
 *
 * The admin alarm screen, mounted over the real hooks with only the wire faked
 * (Task 12). What only a mount can say:
 *  - a deep link from a non-admin, or with an unknown role, is a STATE, never a
 *    blank form, and asks nothing of the admin-only alarm actions;
 *  - a failed config read is said and retried, and never becomes a write;
 *  - each mode's SENSOR TABLE (D697) has a row for EVERY opening of the household
 *    (D636), a camera never offered, names what it cannot read "Device #id"
 *    and a deleted pick "— removed", still switchable off (D49); the state
 *    cell says "Checking…" until the hub answered (D315), the coverage cell
 *    says what the arm check really reads, and a switch writes ONE edit, one
 *    at a time, said when it did not land;
 *  - Save sends only what changed, and re-reads config and status on settle;
 *  - the Notification Center offers the Alarm section to a confirmed admin only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen as dom, within } from '@testing-library/react'
import React from 'react'
import {
  applyModeDelaysEdits,
  NcAlarmModeDelaysEditSchema,
  NcAlarmModeDelaysSchema,
} from '@camstack/types'

import { mountScreen } from '../../../testing/mount.js'
import { hubCalls } from '../../../testing/hub-stub.js'
import { routerCalls } from '../../../testing/native-stubs/expo-router.js'
import { setTestFocused } from '../../../testing/focus-control.js'
import { setTestPlatform } from '../../../testing/platform-control.js'
import { AlarmSettingsScreen } from '../AlarmSettingsScreen.js'
import { NotificationCenterScreen } from '../NotificationCenterScreen.js'
import enLocale from '../../../../locales/en.json'
import itLocale from '../../../../locales/it.json'

vi.mock('../../../connection/ConnectionProvider.js', async () =>
  (await import('../../../testing/connection-stub.js')).connectionStubModule(),
)

/** The latest `usePreventRemove` arming and its callback (the leave guard). */
interface GuardState {
  enabled: boolean
  callback: ((event: { readonly data: { readonly action: string } }) => void) | null
}
const guard: GuardState = { enabled: false, callback: null }

vi.mock('expo-router/react-navigation', () => ({
  usePreventRemove: (
    enabled: boolean,
    callback: (event: { readonly data: { readonly action: string } }) => void,
  ): void => {
    guard.enabled = enabled
    guard.callback = callback
  },
}))

afterEach(() => {
  cleanup()
  guard.enabled = false
  guard.callback = null
})

const PANEL = 1201
const CAMERA = 5
const CONTACT = 43
const UNREADABLE = 60
const DELETED = 99
/** A contact an away rule names. */
const STUDY = 70
/** A roller shutter: a CONTROLLABLE opening (cover) — only with `withShutter`. */
const SHUTTER = 80
/** What the away rules name (Q2: only covered sensors are rows). */
const AWAY_COVERED = [CAMERA, CONTACT, UNREADABLE, STUDY]

function lookupLocale(tree: unknown, key: string): string | undefined {
  let node: unknown = tree
  for (const part of key.split('.')) {
    node = field(node, part)
    if (node === undefined) return undefined
  }
  return typeof node === 'string' ? node : undefined
}

function field(input: unknown, key: string): unknown {
  if (input === null || typeof input !== 'object' || !(key in input)) return undefined
  return Object.entries(input).find(([k]) => k === key)?.[1]
}

function customCalls(action: string): readonly unknown[] {
  return hubCalls()
    .filter((c) => c.path === 'addons.custom' && field(c.input, 'action') === action)
    .map((c) => field(c.input, 'input'))
}

/** What `nc.getAlarmSensors` answers for an id (anything else reads closed). */
const SENSOR_STATES: Readonly<Record<number, Readonly<Record<string, unknown>>>> = {
  [STUDY]: { deviceId: STUDY, reading: 'open', state: 'open', unknownWhy: null, online: true },
  [UNREADABLE]: { deviceId: UNREADABLE, reading: 'unknown', state: null, unknownWhy: 'read-failed', online: null },
  [SHUTTER]: { deviceId: SHUTTER, reading: 'closed', state: 'closed', unknownWhy: null, online: true, controllable: true },
}

interface SkippedFixture {
  readonly deviceId: number
  readonly reason: string
}
const NO_SKIPS: readonly SkippedFixture[] = []

const CONFIG = {
  deviceId: PANEL,
  settings: {
    exitDelaySec: 30,
    entryDelaySec: 20,
    triggeredDurationSec: 0,
    announceTargets: ['push-1'],
    nonBlocking: [{ mode: 'away', deviceIds: [DELETED] }],
    blocking: [] as { mode: string; deviceIds: number[] }[],
    secureOnArmOff: [] as { mode: string; deviceIds: number[] }[],
  },
  coverage: [
    { mode: 'away', ruleCount: 2, allDevices: false, deviceIds: AWAY_COVERED, skippedDevices: NO_SKIPS },
  ],
  live: {
    state: 'disarmed',
    targetMode: null,
    availableModes: ['home', 'away', 'night'],
    openings: [{ mode: 'away', devices: [], unknown: [UNREADABLE] }],
    exclusions: [],
  },
}

type AlarmConfigFixture = typeof CONFIG

interface HubOptions {
  readonly isAdmin?: boolean
  readonly meFails?: boolean
  readonly configFails?: boolean
  readonly config?: AlarmConfigFixture
  /** An older hub: answers a save WITHOUT applying the patch. */
  readonly ignoresSaves?: boolean
  /** A household with no opening at all: nothing is bound to an opening cap. */
  readonly noOpenings?: boolean
  /** The sensors read fails with this message (every call). */
  readonly sensorsError?: string
  /** The sensors read never answers (still "Checking…"). */
  readonly sensorsHold?: boolean
  /** The switch write throws this message. */
  readonly writeError?: string
  /** The switch write waits until `releaseWrite()`. */
  readonly holdWrites?: boolean
  /** The household scan (`listDeviceIdsByCaps`) never answers. */
  readonly scanHold?: boolean
  /** The site zones read: answered with the zones, or failing. */
  readonly zones?: 'answered' | 'fails'
  /** Adds SHUTTER — a cover the away rules name — to the household. */
  readonly withShutter?: boolean
}

/** Releases the writes `holdWrites` is holding. */
const writeGate: { release: () => void } = { release: () => undefined }

/** What the hub serves now — a test may change it to play another admin. */
const server: { config: AlarmConfigFixture } = { config: CONFIG }

function hub(options: HubOptions = {}): Readonly<Record<string, unknown>> {
  const base = options.config ?? CONFIG
  server.config =
    options.withShutter === true
      ? {
          ...base,
          coverage: base.coverage.map((c) => (c.mode === 'away' ? { ...c, deviceIds: [...c.deviceIds, SHUTTER] } : c)),
        }
      : base
  const shutter = options.withShutter === true ? [{ id: SHUTTER, name: 'Tapparella sala', type: 'cover', location: 'Sala' }] : []
  return {
    'auth.me': () => {
      if (options.meFails === true) throw new Error('auth.me unreachable')
      return { id: 'u1', username: 'operator', isAdmin: options.isAdmin ?? true }
    },
    'alarmPanel.getStatus': { state: 'disarmed', availableModes: ['home', 'away', 'night'], requiresCode: false, lastChangedAt: 1 },
    'deviceManager.listAll': [
      { id: CAMERA, name: 'Garden cam', type: 'camera' },
      { id: CONTACT, name: 'Back door', type: 'sensor', location: 'Sala' },
      // Nameless: the wire names it by id, as the phone would.
      { id: UNREADABLE, name: '', type: 'cover' },
      { id: STUDY, name: 'Finestra studio', type: 'sensor', location: 'Studio' },
      ...shutter,
    ],
    'deviceManager.listSiteZones': (): unknown => {
      if (options.zones === 'fails') throw new Error('zones unreachable')
      return [{ zoneKey: 'zona-giorno', label: 'Zona giorno', locationKeys: ['sala'] }]
    },
    // The ONE targeted read (D636): the ids bound to an opening cap. The
    // camera is not among them — it carries no contact, cover or lock.
    'deviceManager.listDeviceIdsByCaps':
      options.scanHold === true ? (): unknown => new Promise(() => undefined) : options.noOpenings === true ? [] : [CONTACT, UNREADABLE, STUDY, ...shutter.map((d) => d.id)],
    'addons.custom': (input?: unknown): unknown => {
      const action = field(input, 'action')
      if (action === 'nc.getAlarmConfig') {
        if (options.configFails === true) throw new Error('alarm config unreachable')
        return server.config
      }
      if (action === 'nc.getAlarmStatus') return { deviceId: PANEL, live: CONFIG.live }
      if (action === 'nc.getAlarmSensors') {
        if (options.sensorsError !== undefined) throw new Error(options.sensorsError)
        if (options.sensorsHold === true) return new Promise(() => undefined)
        const asked = field(field(input, 'input'), 'deviceIds')
        const ids = Array.isArray(asked) ? asked.filter((id): id is number => typeof id === 'number') : []
        return {
          sensors: ids.map(
            (id) => SENSOR_STATES[id] ?? { deviceId: id, reading: 'closed', state: 'closed', unknownWhy: null, online: true },
          ),
          readAt: 1,
        }
      }
      if (action === 'nc.setAlarmConfig') {
        if (options.writeError !== undefined) throw new Error(options.writeError)
        const apply = (): unknown => {
          if (options.ignoresSaves === true) return server.config
          const patch = field(field(input, 'input'), 'patch')
          // A membership edit: ONE device on ONE mode's list, as the panel applies it.
          const membership = (
            listKey: 'nonBlocking' | 'blocking' | 'secureOnArmOff',
            edit: unknown,
            onList: boolean,
          ): unknown => {
            const mode = field(edit, 'mode')
            const deviceId = Number(field(edit, 'deviceId'))
            const lists = server.config.settings[listKey]
            const current = lists.find((l) => l.mode === mode)?.deviceIds ?? []
            const next = onList ? [...new Set([...current, deviceId])] : current.filter((id) => id !== deviceId)
            server.config = {
              ...server.config,
              settings: {
                ...server.config.settings,
                [listKey]: [...lists.filter((l) => l.mode !== mode), { mode: String(mode), deviceIds: next }],
              },
            }
            return server.config
          }
          const blockingEdit = field(patch, 'blockingEdit')
          if (blockingEdit !== undefined) return membership('blocking', blockingEdit, field(blockingEdit, 'blocking') === true)
          const secureEdit = field(patch, 'secureOnArmEdit')
          // Secure ON ⇔ NOT on the opt-out list.
          if (secureEdit !== undefined) return membership('secureOnArmOff', secureEdit, field(secureEdit, 'secureOnArm') !== true)
          const edit = field(patch, 'nonBlockingEdit')
          if (edit !== undefined) {
            const mode = field(edit, 'mode')
            const deviceId = field(edit, 'deviceId')
            const on = field(edit, 'nonBlocking') === true
            const lists = server.config.settings.nonBlocking
            const current = lists.find((l) => l.mode === mode)?.deviceIds ?? []
            const next = on ? [...new Set([...current, Number(deviceId)])] : current.filter((id) => id !== deviceId)
            server.config = {
              ...server.config,
              settings: {
                ...server.config.settings,
                nonBlocking: [...lists.filter((l) => l.mode !== mode), { mode: String(mode), deviceIds: next }],
              },
            }
            return server.config
          }
          const { modeDelays: modeEdits, ...flat } = typeof patch === 'object' && patch !== null ? Object.fromEntries(Object.entries(patch)) : {}
          const stored = NcAlarmModeDelaysSchema.array().parse('modeDelays' in server.config.settings ? server.config.settings.modeDelays : [])
          server.config = {
            ...server.config,
            settings: {
              ...server.config.settings,
              ...flat,
              ...(Array.isArray(modeEdits) ? { modeDelays: applyModeDelaysEdits(stored, NcAlarmModeDelaysEditSchema.array().parse(modeEdits)) } : {}),
            },
          }
          return server.config
        }
        if (options.holdWrites !== true) return apply()
        return new Promise((resolve) => {
          writeGate.release = () => resolve(apply())
        })
      }
      throw new Error(`NOT_FOUND: ${String(action)}`)
    },
  }
}

/** The away table, once the household scan has put its rows on screen. */
async function awayRowsReady(): Promise<void> {
  await dom.findByTestId(`alarm-row-away-${String(STUDY)}`)
}

/** Is the row drawn muted (Q2: listed, but nothing makes the arm check read it)? */
function awayMuted(id: number): boolean {
  // The ONE opacity is the ToggleRow's own (the wrapper carries none).
  const inner = awayRow(id).firstElementChild
  return inner !== null && getComputedStyle(inner).opacity === '0.6'
}

/** The away table's row of one device. */
function awayRow(id: number): HTMLElement {
  return dom.getByTestId(`alarm-row-away-${String(id)}`)
}

/** The element carrying the away switch's role, whatever the platform wraps it in. */
function awaySwitch(id: number): HTMLElement {
  const host = dom.getByTestId(`alarm-switch-blocks-away-${String(id)}`)
  return host.getAttribute('role') === 'switch' ? host : within(host).getByRole('switch')
}

/** The away table's "Secure on arm" switch of one device, or null when the row has none. */
function awaySecureSwitch(id: number): HTMLElement | null {
  const host = dom.queryByTestId(`alarm-switch-secure-away-${String(id)}`)
  if (host === null) return null
  return host.getAttribute('role') === 'switch' ? host : within(host).getByRole('switch')
}

function isOn(el: HTMLElement): boolean {
  return el instanceof HTMLInputElement ? el.checked : el.getAttribute('aria-checked') === 'true'
}

/** Press (click) the away switch of one device. */
async function pressAway(id: number): Promise<void> {
  await act(async () => {
    fireEvent.click(awaySwitch(id))
  })
}

/** Does the away switch of `id` read ON (= blocks arming)? */
function awayBlocks(id: number): boolean {
  const el = awaySwitch(id)
  return el instanceof HTMLInputElement ? el.checked : el.getAttribute('aria-checked') === 'true'
}

/** The text of one away-table cell of one device. */
function awayCell(cell: 'state' | 'coverage' | 'place', id: number): string {
  return dom.getByTestId(`alarm-cell-${cell}-away-${String(id)}`).textContent ?? ''
}

describe('a deep link is a state, never a blank form', () => {
  it('a non-admin reads that only an administrator configures the alarm, and nothing is asked', async () => {
    mountScreen(React.createElement(AlarmSettingsScreen), { hub: hub({ isAdmin: false }) })
    await dom.findByText(/Only an administrator can configure the alarm/)
    expect(customCalls('nc.getAlarmConfig')).toHaveLength(0)
    expect(dom.queryByText('Save')).toBeNull()
  })

  it('an unknown role says so and offers a retry', async () => {
    mountScreen(React.createElement(AlarmSettingsScreen), { hub: hub({ meFails: true }) })
    await dom.findByText(/Couldn't confirm your role/)
    expect(dom.getByText('Try again')).toBeTruthy()
    expect(dom.queryByText('Save')).toBeNull()
  })

  it('a failed config read is said, retried on request, and never written', async () => {
    mountScreen(React.createElement(AlarmSettingsScreen), { hub: hub({ configFails: true }) })
    await dom.findByText(/Couldn't load the alarm settings: alarm config unreachable/)
    const before = customCalls('nc.getAlarmConfig').length
    await act(async () => {
      fireEvent.click(dom.getByText('Try again'))
    })
    expect(customCalls('nc.getAlarmConfig').length).toBeGreaterThan(before)
    expect(customCalls('nc.setAlarmConfig')).toHaveLength(0)
    expect(dom.queryByText('Save')).toBeNull()
  })
})

describe('the sensor table replaces the non-blocking picker', () => {
  it('has a row for every opening, none for a camera, and no picker', async () => {
    mountScreen(React.createElement(AlarmSettingsScreen), { hub: hub() })
    await awayRowsReady()
    expect(dom.queryByTestId('alarm-nonblocking-away')).toBeNull()
    expect(dom.queryByTestId('device-picker-add')).toBeNull()
    // The camera is covered (it counts in the mode's line) but never a row.
    await vi.waitFor(() => expect(dom.getByTestId('alarm-coverage-away').textContent).toMatch(/Checks \d+ sensors?/))
    expect(dom.queryByTestId(`alarm-row-away-${String(CAMERA)}`)).toBeNull()
    expect(awayRow(CONTACT).textContent).toContain('Back door')
    // A nameless opening is named by id, never "removed" before an answer says so.
    expect(awayRow(UNREADABLE).textContent).toContain('Device #60')
    expect(awayRow(UNREADABLE).textContent).not.toContain('removed')
    await vi.waitFor(() => expect(awayRow(STUDY).textContent).toContain('Finestra studio'))
    // Targeted: the opening ids, then their rows by id - never the fleet.
    const paths = hubCalls().map((c) => c.path)
    expect(paths).toContain('deviceManager.listDeviceIdsByCaps')
    expect(paths).not.toContain('deviceManager.getBindingsBatch')
    const unfiltered = hubCalls().filter(
      (c) =>
        c.path === 'deviceManager.listAll' &&
        field(c.input, 'deviceIds') === undefined &&
        field(c.input, 'isCamera') === undefined,
    )
    expect(unfiltered).toHaveLength(0)
  })

  it('a deleted pick stays a row, says it was removed, and can still be switched on again', async () => {
    mountScreen(React.createElement(AlarmSettingsScreen), { hub: hub() })
    await dom.findByTestId(`alarm-row-away-${String(DELETED)}`)
    await vi.waitFor(() => expect(awayRow(DELETED).textContent).toContain('Device #99 — removed'))
    expect(awayCell('state', DELETED)).toBe('Removed')
    // Listed = non-blocking = the switch reads OFF.
    expect(awayBlocks(DELETED)).toBe(false)
    await pressAway(DELETED)
    await vi.waitFor(() => expect(customCalls('nc.setAlarmConfig')).toHaveLength(1))
    expect(customCalls('nc.setAlarmConfig')[0]).toEqual({
      patch: { nonBlockingEdit: { mode: 'away', deviceId: DELETED, nonBlocking: false } },
    })
    // No state is ever read for a removed device.
    const asked = customCalls('nc.getAlarmSensors').flatMap((i) => {
      const ids = field(i, 'deviceIds')
      return Array.isArray(ids) ? ids : []
    })
    expect(asked).not.toContain(DELETED)
  })

  it('says what the arm check really reads (coverage); a sensor no rule of the mode covers is not a row (Q2)', async () => {
    const config = {
      ...CONFIG,
      coverage: [{ mode: 'away', ruleCount: 2, allDevices: false, deviceIds: [CAMERA, CONTACT, UNREADABLE], skippedDevices: NO_SKIPS }],
    }
    mountScreen(React.createElement(AlarmSettingsScreen), { hub: hub({ config }) })
    await dom.findByTestId(`alarm-row-away-${String(CONTACT)}`)
    expect(awayCell('coverage', CONTACT)).toBe('Yes')
    expect(awayMuted(CONTACT)).toBe(false)
    // STUDY is an opening of the household no away rule names: no row at all.
    expect(dom.queryByTestId(`alarm-row-away-${String(STUDY)}`)).toBeNull()
    // Not "hidden by filters" either.
    expect(dom.queryByTestId('alarm-rows-hidden')).toBeNull()
  })

  it('an uncovered sensor the mode still lists is shown, labelled and muted, and its switch removes the entry (D49)', async () => {
    const config = {
      ...CONFIG,
      settings: { ...CONFIG.settings, nonBlocking: [{ mode: 'away', deviceIds: [STUDY] }] },
      coverage: [{ mode: 'away', ruleCount: 2, allDevices: false, deviceIds: [CAMERA, CONTACT, UNREADABLE], skippedDevices: NO_SKIPS }],
    }
    mountScreen(React.createElement(AlarmSettingsScreen), { hub: hub({ config }) })
    await dom.findByTestId(`alarm-row-away-${String(CONTACT)}`)
    expect(awayCell('coverage', STUDY)).toBe(
      'Not checked by any rule of this mode — listed as non-blocking; switch it on to remove the entry',
    )
    expect(awayMuted(STUDY)).toBe(true)
    expect(awayMuted(CONTACT)).toBe(false)
    expect(awayBlocks(STUDY)).toBe(false)
    await pressAway(STUDY)
    await vi.waitFor(() => expect(customCalls('nc.setAlarmConfig')).toHaveLength(1))
    expect(customCalls('nc.setAlarmConfig')[0]).toEqual({
      patch: { nonBlockingEdit: { mode: 'away', deviceId: STUDY, nonBlocking: false } },
    })
  })

  it('a device covered only by an all-devices rule is hidden: the arm check does not read it (HIGH-1, Q2)', async () => {
    const config = {
      ...CONFIG,
      settings: { ...CONFIG.settings, nonBlocking: [] },
      coverage: [{ mode: 'away', ruleCount: 1, allDevices: true, deviceIds: [], skippedDevices: [] }],
      live: { ...CONFIG.live, openings: [{ mode: 'away', devices: [], unknown: [] }] },
    }
    mountScreen(React.createElement(AlarmSettingsScreen), { hub: hub({ config }) })
    const none = await dom.findByTestId('alarm-sensors-none-away')
    expect(none.textContent).toBe('No sensor is covered by a rule of this mode.')
    expect(dom.queryByTestId(`alarm-row-away-${String(STUDY)}`)).toBeNull()
  })

  it('never says "no sensor is covered" while the household scan is still pending (D315)', async () => {
    const config = {
      ...CONFIG,
      settings: { ...CONFIG.settings, nonBlocking: [] },
      coverage: [{ mode: 'away', ruleCount: 1, allDevices: true, deviceIds: [], skippedDevices: [] }],
      live: { ...CONFIG.live, openings: [{ mode: 'away', devices: [], unknown: [] }] },
    }
    mountScreen(React.createElement(AlarmSettingsScreen), { hub: hub({ config, scanHold: true }) })
    await dom.findByTestId('alarm-coverage-away')
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50))
    })
    expect(dom.queryByTestId('alarm-sensors-none-away')).toBeNull()
  })

  it('a skipped device still blocks arming - the skip mutes notifications only', async () => {
    const config = {
      ...CONFIG,
      coverage: [
        { mode: 'away', ruleCount: 2, allDevices: false, deviceIds: AWAY_COVERED, skippedDevices: [{ deviceId: CONTACT, reason: 'detection-off' }] },
      ],
    }
    mountScreen(React.createElement(AlarmSettingsScreen), { hub: hub({ config }) })
    await awayRowsReady()
    expect(awayCell('coverage', CONTACT)).toBe('Yes — blocks arming (notifications skipped: detection off)')
  })

  it('the state cell says Checking… until the hub answered - never "closed"', async () => {
    mountScreen(React.createElement(AlarmSettingsScreen), { hub: hub({ sensorsHold: true }) })
    await awayRowsReady()
    await vi.waitFor(() => expect(customCalls('nc.getAlarmSensors').length).toBeGreaterThan(0))
    expect(awayCell('state', CONTACT)).toBe('Checking…')
    expect(awayCell('state', STUDY)).toBe('Checking…')
    expect(dom.queryByText('closed')).toBeNull()
  })

  it('shows the answered words, an unreadable one as unknown, and keeps asking', async () => {
    mountScreen(React.createElement(AlarmSettingsScreen), { hub: hub() })
    await vi.waitFor(() => expect(awayCell('state', CONTACT)).toBe('closed'))
    expect(awayCell('state', STUDY)).toBe('open')
    expect(awayCell('state', UNREADABLE)).toBe('Unknown (could not read)')
    const asked = customCalls('nc.getAlarmSensors')
    expect(asked).toHaveLength(1)
    // ONE read for the union of every candidate, sorted.
    expect(asked[0]).toEqual({ deviceIds: [CONTACT, UNREADABLE, STUDY] })
  })

  it.each([
    ['an older addon', 'child-addon-call: addon "pipeline-analytics" has no custom action "nc.getAlarmSensors"'],
    ['an older host', 'No "query"-procedure on path "notificationRules.getAlarmSensors"'],
    ['a new host, older post-analysis', "child-cap-dispatch: method 'getAlarmSensors' not found on provider 'notification-rules'"],
  ])('%s: the hub is too old - said once, no retry', async (_label, message) => {
    mountScreen(React.createElement(AlarmSettingsScreen), { hub: hub({ sensorsError: message }) })
    await vi.waitFor(() => expect(awayCell('state', CONTACT)).toBe('This hub does not report sensor states — update the hub'))
    // No Retry offered (asking again cannot teach the hub), and no second ask.
    expect(dom.queryByTestId('alarm-sensors-failed')).toBeNull()
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30))
    })
    expect(customCalls('nc.getAlarmSensors')).toHaveLength(1)
    // Leaving the screen and coming back does not ask a hub that cannot answer.
    await act(async () => {
      setTestFocused(false)
    })
    await act(async () => {
      setTestFocused(true)
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30))
    })
    expect(customCalls('nc.getAlarmSensors')).toHaveLength(1)
    expect(awayCell('state', CONTACT)).toBe('This hub does not report sensor states — update the hub')
  })

  it('any other failure is "State unknown" with a Retry - never "closed"', async () => {
    mountScreen(React.createElement(AlarmSettingsScreen), { hub: hub({ sensorsError: 'Request timed out' }) })
    await vi.waitFor(() => expect(awayCell('state', CONTACT)).toBe('State unknown — Request timed out'), { timeout: 3000 })
    const failed = dom.getByTestId('alarm-sensors-failed')
    const before = customCalls('nc.getAlarmSensors').length
    await act(async () => {
      fireEvent.click(within(failed).getByText('Try again'))
    })
    await vi.waitFor(() => expect(customCalls('nc.getAlarmSensors').length).toBeGreaterThan(before))
  })

  it('a failed read is said and retried ONCE, above the cards - not once per mode', async () => {
    const config = {
      ...CONFIG,
      coverage: [
        ...CONFIG.coverage,
        { mode: 'home', ruleCount: 1, allDevices: false, deviceIds: [CONTACT], skippedDevices: NO_SKIPS },
      ],
    }
    mountScreen(React.createElement(AlarmSettingsScreen), { hub: hub({ config, sensorsError: 'Request timed out' }) })
    await vi.waitFor(() => expect(awayCell('state', CONTACT)).toBe('State unknown — Request timed out'), { timeout: 3000 })
    // One mode is shown at a time; the failure line sits above the modes, once.
    expect(dom.getAllByTestId('alarm-sensors-failed')).toHaveLength(1)
    expect(dom.getAllByText('Try again')).toHaveLength(1)
  })

  it('reads the states only while the screen is focused', async () => {
    mountScreen(React.createElement(AlarmSettingsScreen), { hub: hub() })
    // Covered by another route before the first answer arrives.
    await act(async () => {
      setTestFocused(false)
    })
    await dom.findByTestId(`alarm-row-away-${String(CONTACT)}`)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30))
    })
    expect(customCalls('nc.getAlarmSensors')).toHaveLength(0)
    expect(awayCell('state', CONTACT)).toBe('Checking…')
    await act(async () => {
      setTestFocused(true)
    })
    await vi.waitFor(() => expect(awayCell('state', CONTACT)).toBe('closed'))
    expect(customCalls('nc.getAlarmSensors')).toHaveLength(1)
  })

  it('names the zone only once the zones read ANSWERED', async () => {
    mountScreen(React.createElement(AlarmSettingsScreen), { hub: hub() })
    await vi.waitFor(() => expect(awayCell('place', CONTACT)).toContain('Zona giorno · Sala'))
    // A location no zone holds is the location alone - never "No zone".
    await vi.waitFor(() => expect(awayCell('place', STUDY)).toContain('Studio'))
    expect(awayCell('place', STUDY)).not.toContain('No zone')
  })

  it('a zones read that failed shows the location alone - never "No zone"', async () => {
    mountScreen(React.createElement(AlarmSettingsScreen), { hub: hub({ zones: 'fails' }) })
    await dom.findByTestId(`alarm-row-away-${String(CONTACT)}`)
    await vi.waitFor(() => expect(hubCalls().some((c) => c.path === 'deviceManager.listSiteZones')).toBe(true))
    expect(awayCell('place', CONTACT)).toContain('Sala')
    expect(awayCell('place', CONTACT)).not.toContain('Zona giorno')
    expect(awayRow(CONTACT).textContent).not.toContain('No zone')
  })

  it('an older hub without the targeted read says it could not check, and offers a retry', async () => {
    const base = hub()
    const old = { ...base, 'deviceManager.listDeviceIdsByCaps': () => { throw new Error('No procedure found') } }
    mountScreen(React.createElement(AlarmSettingsScreen), { hub: old })
    expect(await dom.findByText(/Couldn't check which devices are openings/)).toBeTruthy()
    expect(dom.queryByTestId('alarm-nonblocking-empty-away')).toBeNull()
    // The failed scan must not leave the state read waiting for a candidate
    // set that never settles: the ids already listed are still read, and their
    // cells end on a real answer or "State unknown" - never "Checking…" (D315).
    await vi.waitFor(() => expect(customCalls('nc.getAlarmSensors').length).toBeGreaterThan(0))
    await vi.waitFor(() => expect(awayCell('state', UNREADABLE)).toBe('Unknown (could not read)'))
    expect(awayCell('state', UNREADABLE)).not.toBe('Checking…')
  })
})

describe('a switch writes ONE edit, one at a time', () => {
  it('sends a single nonBlockingEdit and renders the hub\'s answer', async () => {
    mountScreen(React.createElement(AlarmSettingsScreen), { hub: hub() })
    await dom.findByTestId(`alarm-row-away-${String(CONTACT)}`)
    expect(awayBlocks(CONTACT)).toBe(true)
    await pressAway(CONTACT)
    await vi.waitFor(() => expect(customCalls('nc.setAlarmConfig')).toHaveLength(1))
    expect(customCalls('nc.setAlarmConfig')[0]).toEqual({
      patch: { nonBlockingEdit: { mode: 'away', deviceId: CONTACT, nonBlocking: true } },
    })
    // No whole-list nonBlocking, ever.
    expect(JSON.stringify(customCalls('nc.setAlarmConfig')[0])).not.toContain('"nonBlocking":[')
    await vi.waitFor(() => expect(awayBlocks(CONTACT)).toBe(false))
    expect(dom.queryByText('Unsaved changes')).toBeNull()
  })

  it('a second press while one is in flight is refused BY NAME, and sends nothing', async () => {
    mountScreen(React.createElement(AlarmSettingsScreen), { hub: hub({ holdWrites: true }) })
    await dom.findByTestId(`alarm-row-away-${String(CONTACT)}`)
    await pressAway(CONTACT)
    await vi.waitFor(() => expect(customCalls('nc.setAlarmConfig')).toHaveLength(1))
    await pressAway(STUDY)
    const refused = await dom.findByTestId('alarm-switch-refused')
    expect(refused.textContent).toBe('Saving Back door (Away) — wait for it to finish.')
    expect(customCalls('nc.setAlarmConfig')).toHaveLength(1)
    await act(async () => {
      writeGate.release()
    })
    // The line "wait for it to finish" is gone the moment it has finished.
    await vi.waitFor(() => expect(dom.queryByTestId('alarm-switch-refused')).toBeNull())
    await vi.waitFor(() => expect(awayBlocks(CONTACT)).toBe(false))
  })

  it('a hub that did not keep the edit is said, never silent', async () => {
    mountScreen(React.createElement(AlarmSettingsScreen), { hub: hub({ ignoresSaves: true }) })
    await dom.findByTestId(`alarm-row-away-${String(CONTACT)}`)
    await pressAway(CONTACT)
    const line = await dom.findByTestId('alarm-switch-not-landed')
    expect(line.textContent).toContain('did not apply this change')
    expect(line.textContent).toContain('another editor may have changed it, or the hub needs an update')
    expect(line.textContent).toContain('Back door')
    // The switch shows what the hub holds, not what was asked.
    expect(awayBlocks(CONTACT)).toBe(true)
  })

  it('a write that failed is said with the error', async () => {
    mountScreen(React.createElement(AlarmSettingsScreen), { hub: hub({ writeError: 'hub exploded' }) })
    await dom.findByTestId(`alarm-row-away-${String(CONTACT)}`)
    await pressAway(CONTACT)
    const line = await dom.findByTestId('alarm-switch-failed')
    expect(line.textContent).toBe('Could not change Back door for Away: hub exploded')
  })
})

describe('a controllable opening: Blocks is opt-in, Secure on arm is opt-out', () => {
  it('a cover reads Blocks OFF and Secure on arm ON by default; a contact has no Secure switch', async () => {
    mountScreen(React.createElement(AlarmSettingsScreen), { hub: hub({ withShutter: true }) })
    await dom.findByTestId(`alarm-row-away-${String(SHUTTER)}`)
    await vi.waitFor(() => expect(awaySecureSwitch(SHUTTER)).not.toBeNull())
    expect(awayBlocks(SHUTTER)).toBe(false)
    const secure = awaySecureSwitch(SHUTTER)
    expect(secure !== null && isOn(secure)).toBe(true)
    expect(awaySecureSwitch(CONTACT)).toBeNull()
    expect(awayBlocks(CONTACT)).toBe(true)
  })

  it('switching Blocks ON sends ONE blockingEdit — never a nonBlockingEdit — and shows the answer', async () => {
    mountScreen(React.createElement(AlarmSettingsScreen), { hub: hub({ withShutter: true }) })
    await dom.findByTestId(`alarm-row-away-${String(SHUTTER)}`)
    await vi.waitFor(() => expect(awaySecureSwitch(SHUTTER)).not.toBeNull())
    await pressAway(SHUTTER)
    await vi.waitFor(() => expect(customCalls('nc.setAlarmConfig')).toHaveLength(1))
    expect(customCalls('nc.setAlarmConfig')[0]).toEqual({
      patch: { blockingEdit: { mode: 'away', deviceId: SHUTTER, blocking: true } },
    })
    await vi.waitFor(() => expect(awayBlocks(SHUTTER)).toBe(true))
    expect(dom.queryByTestId('alarm-switch-not-landed')).toBeNull()
  })

  it('switching Secure on arm OFF sends ONE secureOnArmEdit and shows the answer', async () => {
    mountScreen(React.createElement(AlarmSettingsScreen), { hub: hub({ withShutter: true }) })
    await dom.findByTestId(`alarm-row-away-${String(SHUTTER)}`)
    await vi.waitFor(() => expect(awaySecureSwitch(SHUTTER)).not.toBeNull())
    const secure = awaySecureSwitch(SHUTTER)
    if (secure === null) throw new Error('no secure switch')
    await act(async () => {
      fireEvent.click(secure)
    })
    await vi.waitFor(() => expect(customCalls('nc.setAlarmConfig')).toHaveLength(1))
    expect(customCalls('nc.setAlarmConfig')[0]).toEqual({
      patch: { secureOnArmEdit: { mode: 'away', deviceId: SHUTTER, secureOnArm: false } },
    })
    await vi.waitFor(() => {
      const after = awaySecureSwitch(SHUTTER)
      expect(after !== null && isOn(after)).toBe(false)
    })
    // Blocks is untouched by the other switch.
    expect(awayBlocks(SHUTTER)).toBe(false)
    expect(dom.queryByTestId('alarm-switch-not-landed')).toBeNull()
  })

  it('both switches are labelled in both locales', () => {
    for (const key of ['v2.nc.alarm.table.secureOnArm', 'v2.nc.alarm.table.secureSwitchLabel']) {
      expect(lookupLocale(enLocale, key), `en ${key}`).toBeTypeOf('string')
      expect(lookupLocale(itLocale, key), `it ${key}`).toBeTypeOf('string')
    }
  })
})

describe('Save', () => {
  it('sends only what changed, and re-reads config and status when it settles', async () => {
    mountScreen(React.createElement(AlarmSettingsScreen), { hub: hub() })
    await dom.findByTestId('alarm-delay-exitDelaySec')
    const configReads = customCalls('nc.getAlarmConfig').length
    const statusReads = customCalls('nc.getAlarmStatus').length
    await act(async () => {
      fireEvent.change(dom.getByTestId('alarm-delay-exitDelaySec'), { target: { value: '45' } })
    })
    await dom.findByText('Unsaved changes')
    await act(async () => {
      fireEvent.click(dom.getByText('Save'))
    })
    await vi.waitFor(() => expect(customCalls('nc.setAlarmConfig')).toHaveLength(1))
    expect(customCalls('nc.setAlarmConfig')[0]).toEqual({ patch: { exitDelaySec: 45 } })
    await vi.waitFor(() => expect(customCalls('nc.getAlarmConfig').length).toBeGreaterThan(configReads))
    await vi.waitFor(() => expect(customCalls('nc.getAlarmStatus').length).toBeGreaterThan(statusReads))
    await vi.waitFor(() => expect(dom.queryByText('Unsaved changes')).toBeNull())
  })

  it('a Save sends no nonBlocking: the draft holds delays only', async () => {
    mountScreen(React.createElement(AlarmSettingsScreen), { hub: hub() })
    await dom.findByTestId(`alarm-row-away-${String(CONTACT)}`)
    await act(async () => {
      fireEvent.change(dom.getByTestId('alarm-delay-entryDelaySec'), { target: { value: '45' } })
    })
    await act(async () => {
      fireEvent.click(dom.getByText('Save'))
    })
    await vi.waitFor(() => expect(customCalls('nc.setAlarmConfig')).toHaveLength(1))
    const sent = customCalls('nc.setAlarmConfig')[0]
    expect(sent).toEqual({ patch: { entryDelaySec: 45 } })
    expect(JSON.stringify(sent)).not.toContain('nonBlocking')
  })
})

function typeInto(testId: string, value: string): void {
  fireEvent.change(dom.getByTestId(testId), { target: { value } })
}

describe('a typed delay', () => {
  it('is saved WITHOUT leaving the field, and the box then shows what the hub holds', async () => {
    mountScreen(React.createElement(AlarmSettingsScreen), { hub: hub() })
    await dom.findByTestId('alarm-delay-entryDelaySec')
    await act(async () => {
      typeInto('alarm-delay-entryDelaySec', '45')
    })
    // No blur, no submit: Save straight away.
    await act(async () => {
      fireEvent.click(dom.getByText('Save'))
    })
    await vi.waitFor(() => expect(customCalls('nc.setAlarmConfig')).toHaveLength(1))
    expect(customCalls('nc.setAlarmConfig')[0]).toEqual({ patch: { entryDelaySec: 45 } })
    await vi.waitFor(() => expect(dom.queryByText('Unsaved changes')).toBeNull())
    expect(dom.getByTestId('alarm-delay-entryDelaySec')).toHaveProperty('value', '45')
  })

  it('Discard puts the typed box back to the stored value', async () => {
    mountScreen(React.createElement(AlarmSettingsScreen), { hub: hub() })
    await dom.findByTestId('alarm-delay-exitDelaySec')
    await act(async () => {
      typeInto('alarm-delay-exitDelaySec', '90')
    })
    expect(dom.getByTestId('alarm-delay-exitDelaySec')).toHaveProperty('value', '90')
    await act(async () => {
      fireEvent.click(dom.getByText('Discard'))
    })
    expect(dom.getByTestId('alarm-delay-exitDelaySec')).toHaveProperty('value', '30')
    expect(customCalls('nc.setAlarmConfig')).toHaveLength(0)
  })
})

describe('leaving with unsaved changes', () => {
  // The drawn confirmation is the WEB rendering (the harness default, iOS,
  // hands it to the system alert).
  beforeEach(() => setTestPlatform('web'))
  afterEach(() => setTestPlatform('ios'))

  it('arms the guard on a change, asks, and lets the confirmed leave through', async () => {
    mountScreen(React.createElement(AlarmSettingsScreen), { hub: hub() })
    await dom.findByTestId('alarm-delay-exitDelaySec')
    expect(guard.enabled).toBe(false)
    await act(async () => {
      typeInto('alarm-delay-exitDelaySec', '90')
    })
    expect(guard.enabled).toBe(true)
    act(() => guard.callback?.({ data: { action: 'GO_BACK' } }))
    await dom.findByText('Discard alarm changes?')
    // Nothing leaves until the operator confirms.
    expect(routerCalls().some((call) => call.kind === 'dispatch')).toBe(false)
    await act(async () => {
      // The dialog's own Discard is the LAST one drawn (the Save bar has one too).
      const discards = dom.getAllByText('Discard')
      fireEvent.click(discards[discards.length - 1])
    })
    await vi.waitFor(() =>
      expect(routerCalls().some((call) => call.kind === 'dispatch' && call.target === 'GO_BACK')).toBe(true),
    )
  })
})

describe('an edit made while someone else changed the config', () => {
  it('Save re-reads the config and lays the draft on THAT — no refetch needed before', async () => {
    mountScreen(React.createElement(AlarmSettingsScreen), { hub: hub() })
    // This admin types a longer entry delay.
    await dom.findByTestId('alarm-delay-entryDelaySec')
    await act(async () => {
      fireEvent.change(dom.getByTestId('alarm-delay-entryDelaySec'), { target: { value: '45' } })
    })
    // Meanwhile another admin removed Device #99 from `away` and changed the
    // exit delay. Nothing tells this screen: no event, no invalidation.
    server.config = {
      ...server.config,
      settings: { ...server.config.settings, exitDelaySec: 50, nonBlocking: [] },
    }
    await act(async () => {
      fireEvent.click(dom.getByText('Save'))
    })
    await vi.waitFor(() => expect(customCalls('nc.setAlarmConfig')).toHaveLength(1))
    // The other exit delay is kept and 99 stays removed — only this draft's delay is sent.
    expect(customCalls('nc.setAlarmConfig')[0]).toEqual({ patch: { entryDelaySec: 45 } })
    await dom.findByTestId('alarm-changed-elsewhere')
  })

  it('a failed re-read saves NOTHING, says so, and keeps the draft', async () => {
    let reads = 0
    const base = hub()
    const failing = {
      ...base,
      'addons.custom': (input?: unknown): unknown => {
        if (field(input, 'action') === 'nc.getAlarmConfig') {
          reads += 1
          if (reads > 1) throw new Error('hub unreachable')
        }
        const inner = base['addons.custom']
        return typeof inner === 'function' ? inner(input) : undefined
      },
    }
    mountScreen(React.createElement(AlarmSettingsScreen), { hub: failing })
    await dom.findByTestId('alarm-delay-entryDelaySec')
    await act(async () => {
      fireEvent.change(dom.getByTestId('alarm-delay-entryDelaySec'), { target: { value: '45' } })
    })
    await act(async () => {
      fireEvent.click(dom.getByText('Save'))
    })
    await dom.findByTestId('alarm-refresh-failed')
    expect(customCalls('nc.setAlarmConfig')).toHaveLength(0)
    expect(dom.getByText('Unsaved changes')).toBeTruthy()
    expect(dom.getByTestId('alarm-delay-entryDelaySec')).toHaveProperty('value', '45')
  })
})

describe('Discard', () => {
  it('is enabled only by a real edit', async () => {
    mountScreen(React.createElement(AlarmSettingsScreen), { hub: hub() })
    await dom.findByTestId('alarm-delay-exitDelaySec')
    const discard = (): Element | null => dom.getByText('Discard').closest('[role="button"]')
    expect(discard()?.getAttribute('aria-disabled')).toBe('true')
    await act(async () => {
      typeInto('alarm-delay-exitDelaySec', '31')
    })
    expect(discard()?.getAttribute('aria-disabled')).not.toBe('true')
    // Typed back to the stored value: nothing to discard any more.
    await act(async () => {
      typeInto('alarm-delay-exitDelaySec', '30')
    })
    expect(discard()?.getAttribute('aria-disabled')).toBe('true')
  })
})

describe('a save the hub did not keep', () => {
  it('says the hub is too old and keeps the draft', async () => {
    mountScreen(React.createElement(AlarmSettingsScreen), { hub: hub({ ignoresSaves: true }) })
    await dom.findByTestId('alarm-delay-entryDelaySec')
    await act(async () => {
      fireEvent.change(dom.getByTestId('alarm-delay-entryDelaySec'), { target: { value: '45' } })
    })
    await act(async () => {
      fireEvent.click(dom.getByText('Save'))
    })
    await dom.findByTestId('alarm-save-not-landed')
    expect(dom.getByText('Unsaved changes')).toBeTruthy()
    expect(dom.getByTestId('alarm-delay-entryDelaySec')).toHaveProperty('value', '45')
  })
})

describe('a household with no opening at all', () => {
  it('says so — once the scan answered, and not before', async () => {
    const config = {
      ...CONFIG,
      settings: { ...CONFIG.settings, nonBlocking: [] },
      coverage: [{ mode: 'away', ruleCount: 1, allDevices: true, deviceIds: [], skippedDevices: [] }],
      live: { ...CONFIG.live, openings: [{ mode: 'away', devices: [], unknown: [] }] },
    }
    mountScreen(React.createElement(AlarmSettingsScreen), { hub: hub({ config, noOpenings: true }) })
    const line = await dom.findByTestId('alarm-nonblocking-empty-away')
    expect(line.textContent).toMatch(/household has no opening/)
  })
})

describe('the Notification Center Alarm section', () => {
  it('a confirmed admin gets it, and it shows the alarm configuration in place', async () => {
    mountScreen(React.createElement(NotificationCenterScreen), { hub: hub() })
    // The selector's segment — the Rules strip has an Alarm KIND chip too.
    const segment = within(await dom.findByTestId('segmented-control-glass')).getByText('Alarm')
    await act(async () => {
      fireEvent.click(segment)
    })
    // The form itself, inside the section — not a push to another screen.
    await dom.findByTestId('alarm-delay-entryDelaySec')
    expect(routerCalls()).not.toContainEqual({ kind: 'push', target: '/settings/alarm' })
    // A tab never asks before being left: the draft stays mounted instead.
    expect(guard.enabled).toBe(false)
  })

  it('a non-admin never sees it', async () => {
    mountScreen(React.createElement(NotificationCenterScreen), { hub: hub({ isAdmin: false }) })
    await vi.waitFor(() => expect(hubCalls().some((c) => c.path === 'auth.me')).toBe(true))
    // Let the verdict settle before asserting an absence.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    expect(within(dom.getByTestId('segmented-control-glass')).queryByText('Alarm')).toBeNull()
    expect(dom.queryByTestId('nc-section-alarm')).toBeNull()
  })
})

/** A hub whose SECOND config read (Save's re-read) waits until released. */
function heldReadHub(): { readonly responses: Readonly<Record<string, unknown>>; readonly release: () => void } {
  let reads = 0
  let release: () => void = () => undefined
  const base = hub()
  const inner = base['addons.custom']
  const responses = {
    ...base,
    'addons.custom': (input?: unknown): unknown => {
      const answer = typeof inner === 'function' ? inner(input) : undefined
      if (field(input, 'action') !== 'nc.getAlarmConfig') return answer
      reads += 1
      if (reads === 1) return answer
      return new Promise((resolve) => {
        release = () => resolve(answer)
      })
    },
  }
  return { responses, release: () => release() }
}

describe('a discarded draft is never sent (fix round 3)', () => {
  beforeEach(() => setTestPlatform('web'))
  afterEach(() => setTestPlatform('ios'))

  it('Save, then leave and Discard before the re-read answers: nothing is saved', async () => {
    const held = heldReadHub()
    mountScreen(React.createElement(AlarmSettingsScreen), { hub: held.responses })
    await dom.findByTestId('alarm-delay-exitDelaySec')
    await act(async () => {
      typeInto('alarm-delay-exitDelaySec', '90')
    })
    await act(async () => {
      fireEvent.click(dom.getByText('Save'))
    })
    act(() => guard.callback?.({ data: { action: 'GO_BACK' } }))
    await dom.findByText('Discard alarm changes?')
    await act(async () => {
      const discards = dom.getAllByText('Discard')
      fireEvent.click(discards[discards.length - 1])
    })
    await vi.waitFor(() =>
      expect(routerCalls().some((call) => call.kind === 'dispatch' && call.target === 'GO_BACK')).toBe(true),
    )
    await act(async () => {
      held.release()
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    expect(customCalls('nc.setAlarmConfig')).toHaveLength(0)
  })

  it('Save, then the screen goes away before the re-read answers: nothing is saved', async () => {
    const held = heldReadHub()
    const view = mountScreen(React.createElement(AlarmSettingsScreen), { hub: held.responses })
    await dom.findByTestId('alarm-delay-exitDelaySec')
    await act(async () => {
      typeInto('alarm-delay-exitDelaySec', '90')
    })
    await act(async () => {
      fireEvent.click(dom.getByText('Save'))
    })
    view.unmount()
    await act(async () => {
      held.release()
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    expect(customCalls('nc.setAlarmConfig')).toHaveLength(0)
  })
})

describe('the delay box (fix round 3)', () => {
  it('an emptied box can be discarded, and shows the stored value again', async () => {
    mountScreen(React.createElement(AlarmSettingsScreen), { hub: hub() })
    await dom.findByTestId('alarm-delay-exitDelaySec')
    await act(async () => {
      typeInto('alarm-delay-exitDelaySec', '')
    })
    const discard = dom.getByText('Discard').closest('[role="button"]')
    expect(discard?.getAttribute('aria-disabled')).not.toBe('true')
    await act(async () => {
      fireEvent.click(dom.getByText('Discard'))
    })
    expect(dom.getByTestId('alarm-delay-exitDelaySec')).toHaveProperty('value', '30')
  })

  it('once left, the box shows what Save will send', async () => {
    mountScreen(React.createElement(AlarmSettingsScreen), { hub: hub() })
    const box = await dom.findByTestId('alarm-delay-entryDelaySec')
    await act(async () => {
      typeInto('alarm-delay-entryDelaySec', '12.5')
    })
    await act(async () => {
      fireEvent.blur(box)
    })
    expect(dom.getByTestId('alarm-delay-entryDelaySec')).toHaveProperty('value', '13')
  })
})


describe('per-mode delays (D697)', () => {
  const OVERRIDE_EQUAL_TO_GLOBAL = {
    ...CONFIG,
    settings: { ...CONFIG.settings, modeDelays: [{ mode: 'away', exitDelaySec: 30 }] },
  }

  function lastSaved(): unknown {
    return customCalls('nc.setAlarmConfig').at(-1)
  }

  async function saveNow(): Promise<void> {
    await act(async () => {
      fireEvent.click(dom.getByText('Save'))
    })
    await vi.waitFor(() => expect(customCalls('nc.setAlarmConfig').length).toBeGreaterThan(0))
  }

  it('each mode shows its three delays, the inherited ones as "Default (n s)"', async () => {
    mountScreen(React.createElement(AlarmSettingsScreen), { hub: hub({ config: OVERRIDE_EQUAL_TO_GLOBAL }) })
    await dom.findByTestId('alarm-delays-away')
    expect(dom.getByText('Default delays')).toBeTruthy()
    expect(dom.getByTestId('alarm-delay-away-entryDelaySec-inherited').textContent).toBe('Default (20 s)')
    expect(dom.getByTestId('alarm-delay-away-exitDelaySec')).toHaveProperty('value', '30')
    // The override EQUAL to the default is still an override: "Use default" is offered.
    expect(dom.queryByTestId('alarm-delay-away-exitDelaySec-inherited')).toBeNull()
    expect(dom.getByTestId('alarm-delay-away-exitDelaySec-default')).toBeTruthy()
    expect(dom.queryByTestId('alarm-delay-away-entryDelaySec-default')).toBeNull()
  })

  it('one Save sends modeDelays for the touched mode and field only', async () => {
    mountScreen(React.createElement(AlarmSettingsScreen), { hub: hub() })
    await dom.findByTestId('alarm-delays-away')
    await act(async () => {
      typeInto('alarm-delay-away-entryDelaySec', '45')
    })
    await saveNow()
    expect(lastSaved()).toEqual({ patch: { modeDelays: [{ mode: 'away', entryDelaySec: 45 }] } })
    // The hub kept it: the mode now overrides, and offers "Use default".
    await vi.waitFor(() => expect(dom.getByTestId('alarm-delay-away-entryDelaySec-default')).toBeTruthy())
  })

  it('typing the default value on a mode with no override still sets it', async () => {
    mountScreen(React.createElement(AlarmSettingsScreen), { hub: hub() })
    await dom.findByTestId('alarm-delays-away')
    await act(async () => {
      // The box already reads 20 (inherited): move off it and back, as a thumb would.
      typeInto('alarm-delay-away-entryDelaySec', '2')
    })
    await act(async () => {
      typeInto('alarm-delay-away-entryDelaySec', '20')
    })
    await saveNow()
    expect(lastSaved()).toEqual({ patch: { modeDelays: [{ mode: 'away', entryDelaySec: 20 }] } })
  })

  it('"Use default" on an override equal to the default sends null - decided by presence, not value', async () => {
    mountScreen(React.createElement(AlarmSettingsScreen), { hub: hub({ config: OVERRIDE_EQUAL_TO_GLOBAL }) })
    await dom.findByTestId('alarm-delays-away')
    await act(async () => {
      fireEvent.click(dom.getByTestId('alarm-delay-away-exitDelaySec-default'))
    })
    await dom.findByText('Unsaved changes')
    await saveNow()
    expect(lastSaved()).toEqual({ patch: { modeDelays: [{ mode: 'away', exitDelaySec: null }] } })
    await vi.waitFor(() => expect(dom.getByTestId('alarm-delay-away-exitDelaySec-inherited').textContent).toBe('Default (30 s)'))
  })

  it('an older hub that strips modeDelays is said, never shown as saved', async () => {
    mountScreen(React.createElement(AlarmSettingsScreen), { hub: hub({ ignoresSaves: true }) })
    await dom.findByTestId('alarm-delays-away')
    await act(async () => {
      typeInto('alarm-delay-away-entryDelaySec', '45')
    })
    await saveNow()
    expect(await dom.findByTestId('alarm-save-not-landed')).toBeTruthy()
  })
})
