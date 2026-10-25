import { describe, expect, it } from 'vitest'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const gate = require('../check-native-unchanged.js') as typeof import('../check-native-unchanged.js')

const CONFIG = (plugins: string, rv = '1.0.596'): string => `export default () => ({
  runtimeVersion: "${rv}",
  plugins: [
    "expo-font", // a comment
    ${plugins}
  ],
  experiments: {},
})`
const PKG = (deps: Record<string, string>): string => JSON.stringify({ dependencies: deps })
const native = (n: string): boolean => n.startsWith('expo-') || n === 'react-native-video'

interface Repo {
  readonly baseConfig: string
  readonly headConfig: string
  readonly basePkg: string
  readonly headPkg: string
  readonly changed?: string
  readonly untracked?: string[]
  readonly base?: string
}

function check(repo: Repo) {
  return gate.checkOta({
    git: (args: string[]) => {
      if (args[0] === 'log') return repo.base ?? 'abc123\n'
      if (args[0] === 'diff') return repo.changed ?? ''
      if (args[0] === 'show') return args[1]?.endsWith('app.config.ts') ? repo.baseConfig : repo.basePkg
      throw new Error(`unexpected git ${args.join(' ')}`)
    },
    readWorking: (rel: string) => (rel === 'app.config.ts' ? repo.headConfig : repo.headPkg),
    isNativeDep: native,
    untracked: () => repo.untracked ?? [],
  })
}

const SAME = { baseConfig: CONFIG('"expo-image"'), headConfig: CONFIG('"expo-image"'), basePkg: PKG({ zod: '4', 'expo-image': '1' }), headPkg: PKG({ zod: '4', 'expo-image': '1' }) }

describe('the OTA native-drift gate', () => {
  it('lets a JavaScript-only change through (a JS dependency bump included)', () => {
    expect(check({ ...SAME, headPkg: PKG({ zod: '5', 'expo-image': '1' }) })).toMatchObject({ ok: true, problems: [] })
  })

  it('refuses a changed or new file under modules/ or plugins/, tracked or not', () => {
    expect(check({ ...SAME, changed: 'modules/camstack-device-key/ios/A.swift\n' }).problems).toEqual(['native source changed: modules/camstack-device-key/ios/A.swift'])
    expect(check({ ...SAME, untracked: ['plugins/withX.js'] }).ok).toBe(false)
  })

  it('refuses a changed plugins list, but not a comment or a reflow', () => {
    expect(check({ ...SAME, headConfig: CONFIG('"expo-image", "expo-camera"') }).problems).toContain('the `plugins` list of app.config.ts changed')
    expect(check({ ...SAME, headConfig: CONFIG('"expo-image" /* note */') }).ok).toBe(true)
  })

  it('refuses a new, removed or re-versioned native dependency only', () => {
    expect(check({ ...SAME, headPkg: PKG({ zod: '4', 'expo-image': '1', 'expo-camera': '57' }) }).problems[0]).toMatch(/native dependency expo-camera/)
    expect(check({ ...SAME, headPkg: PKG({ zod: '4' }) }).problems[0]).toMatch(/native dependency expo-image: 1 -> \(absent\)/)
    expect(check({ ...SAME, headPkg: PKG({ zod: '4', 'expo-image': '2' }) }).ok).toBe(false)
    expect(check({ ...SAME, headPkg: PKG({ zod: '4', 'expo-image': '1', 'left-pad': '1' }) }).ok).toBe(true)
  })

  it('fails closed when the baseline commit cannot be found', () => {
    expect(check({ ...SAME, base: '\n' })).toMatchObject({ ok: false })
  })

  it('the repo as it is: update.js runs the gate before any bump', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const text = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../update.js'), 'utf8') as string
    expect(text).toMatch(/nativeGateOrExit\(\);\s*\nassertNotBehindRemote\(\);/)
  })
})
