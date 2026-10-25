/**
 * The viewer's client onto the alarm bridge actions (`nc.getAlarmStatus`,
 * `nc.armAlarm`, `nc.armAlarmAnyway`, `nc.disarmAlarm`, `nc.getAlarmConfig`,
 * `nc.setAlarmConfig` on `pipeline-analytics`).
 *
 * The point of the bridge is that a REFUSED arm is a result carrying its id —
 * the cap can only throw it. So the mirror must parse that result, and must
 * refuse an answer it cannot read rather than render it as "armed".
 */
import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { makeNcClient } from '../notification-center.js'
import {
  ALARM_SENSORS_KEY,
  ALARM_SENSORS_REFUSAL_TTL_MS,
  alarmSensorsRefetchMs,
  alarmSensorsRefused,
  forgetAlarmSensorsRefusals,
  alarmSensorsShouldRetry,
  alarmSwitchPress,
  readAlarmSensorsChunked,
} from '../use-nc-alarm.js'
import { NC_ALARM_SENSORS_MAX } from '@camstack/types/client'
import type { AlarmSensorRow, AlarmSwitchWrite } from '../../components/notifications/alarm-sensor-table-model.js'
import {
  NC_ALARM_FAST_POLL_MS,
  NC_ALARM_SLOW_POLL_MS,
  NcAlarmArmOutcomeSchema,
  classifyNcAlarmStatusError,
  ncAlarmPanelFrom,
  ncAlarmPollMs,
  ncAlarmStatusIntervalMs,
  ncAlarmStatusShouldRetry,
  type NcAlarmStatus,
} from '../nc-alarm.js'

const RULES = 'pipeline-analytics'

describe('nc alarm client — routing', () => {
  it('arms through nc.armAlarm with the mode only (never a device id)', async () => {
    const mutate = vi.fn().mockResolvedValue({ outcome: 'arming', excluded: [] })
    const outcome = await makeNcClient({ addonsCustomMutate: mutate }).armAlarm('away')
    expect(mutate).toHaveBeenCalledWith({ addonId: RULES, action: 'nc.armAlarm', input: { mode: 'away' } })
    expect(outcome).toEqual({ outcome: 'arming', excluded: [] })
  })

  it('Arm anyway carries exactly the refusal id it was shown', async () => {
    const mutate = vi.fn().mockResolvedValue({ outcome: 'armed', excluded: [{ deviceId: 42, name: 'Porch', state: 'open' }] })
    await makeNcClient({ addonsCustomMutate: mutate }).armAlarmAnyway('refusal-1')
    expect(mutate).toHaveBeenCalledWith({
      addonId: RULES,
      action: 'nc.armAlarmAnyway',
      input: { refusalId: 'refusal-1' },
    })
  })

  it('disarms through nc.disarmAlarm', async () => {
    const mutate = vi.fn().mockResolvedValue({ success: true })
    await makeNcClient({ addonsCustomMutate: mutate }).disarmAlarm()
    expect(mutate).toHaveBeenCalledWith({ addonId: RULES, action: 'nc.disarmAlarm', input: {} })
  })

  it('reads the status, and a panel-less hub answers null — not "disarmed"', async () => {
    const mutate = vi.fn().mockResolvedValue({ deviceId: null, live: null })
    const status = await makeNcClient({ addonsCustomMutate: mutate }).getAlarmStatus()
    expect(mutate).toHaveBeenCalledWith({ addonId: RULES, action: 'nc.getAlarmStatus', input: {} })
    expect(status).toEqual({ deviceId: null, live: null })
  })

  it('sends a config patch as { patch }', async () => {
    const config = {
      deviceId: 1201,
      settings: { exitDelaySec: 30, entryDelaySec: 20, triggeredDurationSec: 0, announceTargets: [], nonBlocking: [] },
      coverage: [],
    }
    const mutate = vi.fn().mockResolvedValue(config)
    const client = makeNcClient({ addonsCustomMutate: mutate })
    await client.setAlarmConfig({ exitDelaySec: 45 })
    expect(mutate).toHaveBeenCalledWith({ addonId: RULES, action: 'nc.setAlarmConfig', input: { patch: { exitDelaySec: 45 } } })
    await client.getAlarmConfig()
    expect(mutate).toHaveBeenLastCalledWith({ addonId: RULES, action: 'nc.getAlarmConfig', input: {} })
  })
})

