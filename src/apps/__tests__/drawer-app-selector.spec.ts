/**
 * @vitest-environment jsdom
 *
 * planning#743: the drawer shows ONE selector row for the active app, the apps
 * are listed in a sheet, and the body is only the active app's nav.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'

import { mountScreen } from '../../testing/mount.js'
import { useAppStore } from '../app-store.js'
import { AppDrawer } from '../AppDrawer.js'

vi.mock('../../connection/ConnectionProvider.js', async () => (await import('../../testing/connection-stub.js')).connectionStubModule())

function app(id: string, label: string, extra: Record<string, unknown> = {}) {
  return {
    addonId: `addon-${id}`,
    app: {
      id,
      label: { key: `apps.${id}`, fallback: label },
      icon: 'monitor',
      entry: { kind: 'web', path: `/${id}`, auth: 'handoff' },
      reach: { kind: 'hub' },
      adminOnly: false,
      nav: [],
      takesSharedSearch: false,
      settings: null,
      ...extra,
    },
  }
}
const SHELL = app('shell', 'Viewer', {
  order: 1,
  entry: { kind: 'native', route: '/cameras' },
})
const TOOLS = app('tools', 'Tools', {
  order: 2,
  nav: [
    {
      id: 'main',
      label: null,
      items: [
        {
          id: 'docs',
          label: { key: 'k.docs', fallback: 'Docs' },
          icon: 'library',
          path: '/docs',
        },
      ],
    },
  ],
})

beforeEach(() => {
  useAppStore.getState().setDrawerOpen(true)
  useAppStore.getState().open({ appId: 'tools' })
  useAppStore.getState().setDrawerOpen(true)
})
afterEach(cleanup)

describe('the app selector', () => {
  it('draws the active app in one row; the body has the nav and no app rows; a tap lists the apps', async () => {
    const view = mountScreen(React.createElement(AppDrawer), {
      hub: { 'apps.listApps': [SHELL, TOOLS] },
    })
    await waitFor(() => expect(view.getByTestId('drawer-app-selector').textContent).toContain('Tools'))
    expect(view.queryByTestId('drawer-app-shell')).toBeNull()
    expect(view.queryByTestId('drawer-app-tools')).toBeNull()
    expect(view.getByTestId('drawer-nav-docs')).toBeTruthy()
    fireEvent.click(view.getByTestId('drawer-app-selector'))
    expect(view.getByTestId('app-selector-sheet')).toBeTruthy()
    fireEvent.click(view.getByTestId('drawer-app-shell'))
    expect(useAppStore.getState().active.appId).toBeNull()
    expect(view.queryByTestId('app-selector-sheet')).toBeNull()
  })

  it('while the list has not answered the row says so and opens nothing', () => {
    const view = mountScreen(React.createElement(AppDrawer))
    const row = view.getByTestId('drawer-app-selector')
    expect(row.textContent).not.toContain('Tools')
    fireEvent.click(row)
    expect(view.queryByTestId('app-selector-sheet')).toBeNull()
  })

  it('an answered list without the active app keeps the sheet openable (D315)', async () => {
    useAppStore.getState().open({ appId: 'gone' })
    useAppStore.getState().setDrawerOpen(true)
    const view = mountScreen(React.createElement(AppDrawer), { hub: { 'apps.listApps': [TOOLS] } })
    await waitFor(() => expect(view.getByTestId('drawer-app-selector').textContent).toBe('Apps'))
    fireEvent.click(view.getByTestId('drawer-app-selector'))
    expect(view.getByTestId('app-selector-sheet')).toBeTruthy()
  })
})
