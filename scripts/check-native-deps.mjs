#!/usr/bin/env node
/**
 * Fails when a native package resolves to more than one version.
 *
 * 1.0.607 (build 18) crashed at launch with "DYLD Symbol missing":
 * ExpoCamera 57.0.6 needed BaseModule symbols that the hoisted
 * expo-modules-core 57.0.3 did not have, while expo itself carried a nested
 * 57.0.23. A local native module's `devDependencies: { "expo-modules-core": "*" }`
 * had pinned the old copy at the top of node_modules. JS checks could not
 * see it; only the device did. This runs in CI next to `expo install --check`.
 */
import { execFileSync } from 'node:child_process'

/** `npm ls` exits non-zero when the tree is invalid, which is exactly the case to report. */
function readTree() {
  try {
    return execFileSync('npm', ['ls', '--all', '--json'], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch (err) {
    if (err && typeof err.stdout === 'string' && err.stdout.length > 0) return err.stdout
    throw err
  }
}
const tree = JSON.parse(readTree())
const nativeProblems = (tree.problems ?? []).filter((p) => /expo|react-native/.test(p))
for (const problem of nativeProblems) process.stderr.write(`npm: ${problem}\n`)
const seen = new Map()
const walk = (node) => {
  for (const [name, dep] of Object.entries(node.dependencies ?? {})) {
    if (dep.version) {
      const set = seen.get(name) ?? new Set()
      set.add(dep.version)
      seen.set(name, set)
    }
    walk(dep)
  }
}
walk(tree)
const isNative = (name) =>
  name.startsWith('expo') || name.startsWith('react-native') || name === 'react'
const dupes = [...seen].filter(([name, versions]) => isNative(name) && versions.size > 1)
if (dupes.length > 0 || nativeProblems.length > 0) {
  for (const [name, versions] of dupes) {
    process.stderr.write(`duplicate native package ${name}: ${[...versions].join(', ')}\n`)
  }
  process.exit(1)
}
process.stdout.write(`check-native-deps: OK (${seen.size} packages, no native duplicates)\n`)