describe('nc alarm client — the outcome mirror', () => {
  it('a refusal is a RESULT with its id and blockers', async () => {
    const answer = { outcome: 'refused', refusalId: 'r-9', blocking: [{ deviceId: 42, name: 'Porch', state: 'open' }] }
    const mutate = vi.fn().mockResolvedValue(answer)
    await expect(makeNcClient({ addonsCustomMutate: mutate }).armAlarm('home')).resolves.toEqual(answer)
  })

  it('a rejected Arm anyway carries its reason', () => {
    expect(NcAlarmArmOutcomeSchema.parse({ outcome: 'rejected', reason: 'stale' })).toEqual({
      outcome: 'rejected',
      reason: 'stale',
    })
  })

  it('an answer it cannot read THROWS — never an "armed"', async () => {
    const mutate = vi.fn().mockResolvedValue({ outcome: 'refused' })
    await expect(makeNcClient({ addonsCustomMutate: mutate }).armAlarm('home')).rejects.toThrow()
  })
})

const OLD_HUB_ROUTER =
  "addon 'pipeline-analytics' has no custom action 'nc.getAlarmStatus' — known actions: nc.listRules, nc.testRule"
const OLD_HUB_CHILD = 'child-addon-call: addon "pipeline-analytics" has no custom action "nc.getAlarmStatus"'
const OLD_HUB_HANDLER = "addon 'pipeline-analytics' has no handler for custom action 'nc.getAlarmStatus'"
const NOT_WIRED = 'nc.getAlarmStatus: the alarm is not wired on this node'

describe('classifyNcAlarmStatusError — only a refusal BY NAME means "no nc panel"', () => {
  it.each([
    ['the hub router (older hub)', OLD_HUB_ROUTER],
    ['the forked addon (older addon)', OLD_HUB_CHILD],
    ['the in-process registry (older addon)', OLD_HUB_HANDLER],
    ['a node with no panel', NOT_WIRED],
  ])('%s → no-nc-panel', (_label, message) => {
    expect(classifyNcAlarmStatusError(new Error(message))).toBe('no-nc-panel')
  })

  it.each([
    ['the addon respawning (no addon registers actions)', "no addon 'pipeline-analytics' registers custom actions (expected a manifest addon id)"],
    ['a timeout', 'Request timed out'],
    ['a dropped socket', 'WebSocket closed before the connection was established'],
    ['a role change', 'custom action requires admin'],
    ['ANOTHER action refused by name', "addon 'pipeline-analytics' has no custom action 'nc.listPrunes'"],
  ])('%s → transient', (_label, message) => {
    expect(classifyNcAlarmStatusError(new Error(message))).toBe('transient')
  })

  it('something that is not an error at all → transient', () => {
    expect(classifyNcAlarmStatusError(42)).toBe('transient')
  })
})

describe('ncAlarmStatusShouldRetry — a transient failure is retried, a by-name refusal is not', () => {
  it('retries a transient failure a bounded number of times', () => {
    expect(ncAlarmStatusShouldRetry(0, new Error('Request timed out'))).toBe(true)
    expect(ncAlarmStatusShouldRetry(3, new Error('Request timed out'))).toBe(true)
    expect(ncAlarmStatusShouldRetry(4, new Error('Request timed out'))).toBe(false)
  })

  it('never retries a refusal by name', () => {
    expect(ncAlarmStatusShouldRetry(0, new Error(OLD_HUB_ROUTER))).toBe(false)
  })
})

describe('ncAlarmPanelFrom — which device is the NC panel', () => {
  it('an answer names the panel', () => {
    expect(ncAlarmPanelFrom({ data: { deviceId: 1201, live: null }, error: null })).toEqual({ kind: 'known', panelId: 1201 })
  })

  it('an older hub that refuses the read BY NAME falls back to the cap path', () => {
    expect(ncAlarmPanelFrom({ data: undefined, error: new Error(OLD_HUB_ROUTER) })).toEqual({ kind: 'known', panelId: null })
  })

  it('any other failure is UNKNOWN — not "no panel"', () => {
    expect(ncAlarmPanelFrom({ data: undefined, error: new Error('Request timed out') })).toEqual({ kind: 'unknown' })
  })

  it('an unanswered read is pending — not "no panel"', () => {
    expect(ncAlarmPanelFrom({ data: undefined, error: null })).toEqual({ kind: 'pending' })
  })

  it('an answer wins over a later failed refetch', () => {
    expect(ncAlarmPanelFrom({ data: { deviceId: 1201, live: null }, error: new Error('Request timed out') })).toEqual({
      kind: 'known',
      panelId: 1201,
    })
  })
})

