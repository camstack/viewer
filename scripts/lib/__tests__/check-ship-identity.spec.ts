import { mkdtempSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const gate = createRequire(import.meta.url)('../check-ship-identity.js') as {
  easProjectProblem: (config: unknown) => string | null
  readAscAppId: (cwd: string) => string | null
}

describe('ship identity gate', () => {
  it('refuses an app config without an EAS project id, and names `eas init`', () => {
    expect(gate.easProjectProblem({ extra: { router: { root: 'app' } } })).toContain('eas init')
    expect(gate.easProjectProblem({ extra: { eas: { projectId: '' } } })).toContain('eas init')
    expect(gate.easProjectProblem({})).toContain('eas init')
  })

  it('accepts a config that names one', () => {
    expect(gate.easProjectProblem({ extra: { eas: { projectId: 'abc' } } })).toBeNull()
  })

  it('reads the App Store Connect id from eas.json, null when absent', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ship-identity-'))
    writeFileSync(path.join(dir, 'eas.json'), JSON.stringify({ submit: { production: { ios: {} } } }))
    expect(gate.readAscAppId(dir)).toBeNull()
    writeFileSync(path.join(dir, 'eas.json'), JSON.stringify({ submit: { production: { ios: { ascAppId: '42' } } } }))
    expect(gate.readAscAppId(dir)).toBe('42')
  })
})
