import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { THEME } from '../theme/tokens.js'

/**
 * The web shell declares the safe area and the PWA identity — from ONE mount
 * prefix.
 *
 * Operator report 2026-09-06, iPhone PWA: "the stream did not take the header
 * into account". Half of it was the shell:
 *
 *   1. `public/index.html` had no `viewport-fit=cover` and no iOS status-bar
 *      meta. WebKit then reports every `env(safe-area-inset-*)` as 0, so
 *      `useSafeAreaInsets()` on web returned 0 and EVERY inset consumer in the
 *      app (header, camera root, landscape drawer, bottom nav, sheets) padded
 *      by nothing — while iOS painted the status-bar band itself, from the
 *      unset (white) body background and the Expo-default blue `theme_color`.
 *      The app's inset discipline was right; the shell starved it of numbers.
 *   2. The manifest link was RELATIVE (`./manifest.json`) and the manifest had
 *      no `scope`/`id`, a relative `start_url` and icon paths under
 *      `/viewer/` while the files live under `/viewer/camstack/`. The hub
 *      serves the shell for every extension-less route, so an install started
 *      from `/viewer/camstack/camera/101` resolved the manifest to a 404 and
 *      became a Safari bookmark, not an app.
 *
 * Both files are now rendered by `scripts/write-manifest-for-build.js` from
 * one `__WEB_MOUNT_PREFIX__` token whose value is `getWebMountPrefix()` — the
 * same helper `app.config.ts` feeds to `experiments.baseUrl`, so the manifest
 * cannot drift from the mount again. `dist/` is build output and not asserted.
 */

const ROOT = join(__dirname, '..', '..')
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8')

const MOUNT_TOKEN = '__WEB_MOUNT_PREFIX__'

interface WebShellScript {
  readonly renderWebShell: (template: string, prefix: string) => string
}

interface WebBaseConfig {
  readonly getWebMountPrefix: () => string
}

interface ManifestIcon {
  readonly src: string
}

interface WebManifest {
  readonly start_url?: string
  readonly scope?: string
  readonly id?: string
  readonly icons?: readonly ManifestIcon[]
  readonly theme_color?: string
  readonly background_color?: string
  readonly display?: string
  readonly name?: string
  readonly short_name?: string
  readonly orientation?: string
}

// `JSON.parse` returns `any`; naming the shape here is the type boundary.
const parseManifest = (text: string): WebManifest => JSON.parse(text)

const requireCjs = createRequire(import.meta.url)
const script: WebShellScript = requireCjs(join(ROOT, 'scripts', 'write-manifest-for-build.js'))
const webBase: WebBaseConfig = requireCjs(join(ROOT, 'config-web-base.js'))

describe('the shell template declares the safe area', () => {
  const shell = read('public/index.template.html')

  it('extends the layout under the notch and the home indicator', () => {
    // Without `viewport-fit=cover` WebKit reports every safe-area inset as 0.
    expect(shell).toMatch(/<meta name="viewport" content="[^"]*viewport-fit=cover[^"]*"/)
  })

  it('runs as a standalone web app with a translucent status bar', () => {
    expect(shell).toContain('<meta name="apple-mobile-web-app-capable" content="yes"')
    expect(shell).toContain('<meta name="mobile-web-app-capable" content="yes"')
    expect(shell).toContain(
      '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"',
    )
  })

  it('paints the OS bands and the body with the app background, per colour scheme', () => {
    const light = THEME.light.background
    const dark = THEME.dark.background
    expect(shell).toContain(
      `<meta name="theme-color" media="(prefers-color-scheme: light)" content="${light}"`,
    )
    expect(shell).toContain(
      `<meta name="theme-color" media="(prefers-color-scheme: dark)" content="${dark}"`,
    )
    expect(shell).toMatch(new RegExp(`body\\s*\\{\\s*background:\\s*${light}`))
    expect(shell).toMatch(
      new RegExp(
        `@media \\(prefers-color-scheme: dark\\)\\s*\\{\\s*body\\s*\\{\\s*background:\\s*${dark}`,
      ),
    )
  })
})

describe('the shell template names every asset under the mount prefix', () => {
  const shell = read('public/index.template.html')

  it('links the manifest absolutely, never relative to the current route', () => {
    expect(shell).toContain(`<link rel="manifest" href="${MOUNT_TOKEN}manifest.json"`)
    expect(shell).not.toContain('href="./manifest.json"')
  })

  it('links the apple-touch-icon and the favicon under the mount', () => {
    expect(shell).toContain(`<link rel="apple-touch-icon" href="${MOUNT_TOKEN}icon-192.png"`)
    expect(shell).toContain(`href="${MOUNT_TOKEN}favicon.png"`)
    // The admin-ui root — outside the viewer's mount.
    expect(shell).not.toContain('href="/favicon')
  })
})

