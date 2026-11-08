/**
 * @vitest-environment jsdom
 *
 * The device detail, mounted against a stub hub: a heater, a washer and a door
 * contact fill their slots from their caps; clear of the safe areas.
 *
 * `DEVICE_SHOTS_DIR=<dir> npx vitest run src/screens/__tests__/device-detail-mount.spec.ts`
 * dumps each page as standalone HTML per theme and width for the web shots.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import fs from 'node:fs'
import path from 'node:path'
import React from 'react'

import { mountScreen } from '../../testing/mount.js'
import { hubCalls } from '../../testing/hub-stub.js'
import { THEME_STORAGE_KEY } from '../../theme/resolve-theme.js'
import { DeviceDetailScreen } from '../DeviceDetailScreen.js'
import { deviceTabs } from '../device-detail/device-tabs.js'

vi.mock('react-native-svg', async () => {
  const React = await import('react')
  const tag = (name: string) => {
    const Node = ({ children, ...props }: Record<string, unknown>) => {
      const { style: _style, ...rest } = props
      return React.createElement(name, rest, children as React.ReactNode)
    }
    return Node
  }
  const Svg = tag('svg')
  return {
    __esModule: true, default: Svg, Svg, Circle: tag('circle'), Ellipse: tag('ellipse'), G: tag('g'),
    Line: tag('line'), Path: tag('path'), Polygon: tag('polygon'), Polyline: tag('polyline'),
    Rect: tag('rect'), Defs: tag('defs'), ClipPath: tag('clipPath'),
  }
})

const scope = vi.hoisted(() => ({ canActuate: true }))
vi.mock('../../hooks/use-user-scope.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../hooks/use-user-scope.js')>()),
  useCanActuate: () => scope.canActuate,
}))

vi.mock('../../connection/ConnectionProvider.js', async () =>
  (await import('../../testing/connection-stub.js')).connectionStubModule(),
)

const MIN = 60_000
const HOUR = 60 * MIN

const point = (t: number, extra: Record<string, unknown>) => ({
  t, samples: 1, mean: null, twMean: null, min: 0, max: 0, last: null, delta: null, state: null, states: null, ...extra,
})
const seriesOf = (points: readonly unknown[]) => ({
  resolution: 'raw', truncated: false, series: [{ scope: '', before: null, derivedFrom: null, points }],
})
const ago = (minutes: number): number => Date.now() - minutes * MIN

interface Fixture {
  readonly id: number
  readonly name: string
  readonly type: string
  readonly caps: readonly string[]
  readonly hub: Record<string, unknown>
}

function hubFor(f: Pick<Fixture, 'id' | 'name' | 'type' | 'caps'>, extra: Record<string, unknown>): Record<string, unknown> {
  return {
    'deviceManager.listAll': [{ id: f.id, name: f.name, type: f.type, online: true, features: f.caps }],
    'deviceManager.getBindings': { entries: f.caps.map((capName) => ({ capName })) },
    ...extra,
  }
}

const cell = (row: number, col: number) => ({ row, col, rowSpan: 1, colSpan: 1 })
const TV_LAYOUT = {
  columns: 3,
  rows: 3,
  buttons: [
    { id: 'pw', ...cell(0, 0), role: 'power', icon: 'power', tone: 'danger', shape: 'round' },
    { id: 'up', ...cell(1, 1), role: 'up', icon: 'chevron-up', groupId: 'dpad', shape: 'round' },
    { id: 'lf', ...cell(2, 0), role: 'left', icon: 'chevron-left', groupId: 'dpad', shape: 'round' },
    { id: 'ok', ...cell(2, 1), role: 'ok', label: 'OK', groupId: 'dpad', shape: 'round', tone: 'accent' },
    { id: 'rt', ...cell(2, 2), role: 'right', icon: 'chevron-right', groupId: 'dpad', shape: 'round' },
    { id: 'dn', ...cell(3, 1), role: 'down', icon: 'chevron-down', groupId: 'dpad', shape: 'round' },
  ],
  groups: [{ id: 'dpad', componentId: 'core:dpad', frame: 'dpad', row: 1, col: 0, rowSpan: 3, colSpan: 3, title: 'Pad' }],
}

const HEATER: Fixture = (() => {
  const base = { id: 11, name: 'Space heater', type: 'heater', caps: ['switch', 'running-state', 'power-meter', 'timed-run'] }
  return {
    ...base,
    hub: hubFor(base, {
      'runningState.getStatus': { running: true, since: ago(12), source: 'native', phase: null, lastFetchedAt: Date.now() },
      'powerMeter.getStatus': { power: 1200 },
      'switch.getStatus': { on: true },
      'deviceHistory.listSeries': [
        { key: 'power', scope: '', kind: 'gauge', unit: 'W', displayName: 'Power', source: 'cap', values: null, firstTs: 1, lastTs: 2 },
        { key: 'running', scope: '', kind: 'boolean', unit: null, displayName: 'Running', source: 'cap', values: null, firstTs: 1, lastTs: 2 },
      ],
      'deviceHistory.query': (input: unknown) => {
        const key = (input as { key: string }).key
        const to = (input as { to: number }).to
        return key === 'power'
          ? seriesOf([point(to - 6 * HOUR, { mean: 0 }), point(to - 5 * HOUR, { mean: 1200 }), point(to - 3 * HOUR, { mean: 900 }), point(to - 1 * HOUR, { mean: 0 })])
          : seriesOf([point(to - 6 * HOUR, { last: 0 }), point(to - 5 * HOUR, { last: 1 }), point(to - 1 * HOUR, { last: 0 })])
      },
      'timedRun.getStatus': { quickRun: { duration: 30, unit: 'min' }, requestedBy: null, lastFetchedAt: 1, activeUntil: Date.now() + 23 * MIN },
    }),
  }
})()

const WASHER: Fixture = (() => {
  const base = { id: 12, name: 'Lavatrice', type: 'washer', caps: ['running-state', 'consumables', 'power-meter'] }
  return {
    ...base,
    hub: hubFor(base, {
      'runningState.getStatus': { running: true, since: ago(48), source: 'native', phase: null, lastFetchedAt: Date.now() },
      'powerMeter.getStatus': { power: 410 },
      'deviceRuns.listRuns': (input: unknown) => {
        const to = (input as { atTo: number }).atTo
        return { nextCursor: null, runs: [
          { runId: '12:1', startedAt: to - 9 * HOUR, endedAt: to - 8 * HOUR, outcome: 'completed' },
          { runId: '12:2', startedAt: to - 48 * MIN, endedAt: null, outcome: null },
        ] }
      },
      'deviceHistory.listSeries': [
        { key: 'program', scope: '', kind: 'enum', unit: null, displayName: 'Program', source: 'cap', values: ['cotton', 'rinse'], firstTs: 1, lastTs: 2 },
      ],
      'deviceHistory.query': (input: unknown) => {
        const to = (input as { to: number }).to
        return seriesOf([point(to - 9 * HOUR, { state: 'cotton' }), point(to - 8 * HOUR, { state: 'rinse' })])
      },
      'consumables.getStatus': {
        lastChangedAt: 0,
        items: [
          { key: 'detergent', label: 'Detersivo', level: 40, status: 'ok', lastResetAt: null, resettable: true },
          { key: 'descaler', label: 'Anticalcare', level: 10, status: 'low', lastResetAt: null, resettable: true },
        ],
      },
    }),
  }
})()

const TV: Fixture = (() => {
  const base = { id: 15, name: 'Living room TV', type: 'media-player', caps: ['media-player', 'remote'] }
  return {
    ...base,
    hub: hubFor(base, {
      'mediaPlayer.getStatus': { state: 'on', assumedFields: [] },
      'remote.listCommands': {
        layoutTemplateId: 'tpl',
        power: { mode: 'discrete' },
        commands: ['power', 'up', 'down', 'left', 'right', 'ok', 'volume_up', 'volume_down'].map((role) => ({ role, custom: false })),
      },
      'template.list': [{ id: 'tpl', kind: 'remote', name: 'TV', payload: TV_LAYOUT }],
      'remote.sendCommand': { status: 'sent', sends: 1 },
    }),
  }
})()

const CONTACT: Fixture = (() => {
  const base = { id: 13, name: 'Front door contact', type: 'sensor', caps: ['contact', 'battery'] }
  return {
    ...base,
    hub: hubFor(base, {
      'contact.getStatus': { entryOpen: true, lastChangedAt: ago(3) },
      'battery.getStatus': { level: 82, charging: 'none', sleeping: false },
    }),
  }
})()

const UNKNOWN: Fixture = (() => {
  const base = { id: 14, name: 'Mystery', type: 'mystery', caps: [] as string[] }
  return { ...base, hub: hubFor(base, {}) }
})()

function screenFor(f: Fixture): React.ReactElement {
  return React.createElement(DeviceDetailScreen, { deviceId: f.id, deviceName: f.name, deviceType: f.type })
}

afterEach(() => {
  cleanup()
  scope.canActuate = true
})

describe('DeviceDetailScreen', () => {
  it('a heater: name, power draw, running line, its switch and the armed timer', async () => {
    mountScreen(screenFor(HEATER), { hub: HEATER.hub })
    expect(await screen.findByText('Running for 12 min')).toBeTruthy()
    expect(screen.getByText('Space heater')).toBeTruthy()
    expect(screen.getByText('1.2 kW')).toBeTruthy()
    expect(screen.getByTestId('device-slot-primary')).toBeTruthy()
    await waitFor(() => expect(screen.getByLabelText('Stop')).toBeTruthy())
    expect(screen.queryByTestId('device-slot-consumables')).toBeNull()
    expect(screen.queryByText('Settings')).toBeNull()
  })

  it('a washer: running line and consumables with the low item flagged, no timer', async () => {
    mountScreen(screenFor(WASHER), { hub: WASHER.hub })
    expect(await screen.findByText('Running for 48 min')).toBeTruthy()
    expect(await screen.findByText('Detersivo')).toBeTruthy()
    expect(screen.getByText('40%')).toBeTruthy()
    expect(screen.getByText('10%')).toBeTruthy()
    expect(screen.queryByTestId('device-slot-timer')).toBeNull()
    expect(screen.queryByTestId('device-slot-primary')).toBeNull()
  })

  it('a door contact: open since, battery, nothing else', async () => {
    mountScreen(screenFor(CONTACT), { hub: CONTACT.hub })
    expect(await screen.findByText('Open for 3 min')).toBeTruthy()
    expect(await screen.findByText('Battery 82%')).toBeTruthy()
    expect(screen.queryByTestId('device-slot-primary')).toBeNull()
  })

  it('an unknown device shows its name and nothing else', async () => {
    mountScreen(screenFor(UNKNOWN), { hub: UNKNOWN.hub })
    expect(await screen.findByText('Mystery')).toBeTruthy()
    await waitFor(() => expect(screen.queryByTestId('device-loading')).toBeNull())
    expect(screen.queryByTestId('device-status-line')).toBeNull()
  })

  it('a session that may not act says so instead of leaving the controls empty', async () => {
    scope.canActuate = false
    mountScreen(screenFor(HEATER), { hub: HEATER.hub })
    expect(await screen.findByTestId('device-no-access')).toBeTruthy()
    expect(screen.queryByTestId('device-slot-primary')).toBeNull()
    expect(screen.queryByLabelText('Stop')).toBeNull()
  })

  it('while the device is unanswered it is neither online nor offline', async () => {
    mountScreen(screenFor(HEATER), { hub: { ...HEATER.hub, 'deviceManager.listAll': () => { throw new Error('slow') } } })
    await screen.findByText('Space heater')
    await waitFor(() => expect(screen.queryByTestId('device-loading')).toBeNull())
    expect(screen.queryByText('Online')).toBeNull()
    expect(screen.queryByText('Offline')).toBeNull()
  })

  it('offers Overview and History, and keeps Transitions out until its data exists', async () => {
    mountScreen(screenFor(HEATER), { hub: HEATER.hub })
    await screen.findByText('Running for 12 min')
    expect(screen.getByText('Overview')).toBeTruthy()
    expect(screen.getByText('History')).toBeTruthy()
    expect(screen.queryByText('Transitions')).toBeNull()
    expect(deviceTabs()).toEqual(['overview', 'history'])
    expect(deviceTabs(true)).toEqual(['overview', 'history', 'transitions'])
  })

  it('a heater\'s primary control is a large power button that toggles the switch', async () => {
    mountScreen(screenFor(HEATER), { hub: HEATER.hub })
    const button = await screen.findByTestId('device-power-button')
    await waitFor(() => expect(button.getAttribute('aria-disabled')).not.toBe('true'))
    fireEvent.click(button)
    await waitFor(() => expect(hubCalls().some((c) => c.path === 'switch.setState')).toBe(true))
  })

  it('a TV\'s primary control is the remote key pad itself', async () => {
    mountScreen(screenFor(TV), { hub: TV.hub })
    expect(await screen.findByTestId('remote-key-ok')).toBeTruthy()
    fireEvent.click(screen.getByTestId('remote-key-ok'))
    await waitFor(() => expect(hubCalls().some((c) => c.path === 'remote.sendCommand')).toBe(true))
  })

  it('History: a boolean as bands, a gauge as a line, each read on its own (never queryMany)', async () => {
    mountScreen(screenFor(HEATER), { hub: HEATER.hub })
    await screen.findByText('Running for 12 min')
    fireEvent.click(screen.getByText('History'))
    expect(await screen.findByTestId('history-series-running-chart')).toBeTruthy()
    expect(await screen.findByTestId('history-series-power-chart')).toBeTruthy()
    expect(screen.getByTestId('history-series-power-range').textContent).toBe('Min 0 W · Max 1200 W')
    expect(screen.queryByTestId('history-runs')).toBeNull()
    const calls = hubCalls().map((c) => c.path)
    expect(calls.filter((p) => p === 'deviceHistory.query')).toHaveLength(2)
    expect(calls).not.toContain('deviceHistory.queryMany')
  })

  it('History: the window selector re-reads the series over 7 days', async () => {
    mountScreen(screenFor(HEATER), { hub: HEATER.hub })
    await screen.findByText('Running for 12 min')
    fireEvent.click(screen.getByText('History'))
    await screen.findByTestId('history-series-power-chart')
    fireEvent.click(screen.getByText('7 days'))
    await waitFor(() => {
      const spans = hubCalls()
        .filter((c) => c.path === 'deviceHistory.query')
        .map((c) => (c.input as { to: number; from: number }).to - (c.input as { to: number; from: number }).from)
      expect(spans).toContain(7 * 24 * HOUR)
    })
    // The charts redraw over the new window (the time labels need a measured plot, which jsdom has not).
    expect((await screen.findAllByTestId(/^history-series-.*-chart$/)).length).toBeGreaterThan(0)
  })

  it('History: a washer shows its runs as bands, and an enum by its states', async () => {
    mountScreen(screenFor(WASHER), { hub: WASHER.hub })
    await screen.findByText('Running for 48 min')
    fireEvent.click(screen.getByText('History'))
    expect(await screen.findByTestId('history-runs-chart')).toBeTruthy()
    expect(await screen.findByTestId('history-series-program-chart')).toBeTruthy()
    expect(screen.getByText('cotton')).toBeTruthy()
    expect(screen.getByText('rinse')).toBeTruthy()
    expect(hubCalls().some((c) => c.path === 'deviceRuns.listRuns')).toBe(true)
  })

  it('History: a series whose read failed says so; it is not drawn empty', async () => {
    const hub = { ...HEATER.hub, 'deviceHistory.query': () => { throw new Error('boom') } }
    mountScreen(screenFor(HEATER), { hub })
    await screen.findByText('Running for 12 min')
    fireEvent.click(screen.getByText('History'))
    expect(await screen.findByTestId('history-series-power-failed')).toBeTruthy()
    expect(screen.queryByTestId('history-series-power-empty')).toBeNull()
  })

  it('History: no series says so; an unanswered list is an error, not "none"', async () => {
    mountScreen(screenFor(CONTACT), { hub: { ...CONTACT.hub, 'deviceHistory.listSeries': [] } })
    await screen.findByText('Open for 3 min')
    fireEvent.click(screen.getByText('History'))
    expect(await screen.findByTestId('history-none')).toBeTruthy()
    cleanup()
    mountScreen(screenFor(CONTACT), { hub: { ...CONTACT.hub, 'deviceHistory.listSeries': () => { throw new Error('down') } } })
    await screen.findByText('Open for 3 min')
    fireEvent.click(screen.getByText('History'))
    expect(await screen.findByTestId('history-error')).toBeTruthy()
  })

  it('keeps clear of the notch and the home indicator', async () => {
    mountScreen(screenFor(CONTACT), { hub: CONTACT.hub })
    await screen.findByText('Open for 3 min')
    const body = screen.getByTestId('device-body').firstElementChild as HTMLElement
    expect(parseFloat(getComputedStyle(body).paddingBottom)).toBeGreaterThanOrEqual(34)
    let node: HTMLElement | null = screen.getByTestId('header-back')
    let top = 0
    while (node !== null && top < 47) {
      top = parseFloat(getComputedStyle(node).paddingTop) || 0
      node = node.parentElement
    }
    expect(top).toBeGreaterThanOrEqual(47)
  })
})

function snapshotHtml(): string {
  const rules: string[] = []
  for (const sheet of Array.from(document.styleSheets)) {
    for (const rule of Array.from(sheet.cssRules)) rules.push(rule.cssText)
  }
  const page = [
    'html,body{height:100%;margin:0}',
    '#root{display:flex;flex-direction:column;height:100%}',
    '#root>div{flex:1;display:flex;flex-direction:column;min-height:0}',
    '#root,#root *{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}',
  ]
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${rules.join('\n')}\n${page.join('\n')}</style></head><body><div id="root">${document.body.innerHTML}</div></body></html>`
}

const SHOTS = process.env.DEVICE_SHOTS_DIR
describe.skipIf(SHOTS === undefined)('device detail shots', () => {
  const cases: readonly [string, Fixture, string, string | null][] = [
    ['heater', HEATER, 'Running for 12 min', null],
    ['washer', WASHER, 'Antical', null],
    ['contact', CONTACT, 'Battery 82%', null],
    ['tv', TV, 'Living room TV', null],
    ['heater-history', HEATER, 'Running for 12 min', 'Min 0 W'],
    ['washer-history', WASHER, 'Running for 48 min', 'cotton'],
  ]
  for (const mode of ['light', 'dark'] as const) {
    for (const [size, width] of [['phone', 390], ['desktop', 1440]] as const) {
      for (const [label, fixture, marker, historyMarker] of cases) {
        it(`dumps ${label} ${size} ${mode}`, async () => {
          Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: width })
          Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, value: 844 })
          window.dispatchEvent(new Event('resize'))
          await AsyncStorage.setItem(THEME_STORAGE_KEY, mode)
          mountScreen(screenFor(fixture), { hub: fixture.hub })
          await waitFor(() => expect(screen.getAllByText(new RegExp(marker)).length).toBeGreaterThan(0))
          if (historyMarker !== null) {
            fireEvent.click(screen.getByText('History'))
            await waitFor(() => expect(screen.getAllByText(new RegExp(historyMarker)).length).toBeGreaterThan(0))
          } else if (label === 'tv') {
            await screen.findByTestId('remote-key-ok')
          }
          fs.mkdirSync(SHOTS!, { recursive: true })
          fs.writeFileSync(path.join(SHOTS!, `device-${label}-${size}-${mode}.html`), snapshotHtml())
        })
      }
    }
  }
})
