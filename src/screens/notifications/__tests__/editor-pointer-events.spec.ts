/**
 * The read-only editors go inert through `style.pointerEvents`, never the
 * `pointerEvents` PROP — react-native-web deprecates the prop and the warning
 * made every mount spec noisy (Task 13 review m4).
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SCREENS: readonly string[] = [
  '../rule-editor/SummaryEditorScreen.tsx',
  '../rule-editor/TimelapseEditorScreen.tsx',
]

function read(path: string): string {
  return readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
}

describe('read-only editor inertness', () => {
  it.each(SCREENS)('%s uses style.pointerEvents, not the prop', (path) => {
    const source = read(path)
    expect(source).not.toMatch(/<View\s+pointerEvents=/)
    expect(source).toMatch(/pointerEvents: readOnly \? 'none' : 'auto'/)
  })
})
