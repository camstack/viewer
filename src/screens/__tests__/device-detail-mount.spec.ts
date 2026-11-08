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
import { cleanup, screen, waitFor } from '@testing-library/react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import fs from 'node:fs'
import path from 'node:path'
import React from 'react'

import { mountScreen } from '../../testing/mount.js'
import { THEME_STORAGE_KEY } from '../../theme/resolve-theme.js'
import { DeviceDetailScreen } from '../DeviceDetailScreen.js'

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

vi.mock('../../connection/ConnectionProvider.js', async () =>
  (await import('../../testing/connection-stub.js')).connectionStubModule(),
)

const MIN = 60_000
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

const HEATER: Fixture = (() => {
  const base = { id: 11, name: 'Space heater', type: 'heater', caps: ['switch', 'running-state', 'power-meter', 'timed-run'] }
  return {
    ...base,
    hub: hubFor(base, {
      'runningState.getStatus': { running: true, since: ago(12), source: 'native', phase: null, lastFetchedAt: Date.now() },
      'powerMeter.getStatus': { power: 1200 },
      'switch.getStatus': { on: true },
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

afterEach(() => cleanup())

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
    expect(screen.queryByText('History')).toBeNull()
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
  const cases: readonly [string, Fixture, string][] = [
    ['heater', HEATER, 'Running for 12 min'],
    ['washer', WASHER, 'Antical'],
    ['contact', CONTACT, 'Battery 82%'],
  ]
  for (const mode of ['light', 'dark'] as const) {
    for (const [size, width] of [['phone', 390], ['desktop', 1440]] as const) {
      for (const [label, fixture, marker] of cases) {
        it(`dumps ${label} ${size} ${mode}`, async () => {
          Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: width })
          Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, value: 844 })
          window.dispatchEvent(new Event('resize'))
          await AsyncStorage.setItem(THEME_STORAGE_KEY, mode)
          mountScreen(screenFor(fixture), { hub: fixture.hub })
          await waitFor(() => expect(screen.getAllByText(new RegExp(marker)).length).toBeGreaterThan(0))
          fs.mkdirSync(SHOTS!, { recursive: true })
          fs.writeFileSync(path.join(SHOTS!, `device-${label}-${size}-${mode}.html`), snapshotHtml())
        })
      }
    }
  }
})
