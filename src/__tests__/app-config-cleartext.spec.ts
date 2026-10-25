/**
 * `android.usesCleartextTraffic` is not on ExpoConfig.Android — tsc --noEmit
 * fails CI (https://github.com/camstack/viewer/actions/runs/32653142722).
 * LAN HTTP belongs on the AndroidManifest via a config plugin.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = join(__dirname, '../..')

describe('app.config cleartext traffic', () => {
  it('does not put usesCleartextTraffic on ExpoConfig.android', () => {
    const src = readFileSync(join(root, 'app.config.ts'), 'utf8')
    expect(src).not.toMatch(/^\s*usesCleartextTraffic:/m)
  })

  it('applies cleartext via the local AndroidManifest plugin', () => {
    const src = readFileSync(join(root, 'app.config.ts'), 'utf8')
    expect(src).toContain('./plugins/withCleartextTraffic')
  })
})
