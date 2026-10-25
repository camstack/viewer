/**
 * A chip tap is not eaten by the keyboard, and the keyboard never covers the
 * field being typed into.
 *
 * The rule editor is its own set of routes now (`/rule/[id]` and one route per
 * section), every one of them rendered through `EditorScroll`. Without
 * `keyboardShouldPersistTaps`, the first tap on a template variable chip while
 * the body field has the keyboard up only dismisses the keyboard — the token
 * never lands; without the `KeyboardAwareScrollView`, the body field sits under
 * the keyboard (on Android too). Source asserts, because both behaviours are native and
 * react-native-web has no keyboard.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (path: string): string => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

const SCREEN = read('../NotificationCenterScreen.tsx')
const EDITOR_SCROLL = read('../rule-editor/EditorScroll.tsx')
const EDITOR_SCREENS: readonly string[] = [
  '../rule-editor/RuleSummaryScreen.tsx',
  '../rule-editor/RuleSectionScreen.tsx',
  '../rule-editor/KindPickerScreen.tsx',
  '../rule-editor/TimelapseEditorScreen.tsx',
  '../rule-editor/SummaryEditorScreen.tsx',
  // The admin alarm screen types its delays into number fields (Task 12).
  '../AlarmSettingsScreen.tsx',
]

describe('a chip tap is not eaten by the keyboard', () => {
  it('the notification center ScrollView keeps handled taps while the keyboard is up', () => {
    expect(SCREEN).toMatch(/<KeyboardAwareScrollView\s+keyboardShouldPersistTaps="handled"/)
  })

  it('the editor scroll keeps handled taps and avoids the keyboard', () => {
    // One component does both on iOS AND Android: pads by the keyboard and
    // scrolls the focused field into view (`components/ui/KeyboardInset.tsx`).
    expect(EDITOR_SCROLL).toMatch(/<KeyboardAwareScrollView\s+keyboardShouldPersistTaps="handled"/)
    expect(EDITOR_SCROLL).not.toContain('KeyboardAvoidingView')
  })

  it('every editor route renders through it (the premise of the assert above)', () => {
    for (const path of EDITOR_SCREENS) {
      const source = read(path)
      expect(source, path).toContain('<EditorScroll')
      expect(source, path).not.toContain('<ScrollView')
    }
  })
})
