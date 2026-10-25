import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * A source guard for the property the camera-detail surface was rebuilt around
 * on 2026-08-01: **nothing floats over it, and nothing opens a window.**
 *
 * Seven surfaces moved into the timeline body that day. Five were
 * `FloatingPanel`s — PTZ, linked devices, the camera switcher, the quality
 * picker, the view-options menu — absolute cards handed a `topOffset` the
 * SCREEN derived from the animated video-box height, plus an `align` and a
 * `maxWidth` it also had to choose per layout. Two were `<Modal>`s (storage,
 * the event store): the same defect wearing the one costume that never LOOKS
 * broken, which is exactly why a guard rather than a review has to hold it.
 *
 * None of this can be asserted on a rendered tree. The panels cannot be mounted
 * at the sizes that break them in this environment — the reason a transport
 * pill's overlap once survived a whole redesign without a test noticing — so
 * the checks are on the source, and each of them fails loudly on the exact
 * regression it names.
 */

const SRC = join(process.cwd(), 'src')
const CAMERA = join(SRC, 'components', 'camera')
const THEATER = join(CAMERA, 'theater')
const DETAIL_SCREEN = join(SRC, 'screens', 'CameraDetailScreen.tsx')
const STREAM_OVERLAY = join(CAMERA, 'StreamOverlayControls.tsx')
const BODY_PANEL = join(THEATER, 'TimelineBodyPanel.tsx')

function walk(dir: string): readonly string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (full.endsWith('.ts') || full.endsWith('.tsx')) out.push(full)
  }
  return out
}

const ALL_SOURCES = walk(SRC)

/** Every source except this one — a guard that forbids a name has to say it. */
const POLICED_SOURCES = ALL_SOURCES.filter(
  (file) => !file.endsWith('panels-own-the-body.spec.ts'),
)

function read(file: string): string {
  return readFileSync(file, 'utf8')
}

/** A react-native `import { … Modal … }` — not the word in a docblock. */
function importsReactNativeModal(source: string): boolean {
  const match = source.match(/import\s*{([^}]*)}\s*from\s*'react-native'/)
  if (match === null) return false
  return match[1]
    .split(',')
    .map((s) => s.trim())
    .includes('Modal')
}

/**
 * The panel modules `TimelineBodyPanel` routes to, resolved from its own
 * imports — so a panel added tomorrow is policed without editing this list.
 */
function routedPanelFiles(): readonly string[] {
  const source = read(BODY_PANEL)
  const files: string[] = []
  for (const m of source.matchAll(/from '(\.[^']*\/)?([A-Z][A-Za-z]*Panel)\.js'/g)) {
    const rel = `${m[1] ?? './'}${m[2]}.tsx`
    const full = join(THEATER, rel)
    if (existsSync(full)) files.push(full)
  }
  return files
}

describe('the retired wrappers are gone, not merely unused', () => {
  /**
   * A wrapper with no callers is the leftover this repo keeps mistaking for
   * verification: it reads as "the old way still works", and the next person to
   * need a panel reaches for it.
   */
  const RETIRED = [
    join(CAMERA, 'FloatingPanel.tsx'),
    join(CAMERA, 'QualityPicker.tsx'),
    join(CAMERA, 'CameraMenuPanel.tsx'),
    join(CAMERA, 'management', 'StorageManagementModal.tsx'),
    join(CAMERA, 'management', 'EventsManagementModal.tsx'),
  ]

  for (const file of RETIRED) {
    it(`${file.split('/').pop()} no longer exists`, () => {
      expect(existsSync(file)).toBe(false)
    })
  }

  it('and nothing imports them', () => {
    const names = ['FloatingPanel', 'QualityPicker', 'CameraMenuPanel', 'StorageManagementModal', 'EventsManagementModal']
    for (const file of POLICED_SOURCES) {
      for (const name of names) {
        // The import specifier and the JSX use — never the prose. Two of the
        // panels' docblocks explain what the float they replaced did wrong, and
        // a guard that forbade saying the word would only teach the next person
        // to delete the explanation.
        expect(read(file), `${file} imports ${name}`).not.toMatch(
          new RegExp(`from '[^']*/${name}\\.js'`),
        )
        expect(read(file), `${file} renders ${name}`).not.toContain(`<${name}`)
      }
    }
  })
})

