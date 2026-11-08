import { describe, expect, it } from 'vitest'
import { remoteSheetMaxHeight } from '../RemoteSheet.js'

describe('remoteSheetMaxHeight', () => {
  it('stops the card below the status bar / Dynamic Island', () => {
    expect(remoteSheetMaxHeight(844, 59)).toBe(785)
    expect(remoteSheetMaxHeight(844, 0)).toBe(844)
  })
  it('never goes negative', () => {
    expect(remoteSheetMaxHeight(40, 59)).toBe(0)
  })
})