describe('ncAlarmStatusIntervalMs — only the NC panel\'s own row polls (m1)', () => {
  it('the NC panel row polls at the state\'s cadence', () => {
    const data: NcAlarmStatus = {
      deviceId: 1201,
      live: { state: 'arming', targetMode: 'away', availableModes: [], openings: [], exclusions: [], bypassedInputs: [] },
    }
    expect(ncAlarmStatusIntervalMs(1201, { data, error: null })).toBe(NC_ALARM_FAST_POLL_MS)
  })

  it('any other row does not poll', () => {
    expect(ncAlarmStatusIntervalMs(77, { data: { deviceId: 1201, live: null }, error: null })).toBe(false)
  })

  it('an unknown lookup keeps asking', () => {
    expect(ncAlarmStatusIntervalMs(77, { data: undefined, error: new Error('Request timed out') })).toBe(NC_ALARM_SLOW_POLL_MS)
  })
})

describe('ncAlarmPollMs', () => {
  it('asks often only while a delay or the siren runs', () => {
    for (const state of ['arming', 'pending', 'triggered'] as const) expect(ncAlarmPollMs(state)).toBe(NC_ALARM_FAST_POLL_MS)
    expect(ncAlarmPollMs('armed_away')).toBe(NC_ALARM_SLOW_POLL_MS)
    expect(ncAlarmPollMs(undefined)).toBe(NC_ALARM_SLOW_POLL_MS)
  })
})

describe('nc.getAlarmSensors', () => {
  it('calls the bridge with { deviceIds } and parses the answer', async () => {
    const answer = {
      sensors: [
        { deviceId: 43, reading: 'closed', state: 'closed', unknownWhy: null, online: true, controllable: false },
      ],
      readAt: 1_000,
    }
    const mutate = vi.fn().mockResolvedValue(answer)
    const out = await makeNcClient({ addonsCustomMutate: mutate }).getAlarmSensors([43, 60])
    expect(mutate).toHaveBeenCalledWith({
      addonId: RULES,
      action: 'nc.getAlarmSensors',
      input: { deviceIds: [43, 60] },
    })
    expect(out).toEqual(answer)
  })

  it('an answer it cannot read THROWS - never a "closed"', async () => {
    const mutate = vi.fn().mockResolvedValue({ sensors: [{ deviceId: 43, reading: 'shut' }], readAt: 1 })
    await expect(makeNcClient({ addonsCustomMutate: mutate }).getAlarmSensors([43])).rejects.toThrow()
  })
})

const HUB_TOO_OLD = 'child-addon-call: addon "pipeline-analytics" has no custom action "nc.getAlarmSensors"'

describe('the sensors read policy', () => {
  it('polls fast while the panel is active, slowly otherwise', () => {
    expect(alarmSensorsRefetchMs(true, null)).toBe(5_000)
    expect(alarmSensorsRefetchMs(false, null)).toBe(15_000)
  })

  it('never polls, and never retries, a hub that refused the read BY NAME', () => {
    expect(alarmSensorsRefetchMs(true, new Error(HUB_TOO_OLD))).toBe(false)
    expect(alarmSensorsShouldRetry(0, new Error(HUB_TOO_OLD))).toBe(false)
  })

  it('retries any other failure twice at most', () => {
    expect(alarmSensorsShouldRetry(0, new Error('Request timed out'))).toBe(true)
    expect(alarmSensorsShouldRetry(1, new Error('Request timed out'))).toBe(true)
    expect(alarmSensorsShouldRetry(2, new Error('Request timed out'))).toBe(false)
  })

  it('reads chunks of at most NC_ALARM_SENSORS_MAX ids IN SEQUENCE and merges them', async () => {
    const ids = Array.from({ length: NC_ALARM_SENSORS_MAX + 3 }, (_v, i) => i + 1)
    let running = 0
    let overlapped = false
    const sizes: number[] = []
    const read = async (chunk: readonly number[]) => {
      running += 1
      if (running > 1) overlapped = true
      sizes.push(chunk.length)
      await Promise.resolve()
      running -= 1
      return {
        sensors: chunk.map((deviceId) => ({
          deviceId,
          reading: 'closed' as const,
          state: 'closed',
          unknownWhy: null,
          online: true,
          controllable: false,
        })),
        readAt: 100 + sizes.length,
      }
    }
    const merged = await readAlarmSensorsChunked(ids, read)
    expect(sizes).toEqual([NC_ALARM_SENSORS_MAX, 3])
    expect(overlapped).toBe(false)
    expect(merged.sensors).toHaveLength(ids.length)
    // The oldest chunk bounds how fresh the whole read is.
    expect(merged.readAt).toBe(101)
  })

  it('one failed chunk fails the whole read', async () => {
    const ids = Array.from({ length: NC_ALARM_SENSORS_MAX + 1 }, (_v, i) => i + 1)
    let calls = 0
    const read = (): Promise<never> => {
      calls += 1
      return Promise.reject(new Error('chunk failed'))
    }
    await expect(readAlarmSensorsChunked(ids, read)).rejects.toThrow('chunk failed')
    expect(calls).toBe(1)
  })
})

