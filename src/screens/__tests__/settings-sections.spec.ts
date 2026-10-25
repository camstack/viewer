/**
 * Source guards for the Settings screen's SECTION inventory (2026-08-18,
 * regrouped into four segments on 2026-10-08 — operator-approved design:
 * Account / Viewing / App / Advanced, see `settings/settings-segments.ts`).
 *
 * Three sections changed shape on the operator's instruction and each removal
 * has a way of coming back by accident, so each assertion names what it holds
 * shut:
 *
 *  1. **Events** — deleted whole. It held the global min-importance filter and
 *     the renderer switch; both features are gone (the hub-hosted embed is now
 *     THE events renderer, see `events-embed-wiring.spec.ts`).
 *  2. **Cameras** — deleted whole. Both its rows were duplicates: the Cameras
 *     page opens `/settings/cameras` itself, and Artifacts is a Library
 *     section. The ROUTES stay — old deep links use them — so this file
 *     asserts the routes survive as loudly as it asserts the rows are gone.
 *  3. **Timeline + Stream defaults** — merged into one section. Presentation
 *     only: every row must still be there, under one title.
 *
 * These are source assertions because a settings section is a static tree; the
 * mount smoke test (`tab-mount.spec.ts`) proves the screen still renders, this
 * proves it renders the right inventory.
 */
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import enLocale from '../../../locales/en.json'
import itLocale from '../../../locales/it.json'

const ROOT = process.cwd()
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8')
const SEGMENT_FILES = {
  shell: 'src/screens/SettingsScreen.tsx',
  account: 'src/screens/settings/AccountSegment.tsx',
  viewing: 'src/screens/settings/ViewingSegment.tsx',
  app: 'src/screens/settings/AppSegment.tsx',
  advanced: 'src/screens/settings/AdvancedSegment.tsx',
} as const
/** Every file the Settings tab renders from, read as one source. */
const SETTINGS = (): string => Object.values(SEGMENT_FILES).map(read).join('\n')
const VIEWING = (): string => read(SEGMENT_FILES.viewing)

/** The source of one `<Section title={t('<key>')}>` block, up to the next one. */
function sectionBlock(src: string, key: string): string {
  const open = src.indexOf(`<Section title={t('${key}')}>`)
  expect(open, `no <Section> titled ${key}`).toBeGreaterThan(-1)
  const next = src.indexOf('<Section title={', open + 1)
  return src.slice(open, next === -1 ? src.length : next)
}

describe('the Events settings section is gone, with the features it drove', () => {
  it('has no Events section', () => {
    expect(SETTINGS()).not.toContain("t('v2.settings.events')")
  })

  it('does not offer a renderer switch — there is only one renderer now', () => {
    // Both surfaces that carried the escape hatch. A switch that selects
    // between one option is worse than none: it reads as a working control.
    expect(SETTINGS()).not.toContain('useEmbedRenderer')
    expect(SETTINGS()).not.toContain('useNativeRenderer')
    expect(read('src/components/camera/CamerasDisplaySheet.tsx')).not.toContain('useEmbedRenderer')
    expect(read('src/components/camera/CamerasDisplaySheet.tsx')).not.toContain('useNativeRenderer')
  })

  it('does not offer the global minimum-importance filter', () => {
    expect(SETTINGS()).not.toContain('minImportance')
    expect(SETTINGS()).not.toContain('MIN_IMPORTANCE_CHOICES')
  })

  it('and the surfaces that filtered on it no longer do', () => {
    expect(read('src/components/camera/theater/TheaterTimeline.tsx')).not.toContain('minImportance')
    expect(read('src/screens/EventsScreen.tsx')).not.toContain('minImportance')
  })

  it('but the notification RULE condition of the same name is untouched', () => {
    // Different feature entirely — a name-based sweep is exactly how it would
    // have been taken by mistake.
    expect(read('src/components/notifications/rule-editor.ts')).toContain('minImportance')
    expect(read('src/data/notification-center.ts')).toContain('minImportance')
  })
})

