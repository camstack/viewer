import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/** The gate is CommonJS (the ship scripts are); load it the way they do. */
const gate = createRequire(import.meta.url)('../check-whats-new.js') as {
  LINE_LIMIT: number
  nextVersion: (v: string, t: string) => string
  findProblems: (entries: readonly Entry[], version: string) => string[]
  checkShip: (o: { root?: string; bumpType?: string; version?: string }) => {
    ok: boolean
    version: string
    currentVersion: string
    problems: string[]
  }
  failureMessage: (r: { version: string; currentVersion: string; file: string; problems: string[] }) => string
}

interface Entry {
  version: string
  date?: string
  notes: { en: string[]; it: string[] }
}

const entry = (version: string, en = ['A fix.'], it = ['Una correzione.']): Entry => ({
  version,
  date: '2026-10-09',
  notes: { en, it },
})

/** A throwaway repo root: package.json + src/app/whats-new.ts. */
function fixture(pkgVersion: string, entries: Entry[]): string {
  const root = mkdtempSync(path.join(tmpdir(), 'whats-new-gate-'))
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: pkgVersion }))
  mkdirSync(path.join(root, 'src', 'app'), { recursive: true })
  writeFileSync(
    path.join(root, 'src', 'app', 'whats-new.ts'),
    `export interface WhatsNewEntry { readonly version: string }\n` +
      `export const WHATS_NEW: readonly WhatsNewEntry[] = ${JSON.stringify(entries, null, 2)}\n`,
  )
  return root
}

describe('nextVersion', () => {
  it('computes the version the ship script is about to write', () => {
    expect(gate.nextVersion('1.0.591', 'patch')).toBe('1.0.592')
    expect(gate.nextVersion('1.0.591', 'minor')).toBe('1.1.0')
    expect(gate.nextVersion('1.0.591', 'major')).toBe('2.0.0')
  })

  it('refuses a bad bump type or version', () => {
    expect(() => gate.nextVersion('1.0.0', 'huge')).toThrow(/bump type/)
    expect(() => gate.nextVersion('1.0', 'patch')).toThrow(/x\.y\.z/)
  })
})

describe('findProblems', () => {
  it('passes a newest entry with short en + it lines', () => {
    expect(gate.findProblems([entry('1.0.2'), entry('1.0.1')], '1.0.2')).toEqual([])
  })

  it('fails when the target version has no entry', () => {
    expect(gate.findProblems([entry('1.0.1')], '1.0.2')).toEqual(['no WHATS_NEW entry for 1.0.2'])
  })

  it('fails when the entry is not the newest', () => {
    expect(gate.findProblems([entry('1.0.1'), entry('1.0.2')], '1.0.2').join()).toMatch(/FIRST/)
  })

  it('fails on a missing or empty language', () => {
    expect(gate.findProblems([entry('1.0.2', ['A fix.'], [])], '1.0.2')).toEqual(["1.0.2 has no 'it' notes"])
    expect(gate.findProblems([entry('1.0.2', ['  '])], '1.0.2')).toEqual(['1.0.2 en[0] is empty'])
  })

  it('holds every line to one line within the budget', () => {
    const long = 'x'.repeat(gate.LINE_LIMIT + 1)
    expect(gate.findProblems([entry('1.0.2', [long])], '1.0.2').join()).toMatch(/141 chars/)
    expect(gate.findProblems([entry('1.0.2', ['one\ntwo'])], '1.0.2').join()).toMatch(/several lines/)
    expect(gate.findProblems([entry('1.0.2', ['x'.repeat(gate.LINE_LIMIT)])], '1.0.2')).toEqual([])
  })
})

describe('checkShip', () => {
  it('fails for the next version when only the current one has notes', () => {
    const root = fixture('1.0.1', [entry('1.0.1')])
    const result = gate.checkShip({ root, bumpType: 'patch' })
    expect(result.ok).toBe(false)
    expect(result.version).toBe('1.0.2')
    expect(gate.failureMessage({ ...result, file: 'src/app/whats-new.ts' })).toMatch(/v1\.0\.2.*\n[\s\S]*whats-new\.ts/)
  })

  it('passes once the next version is written, and reads the real TS file', () => {
    const root = fixture('1.0.1', [entry('1.0.2'), entry('1.0.1')])
    expect(gate.checkShip({ root, bumpType: 'patch' })).toMatchObject({ ok: true, version: '1.0.2' })
    expect(gate.checkShip({ root, bumpType: 'minor' })).toMatchObject({ ok: false, version: '1.1.0' })
  })

  it('accepts the repo as shipped: the version in package.json has its notes', () => {
    const root = path.resolve(__dirname, '../../..')
    const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string }
    expect(gate.checkShip({ root, version: pkg.version }).problems).toEqual([])
  })
})