describe('the manifest template is one app, under the mount prefix', () => {
  const manifest = parseManifest(read('public/manifest.template.json'))

  it('starts, scopes and identifies itself at the mount', () => {
    // Two installs from two routes must be ONE app; a relative `start_url`
    // with no `scope`/`id` made them two.
    expect(manifest.start_url).toBe(MOUNT_TOKEN)
    expect(manifest.scope).toBe(MOUNT_TOKEN)
    expect(manifest.id).toBe(MOUNT_TOKEN)
  })

  it('names every icon under the mount', () => {
    const icons = manifest.icons ?? []
    expect(icons.length).toBeGreaterThan(0)
    for (const icon of icons) expect(icon.src.startsWith(MOUNT_TOKEN)).toBe(true)
  })

  it('carries the app colours, not the Expo defaults', () => {
    expect(manifest.theme_color).toBe(THEME.dark.background)
    expect(manifest.background_color).toBe(THEME.dark.background)
    expect(manifest.display).toBe('standalone')
    expect(manifest.orientation).toBe('any')
  })
})

/**
 * Operator report 2026-10-06, Chrome app on macOS: the window read
 * "camstack - camstack". Chrome titles an installed app's window
 * "<manifest name> - <document title>" when they differ; the manifest said
 * "Camstack" and the shell said "CamStack". One name, spelled once per file,
 * and equal — for the hosted PWA and the hub-embedded build alike (both
 * render these same templates).
 */
describe('the web app is called CamStack Viewer everywhere', () => {
  const shell = read('public/index.template.html')
  const manifest = parseManifest(read('public/manifest.template.json'))

  it('titles the document with the manifest name', () => {
    expect(shell).toContain('<title>CamStack Viewer</title>')
    expect(shell).not.toContain('%WEB_TITLE%')
    expect(manifest.name).toBe('CamStack Viewer')
    expect(manifest.short_name).toBe('CamStack')
  })
})

describe('renderWebShell', () => {
  const shell = read('public/index.template.html')
  const manifest = read('public/manifest.template.json')

  it('renders the hub mount: /viewer → /viewer/camstack/', () => {
    const out = script.renderWebShell(shell, '/viewer/camstack/')
    expect(out).toContain('href="/viewer/camstack/manifest.json"')
    expect(out).toContain('href="/viewer/camstack/icon-192.png"')
    expect(out).not.toContain(MOUNT_TOKEN)
  })

  it('renders the root mount for `npm run web`', () => {
    const out = script.renderWebShell(shell, '/')
    expect(out).toContain('href="/manifest.json"')
    expect(out).toContain('href="/favicon.png"')
    expect(out).not.toContain(MOUNT_TOKEN)
  })

  it('renders the manifest with the same prefix', () => {
    const out = parseManifest(script.renderWebShell(manifest, '/viewer/camstack/'))
    expect(out.start_url).toBe('/viewer/camstack/')
    expect(out.scope).toBe('/viewer/camstack/')
    expect(out.icons?.[0]?.src).toBe('/viewer/camstack/icon-72.png')
  })

  it('refuses a prefix that is not an absolute directory', () => {
    // A prefix without its slashes silently glues `viewer/camstackmanifest.json`.
    expect(() => script.renderWebShell(shell, 'viewer/camstack/')).toThrow()
    expect(() => script.renderWebShell(shell, '/viewer/camstack')).toThrow()
  })
})

describe('getWebMountPrefix — the one value the shell, the manifest and Expo share', () => {
  const saved = process.env.EXPO_PUBLIC_WEB_BASE_PATH

  afterEach(() => {
    if (saved === undefined) delete process.env.EXPO_PUBLIC_WEB_BASE_PATH
    else process.env.EXPO_PUBLIC_WEB_BASE_PATH = saved
  })

  it('is the hub mount for the orchestrator build', () => {
    process.env.EXPO_PUBLIC_WEB_BASE_PATH = '/viewer'
    expect(webBase.getWebMountPrefix()).toBe('/viewer/camstack/')
    process.env.EXPO_PUBLIC_WEB_BASE_PATH = '/viewer/'
    expect(webBase.getWebMountPrefix()).toBe('/viewer/camstack/')
  })

  it('is the root when no base path is baked in', () => {
    delete process.env.EXPO_PUBLIC_WEB_BASE_PATH
    expect(webBase.getWebMountPrefix()).toBe('/')
  })

  it('feeds `experiments.baseUrl` in app.config.ts — no second derivation', () => {
    const appConfig = read('app.config.ts')
    expect(appConfig).toContain('getWebMountPrefix')
    // The literal the manifest drifted from: `/viewer/` vs `/viewer/camstack/`.
    expect(appConfig).not.toContain('`${webBasePath}/camstack`')
  })
})

describe('the generated shell is a render of the template', () => {
  it('public/index.html carries the safe-area metas and no unrendered token', () => {
    // Whichever mount it was last rendered for, it came from the template —
    // a hand edit of the generated file is lost at the next build.
    const shell = read('public/index.html')
    expect(shell).toContain('viewport-fit=cover')
    expect(shell).toContain('black-translucent')
    expect(shell).not.toContain(MOUNT_TOKEN)
  })

  it('public/manifest.json carries no unrendered token and an absolute scope', () => {
    const manifest = parseManifest(read('public/manifest.json'))
    expect(manifest.scope?.startsWith('/')).toBe(true)
    expect(read('public/manifest.json')).not.toContain(MOUNT_TOKEN)
  })
})