describe('Manage cameras is reachable from Settings → Viewing (2026-10-08)', () => {
  it('the Viewing segment opens /settings/cameras', () => {
    expect(VIEWING()).toContain("t('v2.settings.manageCameras')")
    expect(VIEWING()).toContain("router.push('/settings/cameras')")
  })

  it('keeps both ROUTES alive — old deep links and other entry points use them', () => {
    expect(existsSync(join(ROOT, 'app/(app)/settings/cameras.tsx'))).toBe(true)
    expect(existsSync(join(ROOT, 'app/(app)/artifacts.tsx'))).toBe(true)
  })

  it('keeps the Cameras page entry point, and Artifacts stays a Library section only', () => {
    expect(read('src/screens/CamerasScreen.tsx')).toContain("router.push('/settings/cameras')")
    expect(SETTINGS()).not.toContain("t('v2.artifacts.settingsHint')")
  })
})

describe('Stream defaults and Timeline are two sections of the Viewing segment', () => {
  it('each title appears exactly once', () => {
    const src = VIEWING()
    expect(src.match(/<Section title=\{t\('v2\.settings\.streamDefaults'\)\}>/g) ?? []).toHaveLength(1)
    expect(src.match(/<Section title=\{t\('v2\.settings\.timeline'\)\}>/g) ?? []).toHaveLength(1)
  })

  it('every stream row and every timeline row survives', () => {
    // A row silently dropped here is a setting the operator can no longer
    // reach, with nothing to say so.
    const stream = sectionBlock(VIEWING(), 'v2.settings.streamDefaults')
    for (const row of ["setStreamDefault('audioOnOpen'", "setStreamDefault('pinchExpandsHeight'"]) {
      expect(stream, `stream lost ${row}`).toContain(row)
    }
    const timeline = sectionBlock(VIEWING(), 'v2.settings.timeline')
    for (const row of ['applyDensityPreset', "setCluster('showClass'"]) {
      expect(timeline, `timeline lost ${row}`).toContain(row)
    }
  })
})

/**
 * The Grid-defaults section is gone: its one row — how long a tile's motion
 * highlight stays lit after motion stops — is a property of the HIGHLIGHT, not
 * of the grid, and it was already global (it drives `useMotionHighlight`
 * everywhere, not just the wall). A section holding a single setting that
 * belongs to the section below it is how an operator ends up hunting for a
 * knob in the wrong place.
 */
describe('the Servers section names who is signed in', () => {
  it('renders the session user from useMe, with the role the hub confirmed', () => {
    const src = read(SEGMENT_FILES.account)
    expect(src).toContain('useMe')
    const open = src.indexOf('<ServersSection')
    expect(open, 'no <ServersSection> in Settings').toBeGreaterThan(-1)
    const block = src.slice(open, src.indexOf('<TokensSection', open))
    expect(block).toContain("t('v2.settings.roleAdmin')")
    expect(block).toContain("t('v2.settings.roleViewer')")
    expect(block).toContain('me.username')
    const servers = read('src/screens/settings/ServersSection.tsx')
    expect(servers).toContain("label={t('v2.settings.account')} value={accountValue}")
  })
})

describe('grid defaults merged into highlight appearance', () => {
  it('has no Grid-defaults section', () => {
    expect(SETTINGS()).not.toContain("t('v2.settings.gridDefaults')")
  })

  it('keeps the motion-hold row, inside Highlight appearance', () => {
    const block = sectionBlock(VIEWING(), 'v2.settings.highlightAppearance')
    expect(block).toContain("t('v2.settings.motionHold')")
    expect(block).toContain("setGridDefault('motionHoldSec'")
  })

  it('still offers every highlight row it had before the merge', () => {
    const block = sectionBlock(VIEWING(), 'v2.settings.highlightAppearance')
    for (const key of [
      'highlightMotionColor',
      'highlightAudioColor',
      'highlightDetectionColor',
      'highlightThickness',
    ]) {
      expect(block, key).toContain(`t('v2.settings.${key}')`)
    }
  })
})


