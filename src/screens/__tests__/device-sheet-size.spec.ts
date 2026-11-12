import { describe, expect, it } from 'vitest'
import { DEVICE_DIALOG_MAX_HEIGHT, deviceSheetHeight } from '../device-sheet-size.js'

describe('deviceSheetHeight', () => {
  it('a phone sheet takes a share of the window, never all of it', () => {
    expect(deviceSheetHeight('sheet', 844)).toBe(591)
  })

  it('a web dialog takes a share of a short window and stops at its cap on a tall one', () => {
    expect(deviceSheetHeight('dialog', 600)).toBe(450)
    expect(deviceSheetHeight('dialog', 1200)).toBe(DEVICE_DIALOG_MAX_HEIGHT)
  })
})
