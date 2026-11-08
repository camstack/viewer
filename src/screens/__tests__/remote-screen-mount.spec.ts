/**
 * @vitest-environment jsdom
 *
 * The full-screen remote, mounted against a stub hub: it draws the saved
 * layout, a press is `remote.sendCommand`, a refusal and a failure are
 * SHOWN, an unknown power says unknown, and a group's title is never drawn.
 *
 * `REMOTE_SHOTS_DIR=<dir> npx vitest run src/screens/__tests__/remote-screen-mount.spec.ts`
 * also dumps the rendered page as standalone HTML per theme and width, for
 * the web screenshots (the viewer's own Expo web build needs a live hub).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import fs from 'node:fs'
import path from 'node:path'
import React from 'react'

import { hubCalls } from '../../testing/hub-stub.js'
import { mountScreen } from '../../testing/mount.js'
import { THEME_STORAGE_KEY } from '../../theme/resolve-theme.js'
import { RemoteScreen } from '../RemoteScreen.js'

// The shared stub draws `Svg`/`Path` as plain Views, so a vector icon would be
// blank in the HTML dump. Here they are the real SVG elements, as on the web.
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
    __esModule: true,
    default: Svg,
    Svg,
    Circle: tag('circle'),
    Ellipse: tag('ellipse'),
    G: tag('g'),
    Line: tag('line'),
    Path: tag('path'),
    Polygon: tag('polygon'),
    Polyline: tag('polyline'),
    Rect: tag('rect'),
    Defs: tag('defs'),
    ClipPath: tag('clipPath'),
  }
})

vi.mock('../../connection/ConnectionProvider.js', async () =>
  (await import('../../testing/connection-stub.js')).connectionStubModule(),
)

function screenFor(name: string): React.ReactElement {
  return React.createElement(RemoteScreen, { deviceId: 5, deviceName: name })
}

const r = (row: number, col: number, rowSpan = 1, colSpan = 1) => ({ row, col, rowSpan, colSpan })
const LAYOUT = {
  columns: 4,
  rows: 9,
  buttons: [
    { id: 'pw', ...r(0, 0), role: 'power', icon: 'power', tone: 'danger', shape: 'round' },
    { id: 'in', ...r(0, 1), role: 'input', icon: 'log-in', shape: 'rounded' },
    { id: 'nf', ...r(0, 2), role: 'custom:netflix', icon: 'app:netflix', label: 'Netflix', shape: 'pill', colSpan: 2 },
    { id: 'up', ...r(2, 1), role: 'up', icon: 'chevron-up', groupId: 'dpad', shape: 'round' },
    { id: 'lf', ...r(3, 0), role: 'left', icon: 'chevron-left', groupId: 'dpad', shape: 'round' },
    { id: 'ok', ...r(3, 1), role: 'ok', label: 'OK', groupId: 'dpad', shape: 'round', tone: 'accent' },
    { id: 'rt', ...r(3, 2), role: 'right', icon: 'chevron-right', groupId: 'dpad', shape: 'round' },
    { id: 'dn', ...r(4, 1), role: 'down', icon: 'chevron-down', groupId: 'dpad', shape: 'round' },
    { id: 'vu', ...r(2, 3), role: 'volume_up', icon: 'plus', groupId: 'vol', shape: 'round' },
    { id: 'vd', ...r(3, 3), role: 'volume_down', icon: 'minus', groupId: 'vol', shape: 'round' },
    { id: 'rd', ...r(6, 0), role: 'custom:red', tone: 'red' },
    { id: 'gr', ...r(6, 1), role: 'custom:green', tone: 'green' },
    { id: 'ye', ...r(6, 2), role: 'custom:yellow', tone: 'yellow' },
    { id: 'bl', ...r(6, 3), role: 'custom:blue', tone: 'blue' },
    { id: 'd1', ...r(7, 0), role: 'digit_1', label: '1', groupId: 'num' },
    { id: 'd2', ...r(7, 1), role: 'digit_2', label: '2', groupId: 'num' },
    { id: 'd3', ...r(7, 2), role: 'digit_3', label: '3', groupId: 'num' },
    { id: 'mu', ...r(8, 3), role: 'mute', icon: 'volume-x' },
  ],
  groups: [
    { id: 'div1', componentId: 'core:divider', frame: 'divider', ...r(1, 0, 1, 4), title: 'Navigation' },
    { id: 'dpad', componentId: 'core:dpad', frame: 'dpad', ...r(2, 0, 3, 3), title: 'Pad' },
    { id: 'vol', componentId: 'core:rocker', frame: 'rocker-v', ...r(2, 3, 2, 1), title: 'Volume' },
    { id: 'div2', componentId: 'core:divider', frame: 'divider', ...r(5, 0, 1, 4), title: 'Colours' },
    { id: 'num', componentId: 'core:keypad', frame: 'keypad', ...r(7, 0, 1, 3), title: 'Numbers' },
  ],
}
const BOUND = ['power', 'input', 'custom:netflix', 'up', 'left', 'ok', 'right', 'down', 'volume_up', 'volume_down', 'custom:red', 'custom:green', 'custom:yellow', 'custom:blue', 'digit_1', 'digit_2', 'digit_3']

function hub(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    'remote.listCommands': {
      layoutTemplateId: 'tpl',
      power: { mode: 'discrete' },
      commands: BOUND.map((role) => ({ role, custom: role.startsWith('custom:') })),
    },
    'template.list': [{ id: 'tpl', kind: 'remote', name: 'TV', payload: LAYOUT }],
    'mediaPlayer.getStatus': { state: 'on', assumedFields: [] },
    'remote.sendCommand': { status: 'sent', sends: 1 },
    ...extra,
  }
}

function sends(): readonly unknown[] {
  return hubCalls().filter((c) => c.path === 'remote.sendCommand').map((c) => c.input)
}

afterEach(() => cleanup())

const COLOUR_LAYOUT = {
  columns: 4,
  rows: 1,
  buttons: [
    { id: 'ca', ...r(0, 0), role: 'custom:color_a', label: 'A', shape: 'rounded' },
    { id: 'cb', ...r(0, 1), role: 'custom:color_b', label: 'B', shape: 'rounded' },
    { id: 'cy', ...r(0, 2), role: 'custom:k_yellow', shape: 'rounded' },
    { id: 'cd', ...r(0, 3), role: 'custom:k_blue', label: 'Blue', shape: 'rounded' },
  ],
  groups: [],
}

const COLOUR_COMMANDS = [
  { role: 'custom:color_a', custom: true, label: 'A' },
  { role: 'custom:color_b', custom: true, label: 'B' },
  { role: 'custom:k_yellow', custom: true, label: 'Yellow' },
  { role: 'custom:k_blue', custom: true, label: 'Blue' },
]

function colourHub(): Record<string, unknown> {
  return hub({
    'remote.listCommands': {
      layoutTemplateId: 'tpl',
      power: { mode: 'discrete' },
      commands: COLOUR_COMMANDS,
    },
    'template.list': [{ id: 'tpl', kind: 'remote', name: 'TV', payload: COLOUR_LAYOUT }],
  })
}

describe('RemoteScreen', () => {
  it('colour keys wear their standard colour as a bar, whichever way they are named', async () => {
    mountScreen(screenFor('TV'), { hub: colourHub() })
    expect(await screen.findByTestId('remote-key-ca-colour-red')).toBeTruthy()
    expect(screen.getByTestId('remote-key-cb-colour-green')).toBeTruthy()
    expect(screen.getByTestId('remote-key-cy-colour-yellow')).toBeTruthy()
    expect(screen.getByTestId('remote-key-cd-colour-blue')).toBeTruthy()
    expect(screen.getByText('A')).toBeTruthy()
    // an ordinary custom key and a toned one get no bar
    cleanup()
    mountScreen(screenFor('TV'), { hub: hub() })
    await screen.findByTestId('remote-key-nf')
    expect(document.querySelector('[data-testid*="-colour-"]')).toBeNull()
  })

  it('draws the saved layout, with no group title anywhere', async () => {
    mountScreen(screenFor("Living room TV"), { hub: hub() })
    await screen.findByTestId('remote-key-pw')
    expect(screen.getAllByRole('button').length).toBeGreaterThan(15)
    for (const title of ['Navigation', 'Pad', 'Volume', 'Colours', 'Numbers']) {
      expect(screen.queryByText(title)).toBeNull()
    }
    expect(screen.getByTestId('remote-group-dpad')).toBeTruthy()
    expect(screen.queryByTestId('remote-group-div1')).toBeNull()
  })

  it('a press sends remote.sendCommand with the key\'s role', async () => {
    mountScreen(screenFor("TV"), { hub: hub() })
    fireEvent.click(await screen.findByTestId('remote-key-vu'))
    await waitFor(() => expect(sends()).toEqual([{ deviceId: 5, role: 'volume_up', repeat: 1 }]))
    expect(screen.queryByTestId('remote-failure')).toBeNull()
  })

  it('a typed refusal is shown, not swallowed', async () => {
    mountScreen(screenFor("TV"), {
      hub: hub({ 'remote.sendCommand': { status: 'refused', reason: 'action-failed', detail: 'the board is off' } }),
    })
    fireEvent.click(await screen.findByTestId('remote-key-ok'))
    const failure = await screen.findByTestId('remote-failure')
    expect(failure.textContent).toContain('The command could not be sent.')
    expect(failure.textContent).toContain('the board is off')
  })

  it('a failed send shows what the hub said', async () => {
    mountScreen(screenFor("TV"), {
      hub: hub({ 'remote.sendCommand': () => { throw new Error('FORBIDDEN: not allowed') } }),
    })
    fireEvent.click(await screen.findByTestId('remote-key-pw'))
    expect((await screen.findByTestId('remote-failure')).textContent).toContain('FORBIDDEN: not allowed')
  })

  it('an unwired key does nothing', async () => {
    mountScreen(screenFor("TV"), { hub: hub() })
    fireEvent.click(await screen.findByTestId('remote-key-mu'))
    await act(async () => { await Promise.resolve() })
    expect(sends()).toEqual([])
  })

  it('an unknown power says unknown; a known one says on', async () => {
    mountScreen(screenFor("TV"), {
      hub: (() => { const h = hub(); delete h['mediaPlayer.getStatus']; return h })(),
    })
    await screen.findByTestId('remote-key-pw')
    await waitFor(() => expect(screen.getByText('State unknown')).toBeTruthy())
  })

  it('keeps clear of the notch and the home indicator, and never names a guessed state', async () => {
    mountScreen(screenFor('TV'), { hub: hub() })
    await screen.findByTestId('remote-key-pw')
    // The test safe area is 47 pt on top and 34 pt below.
    const body = screen.getByTestId('remote-body').firstElementChild as HTMLElement
    expect(parseFloat(getComputedStyle(body).paddingBottom)).toBeGreaterThanOrEqual(34)
    let node: HTMLElement | null = screen.getByTestId('header-back')
    let top = 0
    while (node !== null && top < 47) {
      top = parseFloat(getComputedStyle(node).paddingTop) || 0
      node = node.parentElement
    }
    expect(top).toBeGreaterThanOrEqual(47)
    await waitFor(() => expect(screen.getByText('On')).toBeTruthy())
    expect(screen.queryByText(/assumed/i)).toBeNull()
  })

  it('a device with no remote says so, and a failed list is an error, not "none"', async () => {
    mountScreen(screenFor("TV"), {
      hub: hub({ 'remote.listCommands': { layoutTemplateId: null, power: { mode: 'discrete' }, commands: [] } }),
    })
    await screen.findByTestId('remote-none')
    cleanup()
    const failing = hub({ 'remote.listCommands': () => { throw new Error('node not answering') } })
    mountScreen(screenFor("TV"), { hub: failing })
    expect((await screen.findByTestId('remote-error')).textContent).toContain('node not answering')
  })
})

/**
 * The rendered page as one standalone HTML string, styles included, laid out
 * as the web build lays it out: `#root` is a full-height flex column that the
 * screen's `flex: 1` root fills, and the text uses the platform font stack
 * (react-native-web resolves `System` to it; a bare dump would fall back to the
 * browser's serif).
 */
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