/**
 * The two single-stream switches added on 2026-09-02, and the guard is
 * reachability: both write real authorities (the navigation the camera detail
 * mounts, and the remembered camera the launch spends), so a row that silently
 * fell out of this section would be a working feature with no way in.
 */
describe('the single-stream switches are reachable', () => {
  const block = (): string => sectionBlock(VIEWING(), 'v2.settings.streamDefaults')

  it('the navigation-bar switch is in the Stream defaults section', () => {
    expect(block()).toContain("setStreamDefault('navBarOnStream'")
    expect(block()).toContain("t('v2.settings.navBarOnStream')")
  })

  it('the reopen-last-camera switch is too', () => {
    expect(block()).toContain("setStreamDefault('reopenLastCamera'")
    expect(block()).toContain("t('v2.settings.reopenLastCamera')")
  })

  it('and both ship OFF, so neither changes an existing install', () => {
    const store = read('src/store/settings-store.ts')
    expect(store).toMatch(/navBarOnStream: false/)
    expect(store).toMatch(/reopenLastCamera: false/)
  })
})

describe('their wording exists in both locales', () => {
  const KEYS = [
    'navBarOnStream',
    'navBarOnStreamHint',
    'reopenLastCamera',
    'reopenLastCameraHint',
  ] as const

  for (const key of KEYS) {
    it(`v2.settings.${key} — en and it, and not the same string twice`, () => {
      // i18next renders the dotted KEY when a translation is missing, so the
      // operator would read `v2.settings.navBarOnStream` on the switch. And an
      // Italian value identical to the English one is how a locale looks
      // complete while being untranslated.
      const en = enLocale.v2.settings[key]
      const it = itLocale.v2.settings[key]
      expect(en, `missing en: ${key}`).toBeTypeOf('string')
      expect(it, `missing it: ${key}`).toBeTypeOf('string')
      expect(en.length).toBeGreaterThan(0)
      expect(it.length).toBeGreaterThan(0)
      expect(it).not.toBe(en)
    })
  }
})

describe('the four segments', () => {
  it('the shell draws them with the Library tab\'s selector', () => {
    expect(read(SEGMENT_FILES.shell)).toContain('<ScopeBar')
    expect(read('src/screens/LibraryScreen.tsx')).toContain('<ScopeBar')
  })

  it('the shell remembers the segment for the session, in the device-settings store', () => {
    const shell = read(SEGMENT_FILES.shell)
    expect(shell).toContain('s.settings.settingsSegment')
    expect(shell).toContain('setSettingsSegment')
  })

  it('each segment owns its sections', () => {
    const owns: Record<keyof typeof SEGMENT_FILES, readonly string[]> = {
      shell: [],
      account: ['<ServersSection', '<TokensSection', '<ActiveSessionsSection collapsible'],
      viewing: ['v2.settings.streamDefaults', 'v2.settings.timeline', 'v2.settings.highlightAppearance'],
      app: ['v2.settings.general', '<SettingsLevelsSection', 'v2.settings.aboutUpdates'],
      advanced: ['<NetworkSection', 'v2.settings.diagnostics', 'v2.settings.data'],
    }
    for (const [file, marks] of Object.entries(owns)) {
      const src = read(SEGMENT_FILES[file as keyof typeof SEGMENT_FILES])
      for (const mark of marks) expect(src, `${file} lost ${mark}`).toContain(mark)
    }
  })

  it('Account offers Sign-in methods, and the route exists', () => {
    expect(read(SEGMENT_FILES.account)).toContain('onOpenSignInMethods')
    expect(read(SEGMENT_FILES.account)).toContain("'/settings/sign-in'")
    expect(existsSync(join(ROOT, 'app/(app)/settings/sign-in.tsx'))).toBe(true)
  })

  it('the network poll is gated on the segment being shown, not only the tab', () => {
    expect(read(SEGMENT_FILES.shell)).toContain('active={screenActive && key === segment}')
    expect(read('src/screens/settings/NetworkSection.tsx')).toContain('if (!active) return')
  })
})
