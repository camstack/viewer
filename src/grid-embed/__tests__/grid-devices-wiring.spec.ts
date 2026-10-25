/**
 * The two ends of the hot device-set path that no mount test can reach.
 *
 * `grid-devices-hot-swap.spec.ts` mounts the NATIVE host and proves the
 * behaviour. It cannot cover:
 *
 *  1. **`GridLiveEmbed.web.tsx`** — vitest resolves the bare specifier, so the
 *     `.web` twin is never the module under test. It is a separate file with
 *     the same contract, and it is the one the hub-served viewer runs.
 *  2. **`EmbedGridPage.tsx`** — a different bundle with its own suite and its
 *     own React; the command only works if the page implements it AND names it.
 *     A page that implements `setDevices` and forgets to declare it makes the
 *     host reload for ever, which looks exactly like the bug being fixed.
 *
 * One assertion per defect, each named.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const WEB_HOST = readFileSync(join(ROOT, 'src', 'grid-embed', 'GridLiveEmbed.web.tsx'), 'utf8')
const NATIVE_HOST = readFileSync(join(ROOT, 'src', 'grid-embed', 'GridLiveEmbed.tsx'), 'utf8')
const PAGE = readFileSync(join(ROOT, 'embed', 'src', 'pages', 'EmbedGridPage.tsx'), 'utf8')

describe('the web host speaks the same contract as the native one', () => {
  it('does not key the iframe on the device set', () => {
    // The line that made every "add to view" a fresh SPA boot.
    expect(WEB_HOST).not.toMatch(/key=\{devicesKey\}/)
    expect(NATIVE_HOST).not.toMatch(/key=\{devicesKey\}/)
  })

  it('pushes the set as a command when the page named it', () => {
    expect(WEB_HOST).toMatch(/postCommand\(\{ kind: 'setDevices', value: devices \}\)/)
    expect(WEB_HOST).toMatch(/commands\?\.includes\(GRID_HOT_DEVICES_COMMAND\)/)
  })

  it('still reloads for a page that did not', () => {
    // Dropping this makes an older page keep the OLD cameras for ever, which is
    // worse than the reload it replaced.
    expect(WEB_HOST).toMatch(/setReloadNonce\(\(n\) => n \+ 1\)/)
    expect(WEB_HOST).toMatch(/key=\{reloadNonce\}/)
  })
})

describe('the page implements the command AND declares it', () => {
  it('names it in the ready report', () => {
    // The list has grown a second member (`setSpans`); what must not change is
    // that the device command is in it and that the list is what `ready`
    // carries. A page that implements the command and forgets to declare it
    // makes the host reload for ever, which looks exactly like the bug fixed.
    expect(PAGE).toMatch(/IMPLEMENTED_COMMANDS: readonly string\[\] = \[[^\]]*'setDevices'/)
    expect(PAGE).toMatch(/gridStateMsg\('ready', undefined, IMPLEMENTED_COMMANDS\)/)
  })

  it('routes the inbound command to the API', () => {
    expect(PAGE).toMatch(/case 'setDevices':\s*\n\s*api\.setDevices\(/)
  })

  it('holds the device set as STATE, not as a read of the boot config', () => {
    // `config.devices` is the set the document booted with and never changes.
    expect(PAGE).toMatch(/useState<readonly number\[\]>\(config\.devices\)/)
    expect(PAGE).toMatch(/useActiveDevices\(devices,/)
    expect(PAGE).toMatch(/deviceIds: \[\.\.\.devices\]/)
  })

  it('re-pushing the SAME ids keeps the same array', () => {
    // The host re-pushes on any change it is unsure about; a fresh array with
    // identical contents would re-run the name query and the activity
    // subscriptions for nothing.
    expect(PAGE).toMatch(/sameIds\(prev, ids\) \? prev :/)
  })
})