describe('alarmSwitchPress - one write at a time', () => {
  const row: AlarmSensorRow = {
    device: { id: 43, name: 'Back door' },
    removed: false,
    cell: { kind: 'checking' },
    coverage: { kind: 'arm-checked' },
    controllable: false,
    blocks: true,
    secureOnArm: false,
    listedUncovered: false,
  }
  const first: AlarmSwitchWrite = {
    mode: 'away',
    deviceId: 9,
    name: 'Porch',
    kind: 'blocks',
    nextValue: false,
    controllable: false,
  }

  it('starts a write when none is in flight', () => {
    expect(alarmSwitchPress(null, 'away', row, 'blocks', false)).toEqual({
      kind: 'start',
      write: {
        mode: 'away',
        deviceId: 43,
        name: 'Back door',
        kind: 'blocks',
        nextValue: false,
        controllable: false,
      },
    })
  })

  it('refuses a second press NAMING the one in flight', () => {
    expect(alarmSwitchPress(first, 'night', row, 'blocks', false)).toEqual({
      kind: 'refused',
      inFlight: first,
    })
  })
})

describe('the by-name refusal has a way back after a hub upgrade (V5 F1)', () => {
  async function refusedClient(message: string): Promise<QueryClient> {
    const client = new QueryClient()
    await client
      .fetchQuery({
        queryKey: [...ALARM_SENSORS_KEY, [1, 2]],
        queryFn: () => Promise.reject(new Error(message)),
        retry: false,
      })
      .catch(() => undefined)
    return client
  }

  it('refuses while the refusal is fresh, and stops refusing once its TTL has passed', async () => {
    const client = await refusedClient(HUB_TOO_OLD)
    const cache = client.getQueryCache()
    const at = cache.findAll({ queryKey: ALARM_SENSORS_KEY })[0]?.state.errorUpdatedAt ?? 0
    expect(alarmSensorsRefused(cache, at + 1_000)).toBe(true)
    expect(alarmSensorsRefused(cache, at + ALARM_SENSORS_REFUSAL_TTL_MS - 1)).toBe(true)
    // Time passed: the hub may have been upgraded - a new read is asked.
    expect(alarmSensorsRefused(cache, at + ALARM_SENSORS_REFUSAL_TTL_MS + 1)).toBe(false)
  })

  it('a transient failure is never a refusal', async () => {
    const client = await refusedClient('Request timed out')
    expect(alarmSensorsRefused(client.getQueryCache(), Date.now())).toBe(false)
  })

  it('a reconnect forgets the refusal, so a new read is asked and can answer', async () => {
    const client = await refusedClient(HUB_TOO_OLD)
    const cache = client.getQueryCache()
    expect(alarmSensorsRefused(cache, Date.now())).toBe(true)
    forgetAlarmSensorsRefusals(cache)
    expect(alarmSensorsRefused(cache, Date.now())).toBe(false)
    // The gate is open again: the read is asked and the upgraded hub answers.
    const answer = { sensors: [], readAt: 7 }
    await expect(
      client.fetchQuery({ queryKey: [...ALARM_SENSORS_KEY, [1, 2]], queryFn: () => Promise.resolve(answer), retry: false }),
    ).resolves.toEqual(answer)
  })

  it('a reconnect keeps a read that answered', async () => {
    const client = new QueryClient()
    await client.fetchQuery({
      queryKey: [...ALARM_SENSORS_KEY, [1]],
      queryFn: () => Promise.resolve({ sensors: [], readAt: 1 }),
    })
    forgetAlarmSensorsRefusals(client.getQueryCache())
    expect(client.getQueryCache().findAll({ queryKey: ALARM_SENSORS_KEY })).toHaveLength(1)
  })
})