const SHOTS = process.env.REMOTE_SHOTS_DIR
describe.skipIf(SHOTS === undefined)('remote shots', () => {
  for (const mode of ['light', 'dark'] as const) {
    for (const [size, width] of [['phone', 390], ['tablet', 820], ['desktop', 1440]] as const) {
      it(`dumps the ${size} ${mode} page`, async () => {
        // jsdom reports no window width; a device has one.
        Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: width })
        Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, value: 844 })
        window.dispatchEvent(new Event('resize'))
        await AsyncStorage.setItem(THEME_STORAGE_KEY, mode)
        const colourRow = COLOUR_LAYOUT.buttons.map((b) => ({ ...b, ...r(9, b.col) }))
        mountScreen(screenFor('Living room TV'), {
          hub: hub({
            'remote.listCommands': {
              layoutTemplateId: 'tpl',
              power: { mode: 'discrete' },
              commands: [...BOUND.map((role) => ({ role, custom: role.startsWith('custom:') })), ...COLOUR_COMMANDS],
            },
            'template.list': [{ id: 'tpl', kind: 'remote', name: 'TV', payload: { ...LAYOUT, rows: 10, buttons: [...LAYOUT.buttons, ...colourRow] } }],
          }),
        })
        await screen.findByTestId('remote-key-pw')
        await screen.findByTestId('remote-key-ca-colour-red')
        await waitFor(() => expect(screen.getByText('On')).toBeTruthy())
        fs.mkdirSync(SHOTS!, { recursive: true })
        fs.writeFileSync(path.join(SHOTS!, `remote-${size}-${mode}.html`), snapshotHtml())
      })
    }
  }
})
