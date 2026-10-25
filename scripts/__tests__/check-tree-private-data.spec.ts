/**
 * The whole-tree scrub guard. Values here are FAKE — the real terms are hashes
 * in the guard, and a spec must not reprint them.
 */
import { describe, expect, it } from 'vitest'
import { findTreePrivateData, termHash } from '../check-tree-private-data.mjs'

const FAKE = {
  person: new Set([termHash('zebedeo')]),
  host: new Set([termHash('runnerz')]),
  room: new Set([termHash('atrium')]),
  homeIp: new Set([termHash('203.0.113.9')]),
  cameraId: new Set([termHash('4242')]),
}

const categories = (text: string, file = 'x.md'): readonly string[] =>
  findTreePrivateData(text, file, FAKE).map((finding: { category: string }) => finding.category)

describe('tree scrub guard', () => {
  it('flags a person, a host, a room, a home address and a camera id', () => {
    expect(categories('enrolled Zebedeo')).toContain('person')
    expect(categories('node runnerz')).toContain('host')
    expect(categories("location: 'Atrium'")).toContain('room')
    expect(categories('hub at 203.0.113.9:8443')).toContain('home-ip')
    expect(categories('deviceId: 4242 on camera 1')).toContain('camera-id')
  })

  it('lets documentation addresses, decimals, resolutions and file:line refs through', () => {
    expect(categories('resolve 192.0.2.10 and 198.51.100.5')).toEqual([])
    expect(categories('score 0.4242 and 4242x360')).toEqual([])
    expect(categories('see file.ts:4242 for the width')).toEqual([])
    expect(categories('yolo model 4242')).toEqual([])
  })

  it('does not treat a workflow runs-on label as a host leak', () => {
    expect(categories('runs-on: [self-hosted, linux, runnerz]', '.github/workflows/ci.yml')).toEqual([])
  })

  it('keeps the Italian dictionary and the ML sense of the NAS host word', () => {
    expect(findTreePrivateData("location: 'Atrium'", 'locales/it.json', FAKE)).toEqual([])
    expect(
      findTreePrivateData(
        'the text tower and EmbeddingTower; a tower keeps crashing in TowerBudgets',
        'x.ts',
      ).map((finding: { match: string }) => finding.match),
    ).toEqual([])
  })
})
