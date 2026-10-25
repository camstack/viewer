import { describe, it, expect } from 'vitest'
import {
  splitBase64Chunks,
  parseLiveCaptureMessage,
  LiveCaptureAssembler,
  captureFileExtension,
  LIVE_CAPTURE_CHUNK_CHARS,
} from '../live-capture-protocol.js'

describe('splitBase64Chunks', () => {
  it('keeps a short payload as a single chunk', () => {
    expect(splitBase64Chunks('abcd', 10)).toEqual(['abcd'])
  })

  it('splits on the chunk size without dropping bytes', () => {
    expect(splitBase64Chunks('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij'])
  })

  it('uses the bridge-safe default size', () => {
    const payload = 'x'.repeat(LIVE_CAPTURE_CHUNK_CHARS + 3)
    const chunks = splitBase64Chunks(payload)
    expect(chunks).toHaveLength(2)
    expect(chunks.join('')).toBe(payload)
  })
})

describe('parseLiveCaptureMessage', () => {
  it('parses start / chunk / done / error', () => {
    expect(parseLiveCaptureMessage({ type: 'liveCaptureStart', id: 'a', mime: 'video/mp4' })).toEqual({
      type: 'liveCaptureStart',
      id: 'a',
      mime: 'video/mp4',
    })
    expect(
      parseLiveCaptureMessage({ type: 'liveCaptureChunk', id: 'a', index: 0, total: 1, data: 'QQ==' }),
    ).toEqual({ type: 'liveCaptureChunk', id: 'a', index: 0, total: 1, data: 'QQ==' })
    expect(parseLiveCaptureMessage({ type: 'liveCaptureDone', id: 'a' })).toEqual({
      type: 'liveCaptureDone',
      id: 'a',
    })
    expect(parseLiveCaptureMessage({ type: 'liveCaptureError', message: 'no video' })).toEqual({
      type: 'liveCaptureError',
      message: 'no video',
    })
  })

  it('returns null for junk and for other embed messages', () => {
    expect(parseLiveCaptureMessage(null)).toBeNull()
    expect(parseLiveCaptureMessage({ type: 'state', state: 'playing' })).toBeNull()
    expect(parseLiveCaptureMessage({ type: 'liveCaptureChunk', id: 'a', index: 0, total: 1 })).toBeNull()
  })
})

describe('LiveCaptureAssembler', () => {
  it('joins chunks even if they arrive out of order', () => {
    const assembler = new LiveCaptureAssembler()
    expect(assembler.push({ type: 'liveCaptureStart', id: 'c1', mime: 'video/mp4' })).toBeNull()
    expect(
      assembler.push({ type: 'liveCaptureChunk', id: 'c1', index: 1, total: 2, data: 'ef' }),
    ).toBeNull()
    expect(
      assembler.push({ type: 'liveCaptureChunk', id: 'c1', index: 0, total: 2, data: 'ab' }),
    ).toBeNull()
    expect(assembler.push({ type: 'liveCaptureDone', id: 'c1' })).toEqual({
      kind: 'complete',
      mime: 'video/mp4',
      base64: 'abef',
    })
  })

  it('reports an embed error', () => {
    const assembler = new LiveCaptureAssembler()
    expect(assembler.push({ type: 'liveCaptureError', message: 'MediaRecorder missing' })).toEqual({
      kind: 'error',
      message: 'MediaRecorder missing',
    })
  })

  it('errors when done arrives with a missing chunk', () => {
    const assembler = new LiveCaptureAssembler()
    assembler.push({ type: 'liveCaptureStart', id: 'c1', mime: 'video/webm' })
    assembler.push({ type: 'liveCaptureChunk', id: 'c1', index: 0, total: 2, data: 'ab' })
    expect(assembler.push({ type: 'liveCaptureDone', id: 'c1' })).toEqual({
      kind: 'error',
      message: 'incomplete capture',
    })
  })
})

describe('capture file helpers', () => {
  it('picks mp4 unless the mime is webm', () => {
    expect(captureFileExtension('video/mp4;codecs=avc1')).toBe('mp4')
    expect(captureFileExtension('video/webm;codecs=vp8')).toBe('webm')
  })
})
