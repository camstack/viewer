/**
 * One keyboard mechanism for the whole app (`components/ui/KeyboardInset.tsx`).
 *
 * `KeyboardAvoidingView` with `behavior={Platform.OS === 'ios' ? 'padding' :
 * undefined}` and `automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}`
 * both do nothing on Android, whose edge-to-edge windows — and every Modal's
 * dialog window — are not resized for the keyboard. Library -> Plates opened
 * its "assign plate" sheet entirely under the keyboard (2026-10-21). This
 * keeps the iOS-only tools out, and pins the sheets whose content is taller
 * than what the keyboard leaves to a scroll that reveals the focused field.
 * Source asserts: react-native-web has no software keyboard.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url))
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8')

/** Every app source under `src/` that contains `needle`, repo-relative; specs and test harness excluded. */
function sourcesContaining(needle: string): readonly string[] {
  let out = ''
  try {
    out = execFileSync('grep', ['-rlF', '--include=*.tsx', '--include=*.ts', needle, join(ROOT, 'src')], {
      encoding: 'utf8',
    })
  } catch {
    // grep exits 1 when nothing matches.
    return []
  }
  return out
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => line.slice(ROOT.length))
    .filter((path) => !path.includes('/__tests__/') && !path.startsWith('src/testing/'))
    .sort()
}

describe('one keyboard mechanism', () => {
  it('no screen or sheet reaches for the iOS-only keyboard tools', () => {
    expect(sourcesContaining('<KeyboardAvoidingView')).toEqual([])
    expect(sourcesContaining('automaticallyAdjustKeyboardInsets=')).toEqual([])
  })

  it('the sheet frame lifts its card on every phone sheet, with no opt-in prop', () => {
    const sheet = read('src/components/ui/SheetModal.tsx')
    expect(sheet).toContain('<KeyboardInsetView')
    expect(sheet).not.toContain('avoidKeyboard')
    expect(sourcesContaining('avoidKeyboard')).toEqual([])
  })

  it('the prompt dialog lifts its buttons above the keyboard the same way', () => {
    expect(read('src/components/ui/confirm.tsx')).toContain('<KeyboardInsetView')
  })

  it.each([
    'src/components/plates/PlateReviewDetailModal.tsx',
    'src/components/faces/FaceReviewDetailModal.tsx',
  ])('%s scrolls its body so the focused field and its button stay above the keyboard', (path) => {
    const source = read(path)
    expect(source).toContain('<KeyboardAwareScrollView style={styles.body}')
    // A FlatList nested in that scroll would break windowing (and warn).
    expect(source).not.toContain('<FlatList')
  })

  it.each([
    'src/screens/LoginScreen.tsx',
    'src/screens/notifications/rule-editor/EditorScroll.tsx',
    'src/screens/settings/SignInMethodsScreen.tsx',
    'src/screens/SettingsScreen.tsx',
    'src/components/camera/CameraControlsOverlay.tsx',
    'src/components/camera/theater/TimelinePanelHost.tsx',
  ])('%s scrolls its fields through the keyboard-aware scroll', (path) => {
    expect(read(path)).toContain('<KeyboardAwareScrollView')
  })

  it('the camera list reveals a focused rename row through the same hook', () => {
    const source = read('src/screens/CamerasManageScreen.tsx')
    expect(source).toContain('useKeyboardReveal(listScroller)')
    expect(source).toContain('onScrollOffsetChange={keyboardReveal.onScrollOffset}')
  })
})
