/** The "camera · when" line of the face and plate detail sheets. */
import { describe, expect, it } from 'vitest'
import { captureCaption } from '../capture-caption.js'

const TS = Date.UTC(2026, 9, 21, 21, 40)

describe('captureCaption', () => {
  it('names the camera, then the capture time in the app locale', () => {
    const line = captureCaption({ cameraName: 'Front door', deviceId: 7, timestamp: TS }, 'it-IT')
    const d = new Date(TS)
    expect(line).toBe(`Front door · ${d.toLocaleDateString('it-IT')} ${d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`)
  })
  it('falls back to the device id when the camera is not known', () => {
    expect(captureCaption({ cameraName: undefined, deviceId: 7, timestamp: TS }, 'en-US').startsWith('#7 · ')).toBe(true)
  })
})
