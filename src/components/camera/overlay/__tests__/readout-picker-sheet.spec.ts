import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = join(process.cwd(), 'src')
const read = (rel: string): string => readFileSync(join(SRC, rel), 'utf8')

describe('ReadoutPickerSheet', () => {
  it('opens through PickerSheet (SheetModal), not an inline expand in the menu', () => {
    const panel = read('components/camera/theater/TimelineOverlayPanel.tsx')
    const sheet = read('components/camera/overlay/ReadoutPickerSheet.tsx')
    expect(panel).toContain('<ReadoutPickerSheet')
    expect(panel).not.toContain('styles.picker')
    expect(sheet).toContain("from '../../ui/PickerSheet.js'")
    expect(sheet).toContain('testID="readout-picker-sheet"')
  })
})