describe('a panel owns the body — it does not open a window', () => {
  it('every routed panel wears the shared host', () => {
    const routed = routedPanelFiles()
    // If this ever resolves to nothing the rest of the describe is vacuous.
    // 11, not 12, since 2026-08-02: the overlay sub-panel was dissolved into
    // the view-options menu (its sections render inline there), so it is no
    // longer routed by `TimelineBodyPanel`.
    //
    // 7 since 2026-09-02: the PTZ, linked-devices, capture-menu and export
    // panels went with the four toolbar buttons that were their only openers,
    // when this bar stopped being one camera's toolbar (`timeline-layout.ts`).
    expect(routed.length).toBeGreaterThanOrEqual(7)
    for (const file of routed) {
      expect(read(file), file).toContain('TimelinePanelHost')
    }
  })

  it('and none of them presents a Modal', () => {
    for (const file of routedPanelFiles()) {
      expect(importsReactNativeModal(read(file)), file).toBe(false)
    }
  })

  it('there is exactly ONE panel host', () => {
    // "Reuse the host, do not fork a second one": two hosts is two headers, two
    // close buttons and two ideas of what a panel is allowed to assume.
    const hosts = ALL_SOURCES.filter((f) => /PanelHost\.tsx$/.test(f))
    expect(hosts).toEqual([join(THEATER, 'TimelinePanelHost.tsx')])
  })
})

describe('the detail screen holds no panel state and no anchor', () => {
  /**
   * The screen used to carry an `activePanel` union of its own PLUS two
   * booleans for the modals, and the timeline's toolbar chips were derived from
   * the union across a prop boundary. Two states that must agree about which
   * surface is open is one state too many; the chips now read the timeline's
   * own `panel?.kind`.
   */
  /**
   * Matched on USE, never on the word. The screen's docblock recounts exactly
   * which state it stopped holding and why — a guard that forbade naming it
   * would only teach the next person to delete the explanation, which is the
   * lesson `docked-timeline-chrome.spec` already paid for once.
   */
  it('no second panel state', () => {
    const screen = read(DETAIL_SCREEN)
    for (const dead of [
      'activePanel',
      'storageOpen',
      'eventsMgmtOpen',
      'switcherOpen',
      'qualityOpen',
      'menuOpen',
      'ptzOpen',
      'devicesOpen',
    ]) {
      // A `useState` binding or a `setX(` call — the two ways it comes back.
      expect(screen, dead).not.toMatch(new RegExp(`const \\[${dead}\\b`))
      expect(screen, dead).not.toMatch(
        new RegExp(`set${dead[0].toUpperCase()}${dead.slice(1)}\\(`),
      )
    }
  })

  it('no offset derived from the video box for something else to sit under', () => {
    const screen = read(DETAIL_SCREEN)
    for (const dead of ['panelTopOffset', 'TOOLBAR_HEIGHT', 'panelAlign', 'panelMaxWidth']) {
      expect(screen, dead).not.toMatch(new RegExp(`const ${dead}\\b`))
      expect(screen, dead).not.toMatch(new RegExp(`\\{${dead}\\}`))
    }
    // …and nothing on this screen is handed one.
    expect(screen).not.toMatch(/topOffset=\{/)
  })

  it('and it hands the timeline no open-flags at all', () => {
    // `ptzOpen={…}` and friends are how the two states used to be kept in step.
    expect(read(DETAIL_SCREEN)).not.toMatch(/\b\w+Open=\{/)
  })
})

/**
 * ## The landscape contract
 *
 * In fill mode (fullscreen, or a phone simply rotated) the timeline is not on
 * the page: it lives in `LandscapeTimelineOverlay`, a right-edge drawer that
 * starts CLOSED. A panel of the timeline is therefore only visible while that
 * drawer is open.
 *
 * That is safe TODAY because every trigger is timeline chrome — the toolbar's
 * PTZ / devices / ≡ / quality buttons and the footer's camera button — all of
 * which are inside the drawer too. A trigger the operator can reach implies a
 * panel the operator can see, by construction, and neither lifting the host out
 * of the timeline nor auto-opening the drawer is needed.
 *
 * It stops being safe the moment a panel trigger is added to the VIDEO chrome,
 * which is always reachable in fill: tapping it would open a panel inside a
 * closed drawer — a control that silently does nothing. This is the guard that
 * makes that a build failure instead of a bug report, and it is why the
 * decision could be "leave it in the timeline" rather than "lift the host".
 */
describe('a panel trigger is reachable only where its panel is visible', () => {
  it('the stream overlay opens no panel', () => {
    const overlay = read(STREAM_OVERLAY)
    for (const trigger of [
      'onTogglePtz',
      'onToggleDevices',
      'onToggleQuality',
      'onToggleMenu',
      'onToggleLegend',
      'onPickCamera',
      'onOpenStorage',
      'onOpenEventStore',
    ]) {
      expect(overlay, trigger).not.toContain(trigger)
    }
  })

  it('the video chrome never renders a panel of the timeline body', () => {
    const overlay = read(STREAM_OVERLAY)
    expect(overlay).not.toContain('TimelinePanelHost')
    expect(overlay).not.toMatch(/<Timeline\w*Panel/)
  })
})
