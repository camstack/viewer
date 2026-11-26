/**
 * @vitest-environment jsdom
 *
 * One smoke mount per screen, over a faked connection (planning#111).
 *
 * `tab-mount.spec.ts` proves the five tabs do not THROW; this file proves every
 * screen under `src/screens` paints the content it exists for — a camera's
 * name off `deviceManager.listAll`, a rule's name off `nc.listRules`, a grid's
 * name off the grid store, a title through the shipped locale — once the wire
 * (`hub-stub.ts`) answers. A screen that mounts but renders an empty shell, or
 * reads its data off a path the hub no longer serves, fails here.
 *
 * The last test is the guard: every `*Screen.tsx` (and platform variant) under
 * `src/screens` must have an entry in `SMOKE`. A new screen without one fails
 * the suite, and so does an entry whose screen was deleted.
 *
 * Deterministic: no timers are advanced and nothing touches the network; every
 * assertion awaits a condition (`findBy*`), never a sleep.
 */
import { readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import React from 'react'

import i18n from '../../app/i18n.js'
import { mountScreen, TEST_SERVER_ID, type MountOptions } from '../../testing/mount.js'
import { useGridStore, type Grid } from '../../store/grid-store.js'
import { deviceSearchHub } from '../../testing/device-search-hub.js'

import { AddServerScreen } from '../AddServerScreen.js'
import { ArtifactsScreen } from '../artifacts/ArtifactsScreen.js'
import { CameraDetailScreen } from '../CameraDetailScreen.js'
import { CamerasManageScreen } from '../CamerasManageScreen.js'
import { CamerasScreen } from '../CamerasScreen.js'
import { ConnectScreen } from '../ConnectScreen.js'
import { DeviceDetailScreen } from '../DeviceDetailScreen.js'
import { EnrollScreen } from '../EnrollScreen.js'
import { EventsScreen } from '../EventsScreen.js'
import { FaceReviewScreen } from '../faces/FaceReviewScreen.js'
import { GridBuilderScreen } from '../GridBuilderScreen.js'
import { GridBuilderScreen as GridBuilderScreenWeb } from '../GridBuilderScreen.web.js'
import { GridsScreen } from '../GridsScreen.js'
import { GridViewScreen } from '../GridViewScreen.js'
import { LibraryScreen } from '../LibraryScreen.js'
import { LoginScreen } from '../LoginScreen.js'
import { AlarmSettingsScreen } from '../notifications/AlarmSettingsScreen.js'
import { NotificationCenterScreen } from '../notifications/NotificationCenterScreen.js'
import { KindPickerScreen } from '../notifications/rule-editor/KindPickerScreen.js'
import { RuleSectionScreen } from '../notifications/rule-editor/RuleSectionScreen.js'
import { RuleSummaryScreen } from '../notifications/rule-editor/RuleSummaryScreen.js'
import { SummaryEditorScreen } from '../notifications/rule-editor/SummaryEditorScreen.js'
import { TimelapseEditorScreen } from '../notifications/rule-editor/TimelapseEditorScreen.js'
import { RuleHistoryScreen } from '../notifications/RuleHistoryScreen.js'
import { PlateReviewScreen } from '../plates/PlateReviewScreen.js'
import { RemoteScreen } from '../RemoteScreen.js'
import { RetrainEditorScreen } from '../retrain/editor/RetrainEditorScreen.js'
import { RetrainScreen } from '../retrain/RetrainScreen.js'
import { ScenesScreen } from '../scenes/ScenesScreen.js'
import { AccountScreen } from '../account/AccountScreen.js'
import { SettingsScreen } from '../SettingsScreen.js'
import { TimelineLibraryScreen } from '../TimelineLibraryScreen.js'

vi.mock('../../connection/ConnectionProvider.js', async () =>
  (await import('../../testing/connection-stub.js')).connectionStubModule(),
)

const CAMERA_NAME = 'Front gate'
const GRID_NAME = 'Ground floor'
const RULE_NAME = 'Porch alerts'
const OPERATOR = 'operator'

const CAMERAS = [
  { id: 1, name: CAMERA_NAME, type: 'camera', isCamera: true, online: true, disabled: false, features: [] },
]

const ADMIN = {
  id: 'u1',
  username: OPERATOR,
  isAdmin: true,
  permissions: { isAdmin: true, allowedProviders: '*', allowedDevices: {} },
}

const RULE = {
  id: 'rule-1',
  name: RULE_NAME,
  enabled: true,
  delivery: 'immediate',
  conditions: { classes: ['person'] },
  targets: [{ targetId: 't1' }],
  media: { attach: 'best' },
  priority: 3,
  createdBy: OPERATOR,
  createdAt: 10,
  updatedAt: 20,
  disabledTargetIds: [],
  readOnly: false,
}

function actionOf(input: unknown): unknown {
  return input !== null && typeof input === 'object' && 'action' in input ? input.action : undefined
}

/** The addon custom-action router: the notification center's rule lists. */
function addonsCustom(input?: unknown): unknown {
  const action = actionOf(input)
  if (action === 'nc.listRules') return { rules: [RULE] }
  if (action === 'nc.listTimelapseRules') return { rules: [] }
  if (action === 'nc.listSummaryRules') return { rules: [], canAuthor: true }
  throw new Error(`NOT_FOUND: ${String(action)}`)
}

/** The day every screen is mounted into: a signed-in admin, one camera, one rule. */
const HUB: NonNullable<MountOptions['hub']> = {
  'auth.me': ADMIN,
  'deviceManager.listAll': CAMERAS,
  'addons.custom': addonsCustom,
  'integrationInstances.listInstances': [],
  ...deviceSearchHub([{ id: 1, name: CAMERA_NAME, type: 'camera', caps: ['camera-streams'] }]),
}

const t = (key: string): string => i18n.t(key)

/** At least one element carries exactly `text`. */
async function seesText(text: string): Promise<void> {
  expect((await screen.findAllByText(text)).length).toBeGreaterThan(0)
}

/** At least one element's text contains `fragment`. */
async function seesFragment(fragment: string): Promise<void> {
  const found = await screen.findAllByText((_content, el) =>
    el !== null && el.children.length === 0 && (el.textContent ?? '').includes(fragment),
  )
  expect(found.length).toBeGreaterThan(0)
}

/** An input (the inline rename field) holds `value`. */
async function seesValue(value: string): Promise<void> {
  expect((await screen.findAllByDisplayValue(value)).length).toBeGreaterThan(0)
}

async function seesTestId(id: string): Promise<void> {
  expect(await screen.findByTestId(id)).not.toBeNull()
}

interface SmokeCase {
  readonly element: () => React.ReactElement
  readonly options?: MountOptions
  /** What the screen exists to show, awaited after the mount. */
  readonly expectKeyContent: () => Promise<void>
}

const h = React.createElement

/**
 * Keyed by the screen's path under `src/screens`. The guard at the bottom
 * compares these keys with the files on disk.
 */
const SMOKE: Readonly<Record<string, SmokeCase>> = {
  'AddServerScreen.tsx': {
    element: () => h(AddServerScreen),
    expectKeyContent: async () => {
      await seesText(t('v2.servers.add'))
      await seesText(t('v2.login.serverUrl'))
    },
  },
  'artifacts/ArtifactsScreen.tsx': {
    element: () => h(ArtifactsScreen),
    expectKeyContent: async () => {
      await seesText(t('v2.artifacts.title'))
      await seesTestId('artifacts-filter-bar')
    },
  },
  'CameraDetailScreen.tsx': {
    element: () => h(CameraDetailScreen, { deviceId: 1 }),
    expectKeyContent: async () => {
      await seesText(CAMERA_NAME)
      await seesTestId('timeline-nav-capsule')
    },
  },
  'CamerasManageScreen.tsx': {
    element: () => h(CamerasManageScreen),
    expectKeyContent: async () => {
      await seesText(t('v2.cameras.manage'))
      await seesValue(CAMERA_NAME)
    },
  },
  'CamerasScreen.tsx': {
    element: () => h(CamerasScreen),
    expectKeyContent: () => seesFragment(CAMERA_NAME),
  },
  'ConnectScreen.tsx': {
    element: () => h(ConnectScreen),
    options: { params: { hub: 'https://hub.example.com' } },
    expectKeyContent: () => seesFragment('hub.example.com'),
  },
  'DeviceDetailScreen.tsx': {
    element: () => h(DeviceDetailScreen, { deviceId: 1, deviceName: CAMERA_NAME, deviceType: 'camera', shown: true }),
    expectKeyContent: () => seesText(CAMERA_NAME),
  },
  'EnrollScreen.tsx': {
    element: () => h(EnrollScreen),
    expectKeyContent: () => seesText(t('v2.device.enroll.title')),
  },
  'EventsScreen.tsx': {
    element: () => h(EventsScreen),
    expectKeyContent: () => seesTestId('events-filter-bar'),
  },
  'faces/FaceReviewScreen.tsx': {
    element: () => h(FaceReviewScreen),
    expectKeyContent: () => seesTestId('face-review-filter-bar'),
  },
  'GridBuilderScreen.tsx': {
    element: () => h(GridBuilderScreen, { gridId: 'g1' }),
    expectKeyContent: async () => {
      await seesText(t('v2.gridBuilder.title'))
      await seesFragment(CAMERA_NAME)
    },
  },
  'GridBuilderScreen.web.tsx': {
    element: () => h(GridBuilderScreenWeb, { gridId: 'g1' }),
    expectKeyContent: async () => {
      await seesText(t('v2.gridBuilder.title'))
      await seesFragment(CAMERA_NAME)
    },
  },
  'GridsScreen.tsx': {
    element: () => h(GridsScreen),
    expectKeyContent: () => seesFragment(GRID_NAME),
  },
  'GridViewScreen.tsx': {
    element: () => h(GridViewScreen, { gridId: 'g1' }),
    expectKeyContent: () => seesFragment(GRID_NAME),
  },
  'LibraryScreen.tsx': {
    element: () => h(LibraryScreen),
    expectKeyContent: async () => {
      await seesText(t('v2.library.sections.events'))
      await seesText(t('v2.library.sections.timeline'))
      await seesText(t('v2.library.sections.artifacts'))
    },
  },
  'LoginScreen.tsx': {
    element: () => h(LoginScreen),
    expectKeyContent: async () => {
      await seesText(t('v2.login.serverUrl'))
      await seesText(t('v2.login.signIn'))
    },
  },
  'notifications/AlarmSettingsScreen.tsx': {
    element: () => h(AlarmSettingsScreen),
    expectKeyContent: () => seesText(t('v2.nc.alarm.title')),
  },
  'notifications/NotificationCenterScreen.tsx': {
    element: () => h(NotificationCenterScreen),
    expectKeyContent: async () => {
      await seesText(t('v2.nc.title'))
      await seesFragment(RULE_NAME)
    },
  },
  'notifications/rule-editor/KindPickerScreen.tsx': {
    element: () => h(KindPickerScreen),
    expectKeyContent: () => seesText(t('v2.nc.rules.kindPicker.subtitle')),
  },
  'notifications/rule-editor/RuleSectionScreen.tsx': {
    element: () => h(RuleSectionScreen, { id: RULE.id, section: 'rule' }),
    expectKeyContent: () => seesValue(RULE_NAME),
  },
  'notifications/rule-editor/RuleSummaryScreen.tsx': {
    element: () => h(RuleSummaryScreen, { id: RULE.id }),
    expectKeyContent: () => seesFragment(RULE_NAME),
  },
  'notifications/rule-editor/SummaryEditorScreen.tsx': {
    element: () => h(SummaryEditorScreen, { id: 'new' }),
    expectKeyContent: () => seesText(t('v2.nc.summary.createTitle')),
  },
  'notifications/rule-editor/TimelapseEditorScreen.tsx': {
    element: () => h(TimelapseEditorScreen, { id: 'new' }),
    expectKeyContent: () => seesText(t('v2.nc.timelapse.createTitle')),
  },
  'notifications/RuleHistoryScreen.tsx': {
    element: () => h(RuleHistoryScreen, { id: RULE.id, name: RULE_NAME }),
    expectKeyContent: () => seesFragment(RULE_NAME),
  },
  'plates/PlateReviewScreen.tsx': {
    element: () => h(PlateReviewScreen),
    expectKeyContent: () => seesTestId('plate-review-filter-bar'),
  },
  'RemoteScreen.tsx': {
    element: () => h(RemoteScreen, { deviceId: 1, deviceName: 'Lounge TV' }),
    expectKeyContent: async () => {
      await seesTestId('remote-screen')
      await seesFragment('Lounge TV')
    },
  },
  'retrain/editor/RetrainEditorScreen.tsx': {
    element: () => h(RetrainEditorScreen, { frameId: 'f1', deviceId: 1, collectionId: null }),
    expectKeyContent: () => seesTestId('retrain-editor'),
  },
  'retrain/RetrainScreen.tsx': {
    element: () => h(RetrainScreen),
    expectKeyContent: () => seesTestId('retrain-toolbar'),
  },
  'scenes/ScenesScreen.tsx': {
    element: () => h(ScenesScreen),
    expectKeyContent: () => seesTestId('scenes-action-refresh'),
  },
  'account/AccountScreen.tsx': {
    element: () => h(AccountScreen),
    expectKeyContent: async () => {
      await seesText(t('v2.apps.account'))
      await seesFragment(OPERATOR)
    },
  },
  'SettingsScreen.tsx': {
    element: () => h(SettingsScreen),
    expectKeyContent: async () => {
      await seesText(t('v2.settings.segments.viewing'))
    },
  },
  'TimelineLibraryScreen.tsx': {
    element: () => h(TimelineLibraryScreen),
    expectKeyContent: () => seesTestId('timeline-library-host'),
  },
}

beforeEach(async () => {
  await AsyncStorage.clear()
  useGridStore.setState({
    grids: [{ id: 'g1', name: GRID_NAME, serverId: TEST_SERVER_ID, cameraIds: [1] } satisfies Grid],
    hydrated: true,
  })
})

/** Testing Library's auto-cleanup needs vitest globals, which are off. */
afterEach(cleanup)

describe('every screen renders its key content over a faked connection', () => {
  for (const [path, smoke] of Object.entries(SMOKE)) {
    it(path, async () => {
      mountScreen(smoke.element(), { hub: HUB, ...smoke.options })
      await smoke.expectKeyContent()
    })
  }
})

const SCREENS_DIR = join(process.cwd(), 'src', 'screens')
const SCREEN_FILE = /Screen(\.web)?\.tsx$/

function screenFiles(dir: string): readonly string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : screenFiles(join(dir, entry.name))
    return SCREEN_FILE.test(entry.name) ? [relative(SCREENS_DIR, join(dir, entry.name)).split(sep).join('/')] : []
  })
}

describe('the smoke table covers every screen', () => {
  it('a screen file without a SMOKE entry fails, and so does an entry without a file', () => {
    const onDisk = [...screenFiles(SCREENS_DIR)].sort()
    expect(Object.keys(SMOKE).sort()).toEqual(onDisk)
  })
})
