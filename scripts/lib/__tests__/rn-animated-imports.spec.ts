import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { findRnAnimatedImports } from '../rn-animated-imports.mjs'

const SCRIPT = path.resolve(__dirname, '..', '..', 'check-no-rn-animated.mjs')

function runGuard(files: Record<string, string>): { readonly code: number; readonly out: string } {
  const root = mkdtempSync(path.join(tmpdir(), 'rn-animated-'))
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(root, rel)
    mkdirSync(path.dirname(full), { recursive: true })
    writeFileSync(full, body)
  }
  try {
    return { code: 0, out: execFileSync('node', [SCRIPT], { cwd: root, encoding: 'utf8', stdio: 'pipe' }) }
  } catch (error) {
    const failure = error as { status?: number; stderr?: string }
    return { code: failure.status ?? 1, out: failure.stderr ?? '' }
  }
}

describe('findRnAnimatedImports', () => {
  it('flags Animated and Easing from react-native, wrapped or aliased', () => {
    expect(findRnAnimatedImports("import { Animated, View } from 'react-native'")).toEqual([{ line: 1, name: 'Animated' }])
    expect(findRnAnimatedImports("import { View, Easing as E } from \"react-native\"").map((f) => f.name)).toEqual(['Easing'])
    const wrapped = "import {\n  View,\n  Animated,\n} from 'react-native'"
    expect(findRnAnimatedImports(wrapped)).toEqual([{ line: 1, name: 'Animated' }])
  })

  it('flags a namespace use and a require', () => {
    expect(findRnAnimatedImports("import * as RN from 'react-native'\nconst v = new RN.Animated.Value(0)").map((f) => f.name)).toEqual(['Animated'])
    expect(findRnAnimatedImports("const A = require('react-native').Animated").map((f) => f.name)).toEqual(['Animated'])
  })

  it('leaves Reanimated, other react-native names and prose alone', () => {
    expect(findRnAnimatedImports("import Animated, { Easing } from 'react-native-reanimated'")).toEqual([])
    expect(findRnAnimatedImports("import { View, PanResponder } from 'react-native'")).toEqual([])
    expect(findRnAnimatedImports("// import { Animated } from 'react-native'\n/* import { Easing } from 'react-native' */")).toEqual([])
  })
})

describe('check-no-rn-animated (the guard)', () => {
  it('is red when a file imports Animated from react-native', () => {
    const run = runGuard({ 'src/Bad.tsx': "import { Animated } from 'react-native'\nexport const x = Animated\n" })
    expect(run.code).toBe(1)
    expect(run.out).toContain('src/Bad.tsx:1 (Animated)')
  })

  it('is red for an offender under app/ too', () => {
    expect(runGuard({ 'app/index.tsx': "import { Easing } from 'react-native'\n" }).code).toBe(1)
  })

  it('is green on a tree that uses Reanimated', () => {
    const run = runGuard({ 'src/Good.tsx': "import Animated from 'react-native-reanimated'\nimport { View } from 'react-native'\n" })
    expect(run.code).toBe(0)
    expect(run.out).toContain('motion ok')
  })

  it('is green on the real tree', () => {
    const out = execFileSync('node', [SCRIPT], { cwd: path.resolve(__dirname, '..', '..', '..'), encoding: 'utf8' })
    expect(out).toContain('motion ok')
  })
})
