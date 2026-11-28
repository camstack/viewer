/**
 * @vitest-environment jsdom
 *
 * planning#763: the drawer has an APP RAIL at its left (one labelled icon per app, the
 * active one selected, a tap switches), and the content column is the active app's nav.
 * The footer is the avatar row only; the account menu opens from it.
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
const SHELL = app('shell', 'Viewer', { order: 1, entry: { kind: 'native', route: '/cameras' } })
const TOOLS = app('tools', 'Tools', {
  order: 2,
  nav: [{ id: 'main', label: null, items: [{ id: 'docs', label: { key: 'k.docs', fallback: 'Docs' }, icon: 'library', path: '/docs' }] }],
})

beforeEach(() => {
  useAppStore.getState().open({ appId: 'tools' })
  useAppStore.getState().setDrawerOpen(true)
})
afterEach(cleanup)

describe('the app rail', () => {
  it('has one labelled icon per app, the active one selected, and the content column shows its title and nav', async () => {
    const view = mountScreen(React.createElement(AppDrawer), { hub: { 'apps.listApps': [SHELL, TOOLS] } })
    await waitFor(() => expect(view.getByTestId('drawer-app-title').textContent).toBe('Tools'))
    const rail = view.getByTestId('drawer-app-rail')
    expect(rail.contains(view.getByTestId('drawer-app-shell'))).toBe(true)
    expect(view.getByTestId('drawer-app-shell').getAttribute('aria-label')).toBe('Viewer')
    expect(view.getByTestId('drawer-app-tools').getAttribute('aria-label')).toBe('Tools')
    expect(view.getByTestId('drawer-app-tools').getAttribute('aria-selected')).toBe('true')
    expect(view.getByTestId('drawer-app-shell').getAttribute('aria-selected')).toBe('false')
    expect(view.getByTestId('drawer-nav-docs')).toBeTruthy()
    expect(view.queryByTestId('drawer-app-selector')).toBeNull()
  })

  it('a tap on an icon switches app', async () => {
    const view = mountScreen(React.createElement(AppDrawer), { hub: { 'apps.listApps': [SHELL, TOOLS] } })
    await waitFor(() => expect(view.getByTestId('drawer-app-shell')).toBeTruthy())
    fireEvent.click(view.getByTestId('drawer-app-shell'))
    expect(useAppStore.getState().active.appId).toBeNull()
  })

  it('while the list has not answered the rail shows one pending placeholder, not "no apps", and opens nothing', () => {
    const view = mountScreen(React.createElement(AppDrawer))
    expect(view.getByTestId('drawer-app-rail-pending')).toBeTruthy()
    expect(view.queryByTestId('drawer-app-shell')).toBeNull()
    expect(view.getByTestId('drawer-app-title').textContent).not.toContain('Tools')
  })

  it('an answered list without the active app keeps the rail usable (D315)', async () => {
    useAppStore.getState().open({ appId: 'gone' })
    useAppStore.getState().setDrawerOpen(true)
    const view = mountScreen(React.createElement(AppDrawer), { hub: { 'apps.listApps': [TOOLS] } })
    await waitFor(() => expect(view.getByTestId('drawer-app-tools')).toBeTruthy())
    expect(view.getByTestId('drawer-app-title').textContent).toBe('Apps')
  })
})

describe('the footer', () => {
  it('is the avatar row only; the account menu holds the rest', () => {
    const view = mountScreen(React.createElement(AppDrawer))
    const footer = view.getByTestId('drawer-section-footer')
    expect(footer.contains(view.getByTestId('drawer-user-block'))).toBe(true)
    expect(view.queryByTestId('drawer-sign-out')).toBeNull()
    fireEvent.click(view.getByTestId('drawer-user-block'))
    for (const id of ['drawer-account-link', 'drawer-switch-server', 'drawer-open-at-launch', 'drawer-sign-out']) {
      expect(view.getByTestId('account-menu-sheet').contains(view.getByTestId(id))).toBe(true)
    }
  })
})
